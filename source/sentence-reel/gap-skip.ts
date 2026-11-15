import type { Clock } from './clock.ts';
import { GAP_EDGE_SECONDS, GAP_MARGIN_SECONDS, GAP_MAX_AHEAD_SECONDS, GAP_MAX_TRIES, GAP_MIN_HOLE_SECONDS, GAP_POLL_MS, GAP_SAME_PLACE_SECONDS, GAP_STILL_MS } from './constants.ts';

const MS = 1000;

/**
 * Carries playback over a small hole in the buffer.
 *
 * Why it exists: after a jump ahead and a step back (Repeat, the Left arrow, the wheel, the time strip), a streaming engine can leave
 * two buffered ranges that do not quite meet (measured: 35.94 and 36.01, a 70 ms hole). The browser then stops at the hole for good:
 * not paused, not seeking, the next range already loaded a few hundredths of a second ahead. Stepping back through lines is what this
 * player is for, so it steps over such a hole itself, whichever engine left it.
 *
 * It acts only when all of this holds: the film is playing (not paused, not seeking, not ended), the playhead has stood still for
 * GAP_STILL_MS, it is at the end of its own range (or in none), and another range begins no more than GAP_MAX_AHEAD_SECONDS ahead.
 * Then it moves the playhead just inside that range. With no range close ahead it is real buffering, and nothing is done.
 *
 * The second form of the same fault (measured in Chromium and Chrome): the hole is in the picture only, so the sound carries the
 * playhead over it while the picture stays on its last frame, and some three seconds later everything stops for good. So when the
 * playhead has just run over such a hole by itself, it is set again where it is, which starts the picture again at once.
 *
 * A move that does not take is tried GAP_MAX_TRIES times at one place and then left. In Step mode the player is asked first
 * (`stopBefore`): if the line ends before the place the playhead would be moved to, the player stops there and nothing is moved.
 * It says nothing and shows nothing: the film simply carries on.
 */
export class GapSkip {
  /** How many moves have been made (read by tests and checks; nothing in the player uses it). */
  count = 0;
  private readonly media: HTMLMediaElement;
  private readonly clock: Clock;
  private readonly stopBefore: (to: number) => boolean;
  private timer: unknown = null;
  private lastTime = Number.NaN;
  /** When the playhead was last seen to move (or was first looked at). */
  private movedAt = 0;
  /** The place of the last move (where the playhead stood, or the start of the range it ran onto), where that move went, and how many were made there in a row. */
  private place = Number.NaN;
  private target = Number.NaN;
  private tries = 0;

  constructor(media: HTMLMediaElement, clock: Clock, signal: AbortSignal, stopBefore: (to: number) => boolean = () => false) {
    this.media = media;
    this.clock = clock;
    this.stopBefore = stopBefore;
    if (signal.aborted) return;
    for (const type of ['play', 'playing', 'pause', 'ended', 'emptied']) media.addEventListener(type, () => this.sync(), { signal });
    // A seek is not the film running over a hole: after one, the playhead is followed afresh.
    media.addEventListener('seeking', () => { this.lastTime = Number.NaN; }, { signal });
    signal.addEventListener('abort', () => this.stop(), { once: true });
    this.sync();
  }

  /** Watch only while the film plays: no timer runs at rest. */
  private sync(): void {
    if (this.media.paused || this.media.ended) { this.stop(); return; }
    if (this.timer !== null) return;
    this.lastTime = Number.NaN;
    this.schedule();
  }

  private stop(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.timer = this.clock.setTimeout(() => { this.timer = null; this.look(); if (!this.media.paused && !this.media.ended) this.schedule(); }, GAP_POLL_MS);
  }

  private look(): void {
    const m = this.media;
    if (m.paused || m.ended) return;
    const now = this.clock.now();
    const t = m.currentTime;
    const rate = m.playbackRate;
    if (t !== this.lastTime || m.seeking || !(rate > 0)) {
      // Moving (or being moved): start timing again. Once the film has played on past the last move, that place counts as cleared.
      if (t > this.target + GAP_MAX_AHEAD_SECONDS) this.tries = 0;
      // Run over a hole: only if the playhead got there by playing (no further than the time since the last look allows), not by being put there.
      const played = !m.seeking && rate > 0 && t > this.lastTime && t - this.lastTime <= ((now - this.movedAt) / MS) * rate + GAP_MAX_AHEAD_SECONDS;
      const onto = played ? this.rangeRunOnto(this.lastTime, t) : null;
      this.lastTime = t;
      this.movedAt = now;
      if (onto !== null) this.move(onto, t + GAP_MARGIN_SECONDS);
      return;
    }
    if (now - this.movedAt < GAP_STILL_MS) return;
    const next = this.rangeJustAhead(t);
    if (next === null) return;
    this.movedAt = now;
    this.move(t, next + GAP_MARGIN_SECONDS);
  }

  /** Move the playhead, unless this place has been tried enough or the player stops (Step) before the new place. */
  private move(place: number, to: number): void {
    if (!(Math.abs(place - this.place) <= GAP_SAME_PLACE_SECONDS)) { this.place = place; this.tries = 0; }
    if (this.tries >= GAP_MAX_TRIES || this.stopBefore(to)) return;
    this.tries += 1;
    this.count += 1;
    this.target = to;
    this.lastTime = Number.NaN; // its own move is a seek too
    this.media.currentTime = to;
  }

  /** The buffered ranges as [start, end] pairs, in order; none if the media cannot say. */
  private ranges(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    try {
      const b = this.media.buffered;
      for (let i = 0; b && i < b.length; i += 1) out.push([b.start(i), b.end(i)]);
    } catch { /* an engine that cannot report its buffer: nothing to go on */ }
    return out;
  }

  /** The start of a buffered range that begins just ahead of `t`, when `t` is at the end of its own range or in none; else null. */
  private rangeJustAhead(t: number): number | null {
    let ownEnd = Number.NaN;
    let next = Number.POSITIVE_INFINITY;
    for (const [start, end] of this.ranges()) {
      if (start <= t && t <= end) ownEnd = end;
      else if (start > t && start < next) next = start;
    }
    const atEdge = Number.isNaN(ownEnd) || ownEnd - t <= GAP_EDGE_SECONDS;
    return atEdge && next - t <= GAP_MAX_AHEAD_SECONDS ? next : null;
  }

  /** The start of a range that begins after a small hole (large enough to hide a frame) and lies between `from` and `to`: the playhead has run onto it. Else null. */
  private rangeRunOnto(from: number, to: number): number | null {
    const r = this.ranges();
    for (let i = 1; i < r.length; i += 1) {
      const start = r[i][0];
      const hole = start - r[i - 1][1];
      if (from < start && start <= to && hole >= GAP_MIN_HOLE_SECONDS && hole <= GAP_MAX_AHEAD_SECONDS) return start;
    }
    return null;
  }
}
