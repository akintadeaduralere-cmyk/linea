import { NOTCH_CAP } from './constants.ts';
import { uid } from './dom.ts';
import type { ReelState } from './types.ts';

const SVG = 'http://www.w3.org/2000/svg';
/** The arc's end points sit this many degrees either side of straight down. As the board draws it (board F: end points below the centre, large arc, sweep 0), the SVG arc then runs along a circle of the given radius whose centre is mirrored below the disc centre: the print sits low, near the rim, and its length is 200 degrees. */
const ARC_HALF_DEGREES = 80;
/** Degrees of arc the print can use (the long way round the lower part). */
const ARC_SPAN_DEGREES = 200;
/** Largest title that is drawn; longer ones are dropped for the count alone when they do not fit. */
const TITLE_MAX = 40;
/** Capital height over font size of the provisional face; the stylesheet's --sr-cap-names says the same. */
const DEFAULT_CAP_RATIO = 0.688;
const SKIN_NAME = 'Linea';
const GENERIC = 'Turn to seek · one notch · one sentence';
/** With more lines than the reel draws notches (NOTCH_CAP) a notch holds several lines: the line then says only what is true of every notch. */
const GENERIC_SHARED = 'Turn to seek · each notch starts a sentence';

export interface DiscText {
  root: SVGSVGElement;
  update(state: ReelState, lineCount?: number): void;
}

function readNumber(node: Element, name: string): number {
  const view = node.ownerDocument.defaultView;
  const raw = view?.getComputedStyle(node).getPropertyValue(name).trim() ?? '';
  return Number.parseFloat(raw) || 0;
}

interface Line {
  /** CSS variable prefix on the svg: --<key>-r and --<key>-cap, from the artist's anchors. */
  key: string;
  className: string;
  text: SVGTextElement;
  along: SVGTextPathElement;
  path: SVGPathElement;
}

/**
 * The print on the disc, as engraved in the approved render: the skin's name, the video's own title with the
 * sentence count, and a generic seeking line, each live text on an arc at the approved radius and capital height.
 * It is decoration, hidden from assistive technology (the reel's value text and the status region carry the
 * information), so the 12 px minimum for functional text does not apply to it. With no title the middle line
 * says only the count; before the count is final, nothing.
 */
export function buildDiscText(host: HTMLElement, signal: AbortSignal, title: string): DiscText {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'sr-disc');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const make = (key: string, className: string): Line => {
    const path = document.createElementNS(SVG, 'path');
    const id = uid('sr-arc');
    path.setAttribute('id', id);
    path.setAttribute('fill', 'none');
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('class', className);
    const along = document.createElementNS(SVG, 'textPath');
    along.setAttribute('href', `#${id}`);
    along.setAttribute('startOffset', '50%');
    along.setAttribute('text-anchor', 'middle');
    text.append(along);
    svg.append(path, text);
    return { key, className, text, along, path };
  };
  const name = make('arc-name', 'sr-disc-name');
  const middle = make('arc-title', 'sr-disc-title');
  const generic = make('arc-generic', 'sr-disc-generic');
  // Smoked glass only (hidden on silver by look-smoked.css): the line count engraved over the top of the name band, upright.
  const countLine = make('arc-count', 'sr-disc-count');
  name.along.textContent = SKIN_NAME.toUpperCase();
  generic.along.textContent = GENERIC.toUpperCase();
  const shown = title.trim().slice(0, TITLE_MAX).toUpperCase();
  let candidates: string[] = [];
  const lengths = new Map<Line, number>();

  function fit(): void {
    const discMm = readNumber(svg, '--disc') * 2 || 148;
    const half = discMm / 2;
    svg.setAttribute('viewBox', `${-half} ${-half} ${discMm} ${discMm}`);
    const a = (ARC_HALF_DEGREES * Math.PI) / 180;
    for (const line of [name, middle, generic]) {
      const radius = readNumber(svg, `--${line.key}-r`) || 36;
      const cap = readNumber(svg, `--${line.key}-cap`) || 1.7;
      const x = radius * Math.sin(a);
      const y = radius * Math.cos(a);
      line.path.setAttribute('d', `M ${-x.toFixed(2)} ${y.toFixed(2)} A ${radius} ${radius} 0 1 0 ${x.toFixed(2)} ${y.toFixed(2)}`);
      line.text.setAttribute('font-size', (cap / DEFAULT_CAP_RATIO).toFixed(2));
      lengths.set(line, radius * ((ARC_SPAN_DEGREES * Math.PI) / 180));
    }
    const top = readNumber(svg, '--arc-count-r') || 36;
    countLine.path.setAttribute('d', `M ${-top} 0 A ${top} ${top} 0 0 1 ${top} 0`);
    countLine.text.setAttribute('font-size', ((readNumber(svg, '--arc-count-cap') || 1.7) / DEFAULT_CAP_RATIO).toFixed(2));
    choose();
  }

  /** The longest wording of the middle line that fits its arc: title and count, then the count, then nothing. */
  function choose(): void {
    const room = lengths.get(middle) ?? 0;
    let pick = '';
    for (const candidate of candidates) {
      middle.along.textContent = candidate;
      const length = typeof middle.text.getComputedTextLength === 'function' ? middle.text.getComputedTextLength() : 0;
      if (length <= room || room === 0) { pick = candidate; break; }
    }
    middle.along.textContent = pick;
  }

  if (typeof ResizeObserver === 'function') {
    const watcher = new ResizeObserver(fit);
    watcher.observe(host);
    signal.addEventListener('abort', () => watcher.disconnect(), { once: true });
  }
  fit();
  // The line is measured in the face that draws it, so measure again once the fonts are in.
  void host.ownerDocument.fonts?.ready.then(() => { if (!signal.aborted) fit(); });

  let last = '';
  function update(s: ReelState, lineCount = 0): void {
    const count = s.ready && s.totalKnown && s.count > 0 ? `${s.count} ${s.count === 1 ? 'sentence' : 'sentences'}`.toUpperCase() : '';
    const line = [shown, count].filter(Boolean).join(' · ');
    // Known as soon as the caption list is in, before the media can play, so the engraving is there at rest.
    const n = s.totalKnown && s.count > 0 ? s.count : lineCount;
    const lines = n > 0 ? `${n} ${n === 1 ? 'line' : 'lines'} · one notch each`.toUpperCase() : '';
    if (countLine.along.textContent !== lines) countLine.along.textContent = lines;
    const seek = (n > NOTCH_CAP ? GENERIC_SHARED : GENERIC).toUpperCase();
    if (generic.along.textContent !== seek) generic.along.textContent = seek;
    if (line === last) return;
    last = line;
    candidates = [line, count, shown].filter((c, i, all) => c && all.indexOf(c) === i);
    choose();
  }
  return { root: svg, update };
}
