import { stepSpeed } from './transport.ts';
import { AGAIN_PREVIOUS_SECONDS, FULLSCREEN_TIMEOUT_MS, HAVE_CURRENT_DATA, MESSAGES } from './constants.ts';
import { realClock, type Clock } from './clock.ts';
import { CaptionTracks } from './captions.ts';
import { liveCaptionHandlers } from './live-captions.ts';
import { CompleteCaptions } from './complete-captions.ts';
import { PlayRequest } from './play-request.ts';
import { createCueGuard } from './cue-guard.ts';
import { reactToMedia } from './media-reactions.ts';
import { Emitter } from './emitter.ts';
import { FrameLoop } from './frame-loop.ts';
import { fullscreenElementOf, toggleFullscreenOrRefuse } from './fullscreen.ts';
import { atEnd } from './state.ts';
import { bindMediaEvents, type MediaEventType } from './media-events.ts';
import { isIosLike, probeVolumeSettable } from './platform.ts';
import { clampIndex, indexAt } from './sentences.ts';
import { SentenceSource } from './sentence-source.ts';
import { buildState } from './state.ts';
import type { Listener, Navigation, NavSource, ReelOptions, ReelState, Sentence } from './types.ts';
import { applyLevel } from './volume-level.ts';
import { WaitGuard } from './wait.ts';

export type { Listener, NavSource, Navigation, ReelOptions } from './types.ts';

/**
 * Drives one media element by sentence. Holds all behaviour; knows nothing about the DOM of the
 * controls, so any skin can bind to it through subscribe() and the action methods.
 */
export class ReelController {
  private readonly media: HTMLMediaElement;
  private readonly fullscreenRoot: HTMLElement;
  private readonly doc: Document;
  private readonly clock: Clock;
  private readonly abort = new AbortController();
  private readonly emitter = new Emitter<ReelState>(() => this.state(), () => !this.destroyed && this.booted);
  private readonly navListeners = new Set<(n: Navigation) => void>();
  private readonly wait: WaitGuard;
  private readonly captions: CaptionTracks;
  private readonly settable: boolean;
  private readonly source: SentenceSource;
  private readonly complete: CompleteCaptions;
  private readonly loop: FrameLoop;
  private readonly playReq: PlayRequest;
  private waitOn = false;
  /** The Words lamp: the dot window shows the live sentence (on, the start state) or the quiet resting line (off). The caption track itself is not shown on the picture either way. */
  private lamp = true;
  private waiting = true;
  private message = '';
  private nativeFs = false;
  private navCount = 0;
  private destroyed = false;
  private booted = false; // false while the constructor wires captions (their first callbacks arrive inside it)

  constructor(media: HTMLMediaElement, fullscreenRoot: HTMLElement, options: ReelOptions = {}) {
    this.media = media;
    this.fullscreenRoot = fullscreenRoot;
    this.doc = options.doc ?? document;
    this.clock = options.clock ?? realClock;
    this.settable = options.volumeSettable ?? (isIosLike() ? false : probeVolumeSettable(media));
    this.source = new SentenceSource(media, this.abort.signal, () => { this.wait.arm(); this.emit(); });
    // Redraws every frame while playing; Wait does not depend on it (timers and timeupdate also stop playback).
    this.loop = new FrameLoop(this.clock, () => {
      if (this.destroyed || this.media.paused) return false;
      this.wait.check(); this.emit(); return true;
    });
    this.playReq = new PlayRequest(media, this.clock, { changed: () => this.emit(), gaveUp: () => { this.message = MESSAGES.playSlow; this.emit(); } });
    const load = { sentencesSrc: options.sentencesSrc, fetchFn: options.fetchFn, timeoutMs: options.loadTimeoutMs, eagerLoad: options.eagerLoad };
    this.complete = new CompleteCaptions(media, this.clock, this.source, fullscreenRoot, load, this.abort.signal, {
      onDone: () => this.captions.release(),
      onFailed: () => this.captions.abandon(),
      onSwitched: () => this.announce('language'),
      liveCues: () => this.captions.currentCues(),
      onConflict: () => this.captions.rewatch(),
    });
    this.wait = new WaitGuard({
      media,
      clock: this.clock,
      sentences: () => this.sentences,
      enabled: () => this.waitOn,
      hidden: () => this.doc.hidden === true,
      onHold: () => this.emit(),
    });
    this.bindEvents();
    this.captions = new CaptionTracks(media, this.clock, options.guard ?? createCueGuard(media), liveCaptionHandlers(this.source, this.complete, {
      words: () => { this.emit(); },
      loading: (loading) => { this.waiting = loading; this.emit(); },
    }));
    this.booted = true;
    this.complete.start();
  }

  private get sentences(): Sentence[] { return this.source.list; }

  subscribe(fn: Listener): () => void { return this.emitter.add(fn); }

  /** The sentences the reel moves through (do not change). */
  sentenceList(): readonly Sentence[] { return this.sentences; }

  /** Called after every move between sentences. */
  onNavigate(fn: (n: Navigation) => void): () => void {
    this.navListeners.add(fn);
    return () => this.navListeners.delete(fn);
  }

  state(): ReelState {
    return buildState({
      media: this.media,
      sentences: this.sentences,
      held: this.wait.holding,
      words: this.lamp && this.captions.available() && !this.source.captionsFailed,
      captionsAvailable: this.captions.available() && !this.source.captionsFailed,
      wait: this.waitOn,
      waiting: this.waiting || this.complete.pending,
      message: this.message,
      volumeSettable: this.settable,
      fullscreen: this.fullscreenOn(),
      navCount: this.navCount,
      totalKnown: this.source.totalKnown(),
      buffering: this.playReq.buffering,
      resting: this.complete.resting,
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.abort.abort();
    this.loop.stop();
    this.playReq.destroy();
    this.wait.destroy();
    this.captions.destroy();
    this.emitter.clear();
    this.navListeners.clear();
  }

  togglePlay(): void {
    if (this.failed) { this.retry(); return; }
    if (atEnd(this.media)) { this.seekTo(0); void this.play(); return; }
    if (this.media.paused) void this.play();
    else this.media.pause();
  }

  /** Restart the current sentence; under AGAIN_PREVIOUS_SECONDS into it, go to the one before. A held Wait stop is at the end of its sentence, so Again replays it. */
  again(): void {
    const s = this.current();
    if (!s) return;
    const into = this.wait.holding >= 0 ? Number.POSITIVE_INFINITY : this.media.currentTime - s.start;
    this.go(into < AGAIN_PREVIOUS_SECONDS ? Math.max(0, s.index - 1) : s.index, 'again');
    void this.play();
  }

  next(): void { this.step(1, 'next'); }
  previous(): void { this.step(-1, 'previous'); }

  /** Seek to the start of sentence i (clamped), keeping paused or playing. */
  seekToIndex(i: number, source: NavSource = 'reel'): void { this.go(i, source); }

  seekToTime(t: number): void {
    const duration = Number.isFinite(this.media.duration) ? this.media.duration : Number.POSITIVE_INFINITY;
    this.seekTo(Math.min(duration, Math.max(0, t)));
    this.emit();
  }

  seekBy(seconds: number): void { this.seekToTime((this.media.currentTime || 0) + seconds); }

  /** Jump to a fraction (0 to 1) of the film (nothing while the length is unknown). */
  seekToFraction(f: number): void {
    const d = this.media.duration;
    if (Number.isFinite(d) && d > 0) this.seekToTime(d * Math.min(1, Math.max(0, f)));
  }

  /** Step the playback speed through SPEEDS; returns the new rate. */
  stepSpeed(direction: 1 | -1): number {
    const rate = stepSpeed(this.media.playbackRate || 1, direction);
    this.media.playbackRate = rate;
    this.emit();
    return rate;
  }

  toggleCaptions(): boolean { return this.setWords(!this.lamp); }

  toggleWait(): boolean {
    this.waitOn = !this.waitOn;
    if (!this.waitOn) this.wait.release();
    this.wait.arm();
    this.emit();
    return this.waitOn;
  }

  toggleMute(): void { this.media.muted = !this.media.muted; this.emit(); }
  /** Volume level 0 to 5 (0 mutes and keeps the volume; no effect where scripts cannot set it). Told at once, so lamps and value text change in the same frame. */
  setLevel(level: number): void { if (this.settable) { applyLevel(this.media, level); this.emit(); } }

  stepLevel(direction: 1 | -1): void { this.setLevel(this.state().level + direction); }
  /** Enter or leave full screen. A refusal gives a message, cleared first so a repeat is announced again. */
  async toggleFullscreen(): Promise<void> {
    if (this.message) this.clearMessage();
    const done = await toggleFullscreenOrRefuse(
      { doc: this.doc, root: this.fullscreenRoot, media: this.media, nativeActive: this.nativeFs },
      this.clock,
      FULLSCREEN_TIMEOUT_MS,
    );
    if (!done && !this.destroyed) { this.message = MESSAGES.fullscreenFailed; this.emit(); }
  }

  /** The source or `sentences-src` changed: drop the old list, reel and total, and load the captions afresh. */
  reloadCaptions(sentencesSrc?: string): void {
    this.complete.reset(sentencesSrc);
    this.captions.rewatch();
    this.emit();
  }

  clearMessage(): void { this.message = ''; this.emit(); }

  /** Playback failed (the media error or a refused play). */
  private get failed(): boolean { return this.message === MESSAGES.mediaError || this.message === MESSAGES.playFailed; }

  /** Try again after a failure: clear the message, load the source again, play. */
  retry(): void {
    this.message = '';
    try { (this.media as { load?: () => void }).load?.(); } catch { /* the play below reports it */ }
    this.emit();
    void this.play();
  }

  /** Words lamp: the window shows the live sentence (on) or the resting line (off). False when there are no captions. */
  setWords(on: boolean): boolean {
    if (!this.captions.available()) return false;
    if (this.lamp !== on) { this.lamp = on; this.emit(); }
    return true;
  }

  private current(): Sentence | null {
    if (this.sentences.length === 0) return null;
    const held = this.wait.holding;
    return this.sentences[held >= 0 ? held : Math.max(0, indexAt(this.sentences, this.media.currentTime))];
  }

  private step(delta: number, source: NavSource): void {
    const s = this.current();
    if (s) this.go(s.index + delta, source);
  }

  private go(i: number, source: NavSource): void {
    if (this.sentences.length === 0) return;
    const from = this.current()?.index ?? 0;
    const target = this.sentences[clampIndex(this.sentences, i)];
    this.seekTo(target.start);
    this.navCount++;
    this.emit();
    this.announce(source, from);
  }

  /** Tell the navigation listeners which sentence is now current (after a move, or a language change). */
  private announce(source: NavSource, from?: number): void {
    const s = this.current();
    if (!s) return;
    const nav: Navigation = { source, from: from ?? s.index, index: s.index, count: this.sentences.length, totalKnown: this.source.totalKnown(), sentence: s };
    for (const fn of this.navListeners) fn(nav);
  }

  private seekTo(t: number): void { this.wait.release(); this.media.currentTime = t; this.wait.arm(); }

  /** The viewer has asked to play at least once (an error before that is not shown). */
  private playIntent = false;
  /** The source failed before anyone pressed Play (a page that loads its film early); Play then says so at once. */
  private failedBeforePlay = false;

  private async play(): Promise<void> {
    this.playIntent = true;
    this.playReq.request();
    // A dead link is reported when Play is pressed (its play() may never settle, which left the player silent).
    if (this.failedBeforePlay && this.media.readyState < HAVE_CURRENT_DATA) { this.message = MESSAGES.mediaError; this.emit(); }
    try { await this.media.play(); } catch { this.message = MESSAGES.playFailed; this.playReq.cancel(); }
    if (!this.destroyed) this.emit();
  }

  private bindEvents(): void {
    bindMediaEvents(this.media, this.doc, this.abort.signal, {
      onMedia: (type) => this.onMediaEvent(type),
      // A failed caption request can raise a media error although the film plays: only show one if nothing can play.
      // Nothing is said about a broken source until the viewer asks to play (a page that loads with a dead source stays quiet, the same in every engine).
      onError: () => { if (this.media.readyState >= HAVE_CURRENT_DATA) return; if (!this.playIntent) { this.failedBeforePlay = true; return; } this.message = MESSAGES.mediaError; this.emit(); },
      onFullscreen: (nativePlayer) => { if (nativePlayer !== undefined) this.nativeFs = nativePlayer; this.emit(); },
    });
  }

  private onMediaEvent(type: MediaEventType): void {
    reactToMedia(type, { playReq: this.playReq, wait: this.wait, loop: this.loop, recover: () => this.recover() });
    this.emit();
  }

  /** Playback works: a media error or a failed play shown earlier no longer applies. */
  private recover(): void {
    if (this.media.readyState >= HAVE_CURRENT_DATA) this.failedBeforePlay = false;
    if (this.media.readyState >= HAVE_CURRENT_DATA && (this.message === MESSAGES.mediaError || this.message === MESSAGES.playFailed || this.message === MESSAGES.playSlow)) this.message = '';
  }

  private fullscreenOn(): boolean {
    const el = fullscreenElementOf(this.doc);
    return this.nativeFs || (el !== null && el === this.fullscreenRoot);
  }

  private emit(): void { this.emitter.emit(); }
}
