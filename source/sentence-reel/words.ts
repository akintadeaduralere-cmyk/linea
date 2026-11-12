import type { Sentence, WordTiming } from './types.ts';

/**
 * Estimate when each word is spoken: the sentence's duration is spread over its
 * characters, each word counting its letters plus the space after it.
 */
export function wordTimings(sentence: Sentence): WordTiming[] {
  const words = sentence.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const weights = words.map((w, i) => w.length + (i < words.length - 1 ? 1 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = sentence.end - sentence.start;
  let cursor = sentence.start;
  return words.map((word, i) => {
    const start = cursor;
    cursor += (weights[i] / total) * span;
    return { word, start, end: i === words.length - 1 ? sentence.end : cursor };
  });
}

/** Index of the word being spoken at time t, or -1 before the first / for no words. */
export function activeWordIndex(timings: readonly WordTiming[], t: number): number {
  if (timings.length === 0 || t < timings[0].start) return -1;
  for (let i = timings.length - 1; i >= 0; i--) if (t >= timings[i].start) return i;
  return -1;
}
