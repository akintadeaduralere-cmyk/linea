import { CUE_LATE_POLL_MS, CUE_LATE_WINDOW_MS, CUE_POLL_MS, CUE_SETTLE_MS, CUE_WAIT_MS, NO_TRACK_GRACE_MS } from './constants.ts';
import type { Clock } from './clock.ts';
import type { CueGuard } from './cue-guard.ts';
import { isCueListComplete } from './cue-completeness.ts';
import { captionTracks, cueCount, readCues } from './cues.ts';
import type { Cue } from './types.ts';

export type GiveUpReason = 'none' | 'unreadable';

export interface CaptionHandlers {
  /** Cues were read (again whenever the count grows). */
  onCues(cues: Cue[]): void;
  /** The cue count held still: the cues read so far can drive the reel. */
  onSettled(): void;
  /** The cue list is complete (true), or a new track began to load (false): see COMPLETE_TOLERANCE_SECONDS. */
  onComplete(complete: boolean): void;
  /** No usable cues arrived in time. */
  onGiveUp(reason: GiveUpReason): void;
  /** The viewer picked another caption track (a menu set it showing). */
  onTrackChosen(track: { language: string; label: string }): void;
  /** Words (captions showing on the film) changed from outside this class. */
  onWords(on: boolean): void;
  /** True while waiting for the first cues. */
  onLoading(loading: boolean): void;
}

/**
 * Owns the caption track modes. Words on means "showing"; otherwise "hidden", never "disabled",
 * so cues keep driving the reel. While cues load the track may be "showing" behind the cue guard.
 */
export class CaptionTracks {
  private readonly media: HTMLMediaElement;
  private readonly clock: Clock;
  private readonly guard: CueGuard;
  private readonly handlers: CaptionHandlers;
  private readonly abort = new AbortController();
  private readonly forced = new Set<TextTrack>();
  /** The mode each track had before the reel first changed it, put back on destroy. */
  private readonly originals = new Map<TextTrack, TextTrackMode>();
  private wordsOn = false;
  private loading = false;
  /** Settled, but not complete: keep the track loading (behind the guard) in case more cues come. */
  private holdOpen = false;
  private complete = false;
  private waiting = false;
  private gaveUp = false;
  /** The up-front load failed, so a track with no cues is not worth waiting for. */
  private abandoned = false;
  private selected: TextTrack | null = null;
  private timer: unknown = null;
  private startedAt = 0;
  private stableSince = 0;
  private lastCount = 0;
  private lateUntil = 0;

  constructor(media: HTMLMediaElement, clock: Clock, guard: CueGuard, handlers: CaptionHandlers) {
    this.media = media;
    this.clock = clock;
    this.guard = guard;
    this.handlers = handlers;
    const list = media.textTracks;
    const opts = { signal: this.abort.signal };
    list?.addEventListener('addtrack', () => this.restart(), opts);
    list?.addEventListener('removetrack', () => this.restart(), opts);
    list?.addEventListener('change', () => this.onChange(), opts);
    this.restart();
  }

  words(): boolean { return this.wordsOn; }
  available(): boolean { return this.primary() !== null; }

  /** Words on or off. Returns false (and does nothing) when there is no caption track. */
  setWords(on: boolean): boolean {
    if (!this.primary()) return false;
    this.wordsOn = on;
    this.applyModes();
    this.handlers.onWords(on);
    return true;
  }

  /** The cues the primary track has so far (empty if none). */
  currentCues(): Cue[] {
    const primary = this.primary();
    return (primary && readCues(primary)) || [];
  }

  /** Watch the tracks again from now (the source changed). */
  rewatch(): void {
    this.abandoned = false;
    this.restart();
  }

  /** The up-front load failed: if the track has no cues either, go to time mode now rather than after the wait. */
  abandon(): void {
    this.abandoned = true;
    this.tick();
  }

  /** The cues are not needed from the track (a complete list came another way): stop loading, hide, release the guard. */
  release(): void {
    this.loading = false;
    this.holdOpen = false;
    this.complete = true;
    this.applyModes();
    this.setWaiting(false);
    // Keep a slow look at the track: any cue it shows is used to check the fetched list against the video.
    this.lateUntil = this.clock.now() + CUE_LATE_WINDOW_MS;
    this.tick();
  }

  destroy(): void {
    this.abort.abort();
    this.clearTimer();
    this.guard.release();
    for (const [track, mode] of this.originals) if (track.mode !== mode) track.mode = mode;
    this.originals.clear();
  }

  // ---- internals ---------------------------------------------------------------

  /** The track the reel follows: the one the viewer chose, else the first captions (then subtitles) track. */
  private primary(): TextTrack | null {
    const all = captionTracks(this.media);
    return (this.selected && all.includes(this.selected) ? this.selected : all[0]) ?? null;
  }

  /** A track appeared or went: start watching again from now. */
  private restart(): void {
    this.gaveUp = false;
    this.startedAt = this.clock.now();
    this.stableSince = this.startedAt;
    this.lastCount = 0;
    this.loading = this.primary() !== null;
    this.holdOpen = false;
    this.complete = false;
    this.handlers.onComplete(false);
    this.setWaiting(true);
    this.applyModes();
    this.tick();
  }

  private setWaiting(value: boolean): void {
    if (this.waiting === value) return;
    this.waiting = value;
    this.handlers.onLoading(value);
  }

  private applyModes(): void {
    const primary = this.primary();
    if (!primary) {
      this.guard.release();
      return;
    }
    const needsShowing = this.loading || this.holdOpen;
    if (needsShowing && !this.wordsOn) this.guard.engage();
    else this.guard.release();
    for (const t of this.forced) if (t !== primary && t.mode === 'showing') t.mode = 'hidden';
    const want = this.wordsOn || needsShowing ? 'showing' : 'hidden';
    if (primary.mode !== want) {
      if (!this.originals.has(primary)) this.originals.set(primary, primary.mode);
      primary.mode = want;
    }
    if (needsShowing) this.forced.add(primary);
  }

  private onChange(): void {
    if (this.loading || this.holdOpen) return;
    const chosen = captionTracks(this.media).find((t) => t.mode === 'showing');
    if (chosen && chosen !== this.primary()) {
      this.selected = chosen;
      this.handlers.onTrackChosen({ language: chosen.language, label: chosen.label });
    }
    const primary = this.primary();
    if (!primary) return;
    const on = primary.mode === 'showing';
    if (on === this.wordsOn) return;
    this.wordsOn = on;
    this.handlers.onWords(on);
  }

  private tick(): void {
    this.clearTimer();
    const now = this.clock.now();
    const primary = this.primary();
    if (!primary) {
      if (!this.gaveUp && now - this.startedAt >= NO_TRACK_GRACE_MS) this.giveUp('none');
    } else {
      const count = cueCount(primary);
      if (count > 0 && count !== this.lastCount) {
        this.lastCount = count;
        this.stableSince = now;
        this.lateUntil = now + CUE_LATE_WINDOW_MS;
        this.gaveUp = false;
        const cues = readCues(primary);
        if (cues) this.handlers.onCues(cues);
      } else if (count > 0 && this.loading && now - this.stableSince >= CUE_SETTLE_MS) {
        this.loading = false;
        this.holdOpen = true;
        this.lateUntil = now + CUE_LATE_WINDOW_MS;
        this.applyModes();
        this.handlers.onSettled();
        this.setWaiting(false);
      } else if (count === 0 && !this.gaveUp && (this.abandoned || now - this.startedAt >= CUE_WAIT_MS)) {
        this.giveUp('unreadable');
      }
    }
    if (primary && !this.loading && !this.complete && cueCount(primary) > 0) this.checkComplete(primary, now);
    this.scheduleNext(now);
  }

  /** Decide whether the cue list is complete (see cue-completeness.ts). Once it is, the track can go back to hidden. */
  private checkComplete(track: TextTrack, now: number): void {
    if (!isCueListComplete({ cues: track.cues, duration: this.media.duration, stillMs: now - this.stableSince, watchExpired: now > this.lateUntil })) return;
    this.complete = true;
    this.holdOpen = false;
    this.applyModes();
    this.handlers.onComplete(true);
  }

  private giveUp(reason: GiveUpReason): void {
    this.gaveUp = true;
    this.loading = false;
    this.lateUntil = this.clock.now() + CUE_LATE_WINDOW_MS;
    this.applyModes();
    this.setWaiting(false);
    this.handlers.onGiveUp(reason);
  }

  /**
   * Poll fast while cues load. After that keep a slow watch for a minute: a stream can add more
   * cues once the first batch looks settled (measured on a Mux HLS stream: a second batch arrived
   * after a pause), and captions can arrive after giving up. Growth restarts the minute.
   */
  private scheduleNext(now: number): void {
    const primary = this.primary();
    const fast = !this.gaveUp && (this.loading || !primary || cueCount(primary) === 0);
    if (!fast && now > this.lateUntil) return;
    this.timer = this.clock.setTimeout(() => this.tick(), fast ? CUE_POLL_MS : CUE_LATE_POLL_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
