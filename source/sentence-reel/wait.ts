import { BOUNDARY_EPSILON, WAIT_END_TOLERANCE, WAIT_DUCK_MARGIN, WAIT_MIN_TIMER_MS, WAIT_THROTTLED_LATENESS } from './constants.ts';
import type { Clock } from './clock.ts';
import type { Sentence } from './types.ts';

/**
 * The sentence Wait will stop at, seen from time t: the first one with time left in it.
 * A playhead at (or within the slack of) an end counts as already past it, and a playhead in a gap
 * is heading for the next sentence. This depends only on the time, never on what played before,
 * so a hold cannot leave the reel stuck however playback was restarted. -1 when none is left.
 */
export function nextStopIndex(sentences: readonly Sentence[], t: number): number {
  for (const s of sentences) if (s.end > t + BOUNDARY_EPSILON) return s.index;
  return -1;
}

export interface WaitDeps {
  media: HTMLMediaElement;
  clock: Clock;
  sentences(): readonly Sentence[];
  enabled(): boolean;
  /** The page is hidden, so timers may be throttled. */
  hidden(): boolean;
  /** Playback was stopped at the end of this sentence; the playhead is already on it. */
  onHold(index: number): void;
}

/**
 * Stops playback at the end of each sentence while Wait is on. Three things can trigger the stop,
 * so it still happens in a background tab where animation frames do not run: the owner's frame
 * loop calling check(), a timer set from the time left (accurate while audio plays), and
 * the media's own timeupdate events (the owner calls check() on them). The stop is at the cue end,
 * not before it, so the last of the speech is heard; a stop that runs a few milliseconds late puts the
 * playhead back on the exact end. (The film's cues end before each cut, so that margin is silent.)
 *
 * The sentence to stop at is chosen once per run of playback (arm(): after a play, seek, rate
 * change or Wait switch) and kept until reached. It is not worked out again from the time at each
 * check, because a check that lands exactly on the end would then look past it and let the next
 * sentence play.
 */
export class WaitGuard {
  private readonly deps: WaitDeps;
  private timer: unknown = null;
  private held = -1;
  private target: number | null = null;
  private ownSeekTo = Number.NaN;
  private mutedByUs = false;
  /** The viewer chose the sound while we had it muted: leave their choice alone for this stop. */
  private overridden = false;

  constructor(deps: WaitDeps) {
    this.deps = deps;
  }

  /** Index of the sentence playback is held at, or -1. */
  get holding(): number { return this.held; }

  /** True while the seek we made to the sentence end is in flight. */
  isOwnSeek(): boolean {
    return Number.isFinite(this.ownSeekTo) && Math.abs(this.deps.media.currentTime - this.ownSeekTo) <= BOUNDARY_EPSILON;
  }
  clearOwnSeek(): void { this.ownSeekTo = Number.NaN; }

  /** The sound changed. If it was unmuted while we had it muted, that was the viewer: their choice wins. */
  onSoundChange(): void {
    if (this.mutedByUs && !this.deps.media.muted) {
      this.mutedByUs = false;
      this.overridden = true;
    }
  }

  /** Let go of a hold. Any play event, seek or switching Wait off does this. */
  release(): void { this.held = -1; }

  /** Choose the next stop from where the playhead is and schedule it. Call after play, seek, rate change, Wait change. */
  arm(): void {
    this.clearTimer();
    this.target = null;
    this.overridden = false;
    this.restoreSound();
    this.step();
  }

  /** Stop now if the playhead has reached the end of the sentence it is heading for. */
  check(): void {
    const { media } = this.deps;
    if (!this.deps.enabled() || media.paused) return;
    const stop = this.stopSentence();
    if (!stop) return;
    if (media.currentTime >= stop.end - WAIT_END_TOLERANCE) this.stop(stop);
    else if (!this.overridden && this.duckFrom(stop) <= media.currentTime && !media.muted) {
      this.mutedByUs = true;
      media.muted = true;
    }
  }

  destroy(): void {
    this.clearTimer();
    this.restoreSound();
    this.held = -1;
    this.target = null;
  }

  // ---- internals ---------------------------------------------------------------

  /** Stop if due, otherwise set a timer for the time left. The chosen target is kept. */
  private step(): void {
    this.clearTimer();
    const { media, clock } = this.deps;
    if (!this.deps.enabled() || media.paused) return;
    this.check();
    if (media.paused) return;
    const stop = this.stopSentence();
    if (!stop) return;
    const rate = media.playbackRate > 0 ? media.playbackRate : 1;
    const at = this.mutedByUs || media.muted ? stop.end : this.duckFrom(stop);
    const ms = Math.max(WAIT_MIN_TIMER_MS, ((at - media.currentTime) / rate) * 1000);
    this.timer = clock.setTimeout(() => this.step(), ms);
  }

  /** The sentence to stop at, or null. The last sentence runs on to the end of the video. */
  private stopSentence(): Sentence | null {
    const list = this.deps.sentences();
    if (this.target === null) this.target = nextStopIndex(list, this.deps.media.currentTime);
    const s = this.target >= 0 ? list[this.target] : undefined;
    if (!s) {
      this.target = null;
      return null;
    }
    const duration = this.deps.media.duration;
    if (Number.isFinite(duration) && s.end >= duration - BOUNDARY_EPSILON) return null;
    return s;
  }

  /**
   * When the sound is cut ahead of the stop. In a visible tab never (the stop is exact). In a hidden tab
   * timers can run a second late and only media timeupdate events (every 0.25 s) are reliable, so the
   * sound is muted 0.3 s (0.25 s plus a margin) minus the silent gap to the next sentence before the cue end: the next
   * sentence cannot be heard, at the price of muting at most that much of the last words.
   */
  private duckFrom(stop: Sentence): number {
    if (!this.deps.hidden()) return stop.end;
    const next = this.deps.sentences()[stop.index + 1];
    const gap = next ? Math.max(0, next.start - stop.end) : WAIT_THROTTLED_LATENESS;
    return stop.end - Math.max(0, WAIT_THROTTLED_LATENESS + WAIT_DUCK_MARGIN - gap);
  }

  private restoreSound(): void {
    if (!this.mutedByUs) return;
    this.mutedByUs = false;
    this.deps.media.muted = false;
  }

  private stop(s: Sentence): void {
    const { media } = this.deps;
    this.held = s.index;
    this.ownSeekTo = s.end;
    this.target = null;
    this.overridden = false;
    this.clearTimer();
    media.pause();
    media.currentTime = s.end;
    this.restoreSound();
    this.deps.onHold(s.index);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.deps.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
