import type { Cue } from './types.ts';

/** Offsets smaller than this (seconds) are rounding, not a mismatch between the subtitle map and the video. */
export const OFFSET_TOLERANCE_SECONDS = 0.1;
/** How many of the live track's first cues are compared. */
const CHECKED_CUES = 5;

export type Reconciled = { status: 'unverified' } | { status: 'ok'; offset: number } | { status: 'conflict' };

const same = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/**
 * Check a fetched cue list against the live text track, which the browser has already placed on the video's own
 * timeline. No live cue yet: unverified. The live track's first cues (up to five) are looked for in the fetched
 * list as a run of consecutive cues with the same text, never as the first cue that happens to have the same
 * text (a repeated line such as "Yes." fits several cues). A run fits when every cue in it differs from the
 * fetched cue by the same constant (within OFFSET_TOLERANCE_SECONDS). One fit: that constant is returned, to be
 * added to the fetched list (0 when it is only rounding). Several fits that disagree: unverified, the live cues
 * do not say which is right. No fit: a conflict that cannot be reconciled.
 */
export function reconcile(fetched: readonly Cue[], live: readonly Cue[]): Reconciled {
  if (live.length === 0) return { status: 'unverified' };
  const run = live.slice(0, CHECKED_CUES);
  const fits: number[] = [];
  for (let i = 0; i + run.length <= fetched.length; i++) {
    const deltas = run.map((c, j) => (same(fetched[i + j].text, c.text) ? c.start - fetched[i + j].start : Number.NaN));
    if (deltas.some(Number.isNaN)) continue;
    if (Math.max(...deltas) - Math.min(...deltas) <= OFFSET_TOLERANCE_SECONDS) fits.push([...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)]);
  }
  if (fits.length === 0) return { status: 'conflict' };
  if (Math.max(...fits) - Math.min(...fits) > OFFSET_TOLERANCE_SECONDS) return { status: 'unverified' };
  const offset = fits[0];
  return { status: 'ok', offset: Math.abs(offset) <= OFFSET_TOLERANCE_SECONDS ? 0 : Math.round(offset * 1000) / 1000 };
}

export const shiftCues = (cues: readonly Cue[], offset: number): Cue[] => cues.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset }));
