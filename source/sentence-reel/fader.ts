import { FADER_PAGE_SECONDS, SEEK_STEP_SECONDS } from './constants.ts';
import type { ReelController } from './controller.ts';
import { el, hint, setAttr, toggleAttr } from './dom.ts';
import { formatTime } from './format.ts';
import { LABELS } from './labels.ts';
import { bindScrub } from './pointer.ts';
import { sliderIntent } from './slider-keys.ts';
import type { ReelState, Sentence } from './types.ts';

export interface FaderView {
  root: HTMLElement;
  hint: HTMLElement;
  update(state: ReelState): void;
}

const MILLIS = 1000;
/** The timeline carries a tick at the start of each quarter of the sentences. */
const FADER_PARTS = 4;
/** How much of a sentence has been said, 0 to 1. */
const fillOf = (s: Sentence | undefined, time: number): string => {
  if (!s || s.end <= s.start) return '0';
  // to 0.02: a finer step is not visible on a cell and would restyle it on every frame
  return String((Math.round(Math.min(1, Math.max(0, (time - s.start) / (s.end - s.start))) * 50) / 50).toFixed(2));
};
const round3 = (n: number): string => String(Math.round(n * MILLIS) / MILLIS);

/**
 * The fader: the whole timeline as its own slider. One cell per sentence, each as wide as it is long,
 * and a rider that sits at the playhead. The reel stays the by-sentence control; this one moves by seconds.
 */
export function buildFader(c: ReelController, signal: AbortSignal, rtl: () => boolean): FaderView {
  const description = hint(LABELS.timelineHint);
  const root = el('div', 'sr-fader', {
    role: 'slider', tabindex: '0', 'aria-label': LABELS.timeline, 'aria-describedby': description.id, 'aria-valuemin': '0', 'aria-valuemax': '0', 'aria-valuenow': '0',
  });
  const cells = el('span', 'sr-cells', { 'aria-hidden': 'true' });
  const rider = el('span', 'sr-rider', { 'aria-hidden': 'true' });
  root.append(cells, rider);
  let cellEls: HTMLElement[] = [];
  let ends: number[] = [];
  let signature = '';
  let userMoved = true;
  let latest: ReelState | null = null;

  root.addEventListener('keydown', (e) => {
    const intent = sliderIntent({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, rtl: rtl() });
    if (!intent) return;
    e.preventDefault();
    userMoved = true;
    const duration = c.state().duration;
    if (intent.type === 'home') c.seekToTime(0);
    else if (intent.type === 'end') c.seekToTime(duration);
    else if (intent.type === 'page') c.seekBy(intent.delta * FADER_PAGE_SECONDS);
    else c.seekBy(intent.delta * SEEK_STEP_SECONDS);
  }, { signal });
  root.addEventListener('blur', () => { userMoved = true; if (latest) update(latest); }, { signal });
  bindScrub(root, signal, (f) => {
    userMoved = true;
    c.seekToTime((rtl() ? 1 - f : f) * c.state().duration);
  });

  function drawCells(list: readonly Sentence[], duration: number): void {
    const widths = list.length > 0 ? list.map((s) => s.end - s.start) : [duration > 0 ? duration : 1];
    ends = list.map((s) => s.end);
    const part = Math.max(1, Math.ceil(widths.length / FADER_PARTS));
    cellEls = widths.map((w, i) => {
      const cell = el('span', 'sr-cell');
      cell.style.flexGrow = round3(Math.max(w, 0));
      if (i % part === 0 && widths.length >= FADER_PARTS) cell.setAttribute('data-part', '');
      return cell;
    });
    cells.replaceChildren(...cellEls);
  }

  function update(s: ReelState): void {
    latest = s;
    const list = c.sentenceList();
    const sig = `${list.length}:${list[0]?.start}:${list[list.length - 1]?.end}:${s.duration}`;
    if (sig !== signature) {
      signature = sig;
      drawCells(list, s.duration);
    }
    cellEls.forEach((cell, i) => {
      const played = ends.length > 0 && ends[i] <= s.time;
      toggleAttr(cell, 'data-played', played);
      // Not yet buffered: the whole segment lies past the end of what is loaded (drawn hollow). Unknown buffering draws nothing hollow.
      toggleAttr(cell, 'data-unbuffered', s.bufferedTo !== null && !played && (list[i]?.start ?? 0) >= s.bufferedTo + 0.25);
      const here = ends.length > 0 && i === s.index;
      toggleAttr(cell, 'data-current', here);
      if (here) cell.style.setProperty('--fill', fillOf(list[i], s.time)); else if (cell.style.getPropertyValue('--fill')) cell.style.removeProperty('--fill');
    });
    // Written on the rider itself (not the fader, whose cells would all be restyled with it) and only when it moves by a visible amount.
    const at = (s.duration > 0 ? Math.min(1, s.time / s.duration) : 0).toFixed(3);
    if (rider.style.getPropertyValue('--sr-rider') !== at) rider.style.setProperty('--sr-rider', at);

    const focused = root.ownerDocument.activeElement === root;
    if (focused && !s.paused && !userMoved) return;
    userMoved = false;
    setAttr(root, 'aria-valuemax', String(Math.floor(s.duration)));
    setAttr(root, 'aria-valuenow', String(Math.floor(s.time)));
    setAttr(root, 'aria-valuetext', LABELS.timeValue(formatTime(s.time), formatTime(s.duration)));
  }

  return { root, hint: description, update };
}
