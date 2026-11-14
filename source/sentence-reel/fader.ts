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

/** A custom property read as a number (0 when unset). */
function cssNumber(node: Element, name: string): number {
  const raw = node.ownerDocument.defaultView?.getComputedStyle(node).getPropertyValue(name).trim() ?? '';
  return Number.parseFloat(raw) || 0;
}

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
  // Smoked glass draws its 86 evenly spaced slots as one SVG (hidden on silver): every slot one width, each edge on a whole device pixel.
  const SVGNS = 'http://www.w3.org/2000/svg';
  const slots = document.createElementNS(SVGNS, 'svg');
  slots.setAttribute('class', 'sr-slots'); slots.setAttribute('aria-hidden', 'true'); slots.setAttribute('focusable', 'false');
  const slotPaths = ['sr-sl-edge', 'sr-sl-off', 'sr-sl-hi', 'sr-sl-lit'].map((k) => { const pth = document.createElementNS(SVGNS, 'path'); pth.setAttribute('class', k); slots.append(pth); return pth; });
  root.append(slots);
  let slotSig = '';
  function drawSlots(count: number, index: number): void {
    if (!root.closest('.sr-smoked') || count <= 0) { if (slotSig) { slotPaths.forEach((pth) => pth.setAttribute('d', '')); slotSig = ''; } return; }
    const w = root.clientWidth; const units = cssNumber(root, '--fsk') || 612; const sc = w / units;
    // Device pixels per CSS pixel as actually drawn: the screen's ratio times any scaling the page applies (CSS zoom or transform).
    const drawn = root.getBoundingClientRect().width; const dpr = (root.ownerDocument.defaultView?.devicePixelRatio || 1) * (w > 0 && drawn > 0 ? drawn / w : 1);
    const snap = (v: number): number => Math.round(v * dpr) / dpr;
    const sig = `${count}:${index}:${w}:${dpr.toFixed(4)}`;
    if (sig === slotSig) return;
    slotSig = sig;
    const h = 14 * sc; const pitch = w / count; const sw = Math.max(1 / dpr, snap((cssNumber(root, '--slot-w') || 3.4) * sc));
    slots.setAttribute('width', String(w)); slots.setAttribute('height', String(h)); slots.setAttribute('viewBox', `0 0 ${w} ${h}`);
    let edge = ''; let off = ''; let hi = ''; let lit = '';
    for (let i = 0; i < count; i += 1) {
      const x = snap(i * pitch); const tall = i === index ? 14 : i % 10 === 0 ? 11 : 8; const sh = snap(tall * sc); const y = snap((h - sh) / 2);
      edge += `M${x - 1} ${y}h${sw + 2}v${sh}h${-(sw + 2)}z`;
      const r = `M${x} ${y}h${sw}v${sh}h${-sw}z`;
      if (index >= 0 && i <= index) lit += r; else { off += r; hi += `M${x} ${y}h${sw}v${snap(Math.max(1 / dpr, sc))}h${-sw}z`; }
    }
    slotPaths[0].setAttribute('d', edge); slotPaths[1].setAttribute('d', off); slotPaths[2].setAttribute('d', hi); slotPaths[3].setAttribute('d', lit);
  }
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => { if (latest) drawSlots(c.sentenceList().length, latest.index); }); ro.observe(root); signal.addEventListener('abort', () => ro.disconnect(), { once: true }); }
  let cellEls: HTMLElement[] = [];
  let ends: number[] = [];
  let starts: number[] = [];
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
    const g = rtl() ? 1 - f : f;
    // The smoked-glass skin draws one evenly spaced slot per spoken line, so a point on it means a line (and a place inside that line), not a share of the film.
    if (root.closest('.sr-smoked') && starts.length > 0) {
      const at = Math.min(starts.length - 1, Math.max(0, Math.floor(g * starts.length)));
      const inside = Math.min(1, Math.max(0, g * starts.length - at));
      c.seekToTime(starts[at] + inside * Math.max(0, ends[at] - starts[at]));
      return;
    }
    c.seekToTime(g * c.state().duration);
  });

  function drawCells(list: readonly Sentence[], duration: number): void {
    const widths = list.length > 0 ? list.map((s) => s.end - s.start) : [duration > 0 ? duration : 1];
    ends = list.map((s) => s.end);
    starts = list.map((s) => s.start);
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
    drawSlots(list.length, list.length > 0 ? s.index : -1);
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
