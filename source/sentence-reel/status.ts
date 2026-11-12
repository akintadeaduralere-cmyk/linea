import { ANNOUNCE_DEBOUNCE_MS } from './constants.ts';
import type { Clock } from './clock.ts';

/** Zero-width space: not spoken, but it makes two identical announcements different strings. */
export const MARKER = '\u200B';

/**
 * The one polite status region of the player. It is present from the start and empty. Announcements
 * are debounced (the latest wins).
 *
 * Why a changing marker and not "empty it, then refill it": a screen reader may not repeat a live
 * region whose text it thinks is unchanged (VoiceOver is the usual case), and an emptied-then-refilled
 * region can be coalesced into "no change" when the refill is quick. Here every announcement writes
 * the text with the marker added or left off, alternately, so the content always differs from the
 * last one and the change is real, while one region (no second live node) is all there is.
 */
export class StatusRegion {
  readonly root: HTMLElement;
  private readonly clock: Clock;
  private pending: unknown = null;
  /** Starts true so the first announcement is written without the marker. */
  private marked = true;

  constructor(doc: Document, clock: Clock) {
    this.clock = clock;
    this.root = doc.createElement('div');
    this.root.className = 'sr-only';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-atomic', 'true');
  }

  announce(text: string): void {
    if (!text) return;
    if (this.pending !== null) this.clock.clearTimeout(this.pending);
    this.pending = this.clock.setTimeout(() => {
      this.pending = null;
      this.marked = !this.marked;
      this.root.textContent = this.marked ? `${text}${MARKER}` : text;
    }, ANNOUNCE_DEBOUNCE_MS);
  }

  destroy(): void {
    if (this.pending !== null) this.clock.clearTimeout(this.pending);
    this.pending = null;
    this.root.textContent = '';
    this.root.remove();
  }
}
