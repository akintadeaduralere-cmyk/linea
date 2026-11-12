/* RETIRED 12 Nov 2026 (owner decision: display glass replaces the dot text). Nothing imports this file any more; paging moved to window-fit.ts. Deleting it awaits the owner's yes. */
/**
 * The dot window never clips. It is 184 dots wide and 21 rows tall; a sentence is set in the dot face at one of
 * two sizes and wraps. The first size that holds the sentence in the window's 21 rows is used; when even the
 * smaller size needs more, the window grows (height: auto) instead of cutting the sentence.
 */
export const DOT_COLUMNS = 184;
export const DOT_ROWS = 21;
/** Dots left empty before a line and after it (the approved window starts its text 8 dots in and ends within 4 of the edge). */
const PAD_START_DOTS = 8;
const PAD_END_DOTS = 4;
/** Advance of a dot-face letter, in em (measured: Bitcount Grid Double sets every character 600 units on a 1000 em). */
const ADVANCE_EM = 0.6;
/** One font pixel is one dot at 10 times the dot pitch. */
const PX_PER_PITCH = 10;
/** The two sizes: scale of the dot size, and line height in dot rows. Two lines of the first fit 21 rows; three of the second do. */
export const DOT_LEVELS: readonly { scale: number; lineRows: number }[] = [{ scale: 1, lineRows: 10 }, { scale: 0.7, lineRows: 7 }];
/** A line must be tall enough for its letters. */
const LINE_FILL = 1;

export interface DotFit {
  /** Index into DOT_LEVELS. */
  level: number;
  fontPx: number;
  /** Lines the sentence is expected to take. */
  lines: number;
  /** Rows the lines need; above DOT_ROWS the window grows. */
  rows: number;
}

/** Plan the size for `letters` characters in a window `widthPx` wide, never below `minFontPx` (12 CSS px). */
export function planDots(letters: number, widthPx: number, minFontPx = 12): DotFit {
  const pitch = widthPx / DOT_COLUMNS;
  let last: DotFit = { level: 0, fontPx: 0, lines: 1, rows: 0 };
  for (let level = 0; level < DOT_LEVELS.length; level += 1) {
    const { scale, lineRows } = DOT_LEVELS[level];
    const fontPx = Math.max(minFontPx, PX_PER_PITCH * pitch * scale);
    const perLine = Math.max(1, Math.floor((widthPx - (PAD_START_DOTS + PAD_END_DOTS) * pitch) / (ADVANCE_EM * fontPx) + 1e-6));
    const lines = Math.max(1, Math.ceil(Math.max(0, letters) / perLine));
    const rows = lines * Math.max(lineRows, (LINE_FILL * fontPx) / pitch);
    last = { level, fontPx, lines, rows };
    if (rows <= DOT_ROWS) return last;
  }
  return last;
}

/** True when every character is in the dot face's subset (Basic Latin); otherwise the sentence is drawn in the plain face. */
export function dotFaceHas(text: string): boolean {
  return !/[^ -~]/.test(text);
}

/** Lines in a page of the dot window when a sentence is too long for it. */
export const PAGE_LINES = 3;

/**
 * The page (a block of PAGE_LINES lines) that holds a word whose top edge is `top` px below the sentence's top.
 * Never negative: a word measured above the sentence (a window that centres overflow) is on the first page.
 */
export function pageOfWord(top: number, lineHeight: number, perPage = PAGE_LINES): number {
  if (!(lineHeight > 0) || !Number.isFinite(top)) return 0;
  const line = Math.floor((Math.max(0, top) + lineHeight * 0.25) / lineHeight);
  return Math.floor(line / perPage);
}

/** Whole lines that fit the face; three for the dot face (21 rows of 7), fewer for a taller plain face. At least one. */
export function linesPerPageFor(m: { lineHeight: number; linePitch?: number; faceHeight?: number }): number {
  const lh = m.linePitch ?? m.lineHeight;
  if (!(m.faceHeight && m.faceHeight > 0) || !(lh > 0)) return PAGE_LINES;
  return Math.max(1, Math.min(PAGE_LINES, Math.floor(m.faceHeight / lh + 0.03)));
}
