import {
  ABBREVIATIONS,
  BOUNDARY_EPSILON,
  FALLBACK_SEGMENT_COUNT,
  MIN_SENTENCE_SECONDS,
  SENTENCE_BREAK,
  SENTENCE_END,
} from './constants.ts';
import type { Cue, Sentence } from './types.ts';

interface Piece {
  text: string;
  start: number;
  end: number;
}

/** Remove WebVTT markup (voice, class, timestamp tags) and collapse whitespace. */
export function cleanCueText(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function endsWithAbbreviation(text: string): boolean {
  const last = text.split(' ').pop()?.toLowerCase() ?? '';
  return ABBREVIATIONS.includes(last);
}

/** Split one cue into sentence-sized pieces, sharing the cue's time by character count. */
function splitCue(cue: Cue): Piece[] {
  const text = cleanCueText(cue.text);
  if (!text) return [];
  const raw = text.split(SENTENCE_BREAK);
  const parts: string[] = [];
  for (const chunk of raw) {
    const prev = parts[parts.length - 1];
    if (prev !== undefined && endsWithAbbreviation(prev)) parts[parts.length - 1] = `${prev} ${chunk}`;
    else parts.push(chunk);
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const span = cue.end - cue.start;
  let cursor = cue.start;
  return parts.map((part) => {
    const start = cursor;
    cursor += (part.length / total) * span;
    return { text: part, start, end: cursor };
  });
}

/**
 * Merge caption cues into sentences. Cues are joined until sentence-ending punctuation;
 * a cue that holds several sentences is split, its time shared by character count.
 * Returns [] when there is nothing usable (the caller then uses fallbackSegments).
 */
export function buildSentences(cues: readonly Cue[]): Sentence[] {
  const valid = cues
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  const sentences: Sentence[] = [];
  let open: Piece | null = null;

  const close = (piece: Piece): void => {
    const end = Math.max(piece.end, piece.start + MIN_SENTENCE_SECONDS);
    sentences.push({ index: sentences.length, start: piece.start, end, text: piece.text, synthetic: false });
  };

  for (const cue of valid) {
    for (const piece of splitCue(cue)) {
      open = open ? { text: `${open.text} ${piece.text}`, start: open.start, end: piece.end } : piece;
      if (SENTENCE_END.test(piece.text) && !endsWithAbbreviation(piece.text)) {
        close(open);
        open = null;
      }
    }
  }
  if (open) close(open);
  return sentences;
}

/** Equal segments across the duration, used when there are no captions. */
export function fallbackSegments(duration: number, count: number = FALLBACK_SEGMENT_COUNT): Sentence[] {
  if (!Number.isFinite(duration) || duration <= 0 || count < 1) return [];
  const size = duration / count;
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    start: i * size,
    end: i + 1 === count ? duration : (i + 1) * size,
    text: '',
    synthetic: true,
  }));
}

/** Index of the sentence containing time t (the last one starting at or before t). -1 for no sentences. */
export function indexAt(sentences: readonly Sentence[], t: number): number {
  if (sentences.length === 0) return -1;
  let lo = 0;
  let hi = sentences.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sentences[mid].start <= t + BOUNDARY_EPSILON / 2) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 0 to 1 position of t inside sentence s. */
export function progressIn(s: Sentence, t: number): number {
  const span = s.end - s.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (t - s.start) / span));
}

/** Clamp a sentence index into range. */
export function clampIndex(sentences: readonly Sentence[], i: number): number {
  return Math.min(sentences.length - 1, Math.max(0, i));
}
