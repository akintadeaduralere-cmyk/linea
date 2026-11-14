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

/** Word-initial apostrophes that stand for missing letters ('cause, 'em), so they keep the apostrophe shape. */
const ELISION = /^'(?=(?:em|til|cause|bout|round|n|tis|twas|s)\b)/i;

/**
 * Typographer's quotes for one displayed word (owner, 14 Nov 2026: curly, as in the approved render).
 * Subtitle files carry straight ' and "; the window shows ’ ‘ “ ”. Screen-reader text is left as the file has it.
 */
export function typeset(word: string): string {
  return word
    .replace(ELISION, '\u2019')
    .replace(/^'/, '\u2018')
    .replace(/'/g, '\u2019')
    .replace(/^"/, '\u201C')
    .replace(/"/g, '\u201D');
}
