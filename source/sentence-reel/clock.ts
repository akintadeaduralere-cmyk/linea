/** Timers and frames behind one interface, so behaviour can be tested without waiting. */
export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  requestFrame(fn: () => void): unknown;
  cancelFrame(handle: unknown): void;
  now(): number;
}

const FRAME_FALLBACK_MS = 16;

export const realClock: Clock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  requestFrame: (fn) =>
    typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame(() => fn())
      : globalThis.setTimeout(fn, FRAME_FALLBACK_MS),
  cancelFrame: (h) =>
    typeof globalThis.cancelAnimationFrame === 'function'
      ? globalThis.cancelAnimationFrame(h as number)
      : globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};
