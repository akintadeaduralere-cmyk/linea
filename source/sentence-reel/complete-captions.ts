import type { Clock } from './clock.ts';
import { reconcile, shiftCues } from './calibration.ts';
import { loadCompleteCues, type LoadOptions } from './hls-captions.ts';
import type { SentenceSource } from './sentence-source.ts';
import type { Cue } from './types.ts';

export interface CompleteOptions {
  /** A complete WebVTT file (the `sentences-src` attribute). Without it an HLS source is read from its playlists. */
  sentencesSrc?: string;
  fetchFn?: LoadOptions['fetchFn'];
  timeoutMs?: number;
  /** Start loading as soon as the player exists, without waiting for intent. Off by default; "none" preload always waits. */
  eagerLoad?: boolean;
}

export interface CompleteHooks {
  /** A complete list was adopted: the live track need not keep loading. */
  onDone(): void;
  /** The up-front load failed: the live track takes over. */
  onFailed(): void;
  /** The live text track's cues so far (empty if none): the video's own timeline, to check the fetched list against. */
  liveCues(): Cue[];
  /** The fetched list disagrees with the live track and cannot be reconciled: the live track takes over. */
  onConflict(): void;
  /** The list was rebuilt for another language: announce the current sentence. */
  onSwitched(): void;
  /** The caption track the viewer chose and the media still has, if any: a first load asks the playlist for that language, not for the default. */
  chosenTrack?(): { language: string; label: string } | null;
}

type Phase = 'idle' | 'armed' | 'pending' | 'done' | 'failed';

/**
 * Gets the complete cue list up front, instead of waiting for the browser's text track to fill as HLS loads
 * caption segments during playback (which made the sentence total grow after Play). The fetch starts on
 * intent to play (play, pointerdown or focus in the player) and nothing else, unless `eagerLoad` is set (and
 * preload is not "none"). It is deferred past the play call so it never delays the video's own start. While the
 * list is on its way the live text track's events are held back; if the load fails they are replayed and the
 * live track is used as before. If it works, the list is final and locked. A new language, a new
 * `sentences-src` or a new source starts it again.
 */
export class CompleteCaptions {
  private readonly media: HTMLMediaElement;
  private readonly clock: Clock;
  private readonly source: SentenceSource;
  private readonly root: HTMLElement;
  private readonly signal: AbortSignal;
  private readonly hooks: CompleteHooks;
  private options: CompleteOptions;
  private held: Array<() => void> = [];
  private phase: Phase = 'idle';
  private generation = 0;
  private undoArm: () => void = () => {};
  private fetched: Cue[] = [];
  private verified = false;
  /** From a language choice: has the live track read the chosen track from the start, if the load that answers for the choice fails. */
  private follow: (() => void) | null = null;

  constructor(media: HTMLMediaElement, clock: Clock, source: SentenceSource, root: HTMLElement, options: CompleteOptions, signal: AbortSignal, hooks: CompleteHooks) {
    this.media = media;
    this.clock = clock;
    this.source = source;
    this.root = root;
    this.options = options;
    this.signal = signal;
    this.hooks = hooks;
  }

  /** True until the complete list has arrived or failed. */
  get pending(): boolean { return this.phase === 'pending'; }

  /** Waiting for intent (nothing fetched yet): the player is at rest and shows what is free, not a loading state. */
  get resting(): boolean { return this.phase === 'armed'; }

  /** Run a live-track callback now, hold it while the list is on its way, or drop it once the list is final. */
  gate(fn: () => void): void {
    if (this.pending) this.held.push(fn);
    else if (this.phase !== 'done') fn();
  }

  start(): void {
    const src = this.streamSrc();
    const fetchFn = this.options.fetchFn ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!fetchFn || this.phase !== 'idle') return;
    if (!this.options.sentencesSrc && !/\.m3u8/i.test(src)) {
      // The source may be set a little later (a framework wiring it up): look again when loading starts.
      if (!src) this.media.addEventListener('loadstart', () => this.start(), { once: true, signal: this.signal });
      return;
    }
    this.phase = 'armed';
    const stops: Array<() => void> = [];
    // An eager player keeps these listeners past its first load. Once the list is final an intent fetches nothing more: it only has the live track looked at afresh, as the end of a load does.
    const go = (): void => { if (this.phase === 'done' && !this.signal.aborted) this.hooks.onDone(); else this.begin(src, fetchFn, this.chosen()); };
    // Intent to play: start after the play call has returned, so the video's own start is never waiting for it.
    const intent = (): void => { this.clock.setTimeout(go, 0); };
    for (const [target, type] of [[this.media, 'play'], [this.root, 'pointerdown'], [this.root, 'focusin']] as const) {
      if (typeof target.addEventListener !== 'function') continue;
      target.addEventListener(type, intent, { once: true, signal: this.signal });
      stops.push(() => target.removeEventListener(type, intent));
    }
    const preload = this.media.preload ?? this.media.getAttribute?.('preload') ?? 'auto';
    if (this.options.eagerLoad && preload !== 'none') go();
    this.undoArm = () => stops.forEach((stop) => stop());
  }

  /**
   * The stream's address as the page named it. An HLS element plays through a `blob:` address once its engine attaches, and that says
   * nothing about the playlist: it is passed over for the element's own `src` (which still names the playlist) or its `src` attribute.
   */
  private streamSrc(): string {
    const named = (s: string | null | undefined): s is string => !!s && !/^blob:/i.test(s);
    const { currentSrc, src } = this.media;
    const attribute = this.media.getAttribute?.('src');
    return named(currentSrc) ? currentSrc : named(src) ? src : named(attribute) ? attribute : currentSrc || src || attribute || '';
  }

  /** The language the first load asks the playlist for: the track the viewer chose, if there is one. */
  private chosen(): LoadOptions['prefer'] {
    const track = this.hooks.chosenTrack?.();
    return track ? { language: track.language, name: track.label } : undefined;
  }

  /** The source or `sentences-src` changed: forget everything about the old list and start over. */
  reset(sentencesSrc?: string): void {
    this.generation++;
    this.undoArm();
    this.options = { ...this.options, sentencesSrc };
    this.phase = 'idle';
    this.held = [];
    this.follow = null;
    this.source.reset();
    this.start();
  }

  /**
   * The viewer chose another subtitles track: rebuild the list from that language's rendition. `followLive` has the live text track
   * read the chosen track instead: it is run where no complete list answers for the language, and kept for a load that may yet fail.
   */
  choose(track: { language: string; label: string }, followLive: () => void): void {
    if (this.options.sentencesSrc) {
      // A complete file was named: follow the viewer to the same film's file in the chosen language (its <track> element), if the page has one.
      const els = Array.from(this.media.querySelectorAll?.('track') ?? []) as HTMLTrackElement[];
      const el = els.find((t) => t.track && t.track.language === track.language && t.track.label === track.label);
      if (!el?.src || el.src === this.options.sentencesSrc) return;
      // The list had begun to load, so the viewer's intent is already given: load the chosen language now. reset() alone goes back
      // to waiting for a new play, press or focus, which left the window on the title (no sentences) until the next press in the player.
      const begun = this.phase === 'pending' || this.phase === 'done' || this.phase === 'failed';
      this.reset(el.src);
      const fetchNow = this.options.fetchFn ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
      if (begun && this.resting && fetchNow) this.begin(this.streamSrc(), fetchNow, undefined);
      // If this language's file cannot be loaded (now, or on the intent still to come) the live track takes over (onFailed): it must then read the chosen track, not the one before.
      if (this.pending || this.resting) this.follow = followLive;
      return;
    }
    // No complete file is named. The live track answers for the language at once, unless a list from the playlist is final or on its way:
    // then only if the load for the chosen language fails. A first load still to come asks for this language (see `go`).
    if (this.phase !== 'done' && this.phase !== 'pending') { followLive(); return; }
    this.follow = followLive;
    const src = this.streamSrc();
    const fetchFn = this.options.fetchFn ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (fetchFn) this.begin(src, fetchFn, { language: track.language, name: track.label }, true);
  }

  private begin(src: string, fetchFn: NonNullable<CompleteOptions['fetchFn']>, prefer: LoadOptions['prefer'], switching = false): void {
    if (this.phase === 'pending' && !switching) return;
    const gen = ++this.generation;
    this.undoArm();
    if (!switching) this.phase = 'pending';
    void loadCompleteCues({ src, sentencesSrc: this.options.sentencesSrc, fetchFn, clock: this.clock, timeoutMs: this.options.timeoutMs, prefer }).then((cues) => {
      if (this.signal.aborted || gen !== this.generation) return;
      const checked = cues ? reconcile(cues, this.hooks.liveCues()) : null;
      const fixed = cues && checked && checked.status !== 'conflict' ? (checked.status === 'ok' && checked.offset ? shiftCues(cues, checked.offset) : cues) : null;
      if (fixed && this.source.adoptComplete(fixed)) {
        this.phase = 'done';
        this.held = [];
        this.follow = null;
        this.fetched = fixed;
        this.verified = checked?.status === 'ok';
        if (switching) this.hooks.onSwitched(); else this.hooks.onDone();
        return;
      }
      this.phase = 'failed';
      this.source.unlock();
      const replay = this.held;
      const follow = this.follow;
      this.held = [];
      this.follow = null;
      // A chosen language starts the live watch again on its own track, so what was held from the watch before it is dropped, not replayed.
      if (follow) follow(); else for (const fn of replay) fn();
      this.hooks.onFailed();
    });
  }

  /**
   * A live-track cue list arrived after the fetched list was adopted: check the fetched list against it now.
   * A constant offset is corrected quietly; a disagreement that cannot be reconciled hands over to the live track.
   */
  observeLive(live: readonly Cue[]): void {
    if (this.phase !== 'done' || this.verified || live.length === 0) return;
    const r = reconcile(this.fetched, live);
    if (r.status === 'unverified') return;
    this.verified = true;
    if (r.status === 'conflict') {
      this.phase = 'failed';
      this.source.unlock();
      this.hooks.onConflict();
    } else if (r.offset) {
      this.fetched = shiftCues(this.fetched, r.offset);
      this.source.adoptComplete(this.fetched);
    }
  }
}
