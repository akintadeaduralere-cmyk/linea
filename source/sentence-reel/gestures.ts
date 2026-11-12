import type { Clock } from './clock.ts';
import { DOUBLE_TAP_MS } from './constants.ts';

export type Side = 'back' | 'forward';

/** Which outer third of the picture a point is in; null for the middle third or a picture with no size. */
export function sideOf(x: number, left: number, width: number): Side | null {
  if (!(width > 0)) return null;
  const f = (x - left) / width;
  if (f < 1 / 3) return 'back';
  if (f > 2 / 3) return 'forward';
  return null;
}

export interface TapHandlers {
  toggle(): void;
  skip(side: Side): void;
  /** Double-click in the middle: full screen. */
  fullscreen?: () => void;
}

/**
 * Taps on the picture. A single tap toggles play; a double tap on the left or right third skips instead.
 * Only a tap where a double tap is possible (an outer third) waits for the second one, DOUBLE_TAP_MS at most.
 */
export function attachTaps(stage: HTMLElement, clock: Clock, handlers: TapHandlers, signal: AbortSignal): void {
  let pending: { side: Side; timer: unknown } | null = null;
  const flush = (): void => {
    if (!pending) return;
    clock.clearTimeout(pending.timer);
    pending = null;
    handlers.toggle();
  };
  // Double-click in the middle enters or leaves full screen (as on YouTube and the Video.js default skin); its two clicks have
  // already toggled play twice, so the play state is unchanged. The sides keep their double-tap skips.
  stage.addEventListener('dblclick', (e) => {
    const r = stage.getBoundingClientRect();
    if (sideOf(e.clientX, r.left, r.width) || !handlers.fullscreen) return;
    e.preventDefault(); handlers.fullscreen();
  }, { signal });
  stage.addEventListener('click', (e) => {
    const r = stage.getBoundingClientRect();
    const side = sideOf(e.clientX, r.left, r.width);
    if (!side) { flush(); handlers.toggle(); return; }
    if (pending && pending.side === side) {
      clock.clearTimeout(pending.timer);
      pending = null;
      handlers.skip(side);
      return;
    }
    flush();
    const timer = clock.setTimeout(() => { pending = null; handlers.toggle(); }, DOUBLE_TAP_MS);
    pending = { side, timer };
  }, { signal });
  signal.addEventListener('abort', () => { if (pending) clock.clearTimeout(pending.timer); pending = null; }, { once: true });
}
