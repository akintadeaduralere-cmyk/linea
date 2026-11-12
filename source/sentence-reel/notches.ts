import { NOTCH_CAP } from './constants.ts';

/** Which sentences each drawn notch stands for. firstIndex[k] is the first sentence of notch k. */
export interface NotchPlan {
  count: number;
  firstIndex: number[];
}

/** One notch per sentence, up to the cap. Above it, sentences are shared out evenly (groups differ by at most one). */
export function planNotches(sentenceCount: number, cap: number = NOTCH_CAP): NotchPlan {
  if (!Number.isFinite(sentenceCount) || sentenceCount <= 0) return { count: 0, firstIndex: [] };
  const count = Math.min(Math.floor(sentenceCount), cap);
  const firstIndex = Array.from({ length: count }, (_, k) => Math.floor((k * sentenceCount) / count));
  return { count, firstIndex };
}

/** The notch that holds sentence i. */
export function notchOf(plan: NotchPlan, sentenceIndex: number): number {
  let lo = 0;
  let hi = plan.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (plan.firstIndex[mid] <= sentenceIndex) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** First sentence of the notch under a 0 to 1 position along the reel. `rtl` mirrors the position. */
export function indexAtFraction(plan: NotchPlan, fraction: number, rtl = false): number {
  if (plan.count === 0) return 0;
  const f = Math.min(1, Math.max(0, rtl ? 1 - fraction : fraction));
  const notch = Math.min(plan.count - 1, Math.floor(f * plan.count));
  return plan.firstIndex[notch];
}

/**
 * Which notches sit under the covered arc of the disc (the glass on desktop), given as a fraction range
 * of the disc from the layout: notch k is covered when from <= k / count < to. An empty or inverted range
 * covers nothing, which is how the phone layout shows every number.
 */
export function coveredNotches(count: number, from: number, to: number): boolean[] {
  return Array.from({ length: Math.max(0, count) }, (_, k) => {
    const at = k / count;
    return to > from && at >= from && at < to;
  });
}
