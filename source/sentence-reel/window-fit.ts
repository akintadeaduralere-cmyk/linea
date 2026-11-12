/** Lines in a page of the sentence window when a sentence is too long for it (the paging itself is measured from the real line boxes). */
export const PAGE_LINES = 3;

/**
 * The page (a block of lines) that holds a word whose top edge is `top` px below the sentence's top.
 * Never negative: a word measured above the sentence (a window that centres overflow) is on the first page.
 */
export function pageOfWord(top: number, lineHeight: number, perPage = PAGE_LINES): number {
  if (!(lineHeight > 0) || !Number.isFinite(top)) return 0;
  const line = Math.floor((Math.max(0, top) + lineHeight * 0.25) / lineHeight);
  return Math.floor(line / perPage);
}

/** Whole lines that fit the face, at most PAGE_LINES and at least one. Without a measured face height: PAGE_LINES. */
export function linesPerPageFor(m: { lineHeight: number; linePitch?: number; faceHeight?: number }): number {
  const lh = m.linePitch ?? m.lineHeight;
  if (!(m.faceHeight && m.faceHeight > 0) || !(lh > 0)) return PAGE_LINES;
  return Math.max(1, Math.min(PAGE_LINES, Math.floor(m.faceHeight / lh + 0.03)));
}
