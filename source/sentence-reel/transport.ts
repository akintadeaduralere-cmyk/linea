import { SPEEDS } from './constants.ts';

/** The next speed up (1) or down (-1) from the current rate, kept at the ends of the list. */
export function stepSpeed(rate: number, direction: 1 | -1): number {
  const at = SPEEDS.findIndex((s) => Math.abs(s - rate) < 1e-6);
  if (at >= 0) return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + direction))];
  // A rate that is not in the list (set by the page): the nearest listed speed in the direction asked.
  const beyond = direction > 0 ? SPEEDS.find((s) => s > rate) : [...SPEEDS].reverse().find((s) => s < rate);
  return beyond ?? SPEEDS[direction > 0 ? SPEEDS.length - 1 : 0];
}

/** "1.25X": the rate as the dot window shows it (upper case, no trailing zeros). */
export function speedText(rate: number): string { return `SPEED ${Number(rate.toFixed(2))}X`; }
export function speedSpoken(rate: number): string { return `Speed ${Number(rate.toFixed(2))} times`; }

export function skipText(seconds: number): string { return `${seconds < 0 ? '-' : '+'}${Math.abs(seconds)} SEC`; }
export function skipSpoken(seconds: number): string { return `${seconds < 0 ? 'Back' : 'Forward'} ${Math.abs(seconds)} seconds`; }

export const jumpText = (digit: number): string => `${digit * 10}%`;
export const jumpSpoken = (digit: number): string => `${digit * 10} percent`;
