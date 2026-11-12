import { el } from './dom.ts';

/** The player's own name, as engraved on the wheel. */
export const STANDBY_NAME = 'LINEA';
export const STANDBY_LINE = 'One line at a time';

/**
 * The standby screen (owner, 12 Nov 2026): before the first play the glass shows the player's own world.
 * A slow ring of notches echoes the wheel, one ember notch travels round it like the NOW mark, the letters of the
 * name rise in one by one, and a single ember line draws under them. Pure decoration: hidden from assistive tech
 * (the film's title is already in the sentence window). The stylesheet shows it only while data-phase="before".
 */
export function buildStandby(stage: HTMLElement): HTMLElement {
  const root = el('div', 'sr-standby', { 'aria-hidden': 'true' });
  const ring = el('div', 'sr-sb-ring');
  const spark = el('div', 'sr-sb-spark');
  const mark = el('div', 'sr-sb-mark');
  [...STANDBY_NAME].forEach((ch, i) => {
    const span = el('span', 'sr-sb-ch', {}, ch);
    span.style.setProperty('--i', String(i));
    mark.append(span);
  });
  const line = el('div', 'sr-sb-line');
  const tag = el('div', 'sr-sb-tag', {}, STANDBY_LINE);
  root.append(ring, spark, mark, line, tag);
  stage.append(root);
  return root;
}
