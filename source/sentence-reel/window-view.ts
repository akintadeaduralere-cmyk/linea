import { el, setAttr } from './dom.ts';
import { LABELS } from './labels.ts';
import type { ReelState, WordTiming } from './types.ts';
import { linesPerPageFor, pageOfWord } from './window-fit.ts';
import { activeWordIndex, wordTimings } from './words.ts';


/** Closing punctuation at the end of a sentence. */
const SENTENCE_TAIL = /[.!?…]+["'”’)\]]*$/;

/** What the window measures of its own layout, in px. A seam, so the paging can be tested without a layout engine. */
export interface WindowMetrics {
  width: number;
  sentenceHeight: number;
  lineHeight: number;
  /** Each word's top edge below the sentence's top, in word order. */
  wordTops: number[];
  /** The measured distance between lines (the page step is three of these). Absent in a fake layout: lineHeight is used. */
  linePitch?: number;
  /** The window's face height (the plate's minimum height less its bezel): how much text a page can hold. Absent in a fake layout. */
  faceHeight?: number;
  /** Each word's left edge and width, from the sentence's own left edge, for the underline. Absent in a fake layout. */
  wordLefts?: number[];
  wordWidths?: number[];
}
export type Measure = (root: HTMLElement, sentence: HTMLElement | null, spans: readonly HTMLElement[]) => WindowMetrics;

function faceHeightOf(root: HTMLElement): number {
  const cs = root.ownerDocument.defaultView?.getComputedStyle(root);
  if (!cs) return 0;
  const min = Number.parseFloat(cs.minHeight) || 0;
  return Math.max(0, min - (Number.parseFloat(cs.borderTopWidth) || 0) - (Number.parseFloat(cs.borderBottomWidth) || 0));
}

const linesPerPage = linesPerPageFor;

const measureDom: Measure = (root, sentence, spans) => {
  const css = sentence ? Number.parseFloat(root.ownerDocument.defaultView?.getComputedStyle(sentence).lineHeight ?? '') || 0 : 0;
  const top = sentence?.getBoundingClientRect().top ?? 0;
  const left = sentence?.getBoundingClientRect().left ?? 0;
  // Each word's centre below the sentence's top (the sentence's own transform cancels: both rects move together), from the real line boxes.
  const centres = spans.map((span) => { const r = span.getBoundingClientRect(); return r.top + r.height / 2 - top; });
  // The real line pitch: the median step between the distinct lines the words sit on (the computed line-height when the sentence is one line).
  const lines = [...new Set(centres.map((c) => Math.round(c)))].sort((x, y) => x - y);
  const steps = lines.slice(1).map((v, i) => v - lines[i]).filter((d) => d > 2).sort((x, y) => x - y);
  const pitch = steps.length > 0 ? steps[Math.floor(steps.length / 2)] : css;
  return {
    width: root.clientWidth,
    sentenceHeight: sentence?.offsetHeight ?? 0,
    lineHeight: css,
    wordTops: centres.map((c) => c - (pitch || css) / 2),
    linePitch: pitch || css,
    faceHeight: faceHeightOf(root),
    wordLefts: spans.map((span) => span.getBoundingClientRect().left - left),
    wordWidths: spans.map((span) => span.getBoundingClientRect().width),
  };
};

/**
 * The sentence window: the current sentence as real text, the spoken word marked with data-spoken
 * (the stylesheet underlines it, so the mark is not colour alone). Never a live region.
 */
export class SentenceWindow {
  readonly root = el('div', 'sr-window', { role: 'group', 'aria-label': LABELS.sentenceWindow, dir: 'auto' });
  private shownKey = '';
  private spans: HTMLElement[] = [];
  private timings: WordTiming[] = [];
  private activeWord = -2;
  private underlineEl: HTMLElement | null = null;
  /** The video's own title: what the window says at rest, before any sentence is known. */
  private readonly title: string;

  private readonly measure: Measure;
  /** The last measurement of the whole sentence (line height, each word's top): taken once per sentence change and on a size change, never per tick. */
  private metrics: WindowMetrics | null = null;
  private sentenceWatcher: ResizeObserver | null = null;

  constructor(title = '', measure: Measure = measureDom, picture = false) {
    this.title = title.trim();
    // The full screen caption strip: the same window drawn on the picture, hidden from assistive tech (the one window and the track already speak it).
    if (picture) { this.root.classList.add('sr-strip'); this.root.removeAttribute('role'); this.root.removeAttribute('aria-label'); this.root.setAttribute('aria-hidden', 'true'); }
    this.measure = measure;
    // The ink sampler changes the spoken word's weight (data-ink on this window): the word box changes with it, so the underline is read again, in place.
    if (picture && typeof MutationObserver === 'function') new MutationObserver(() => this.underline(true)).observe(this.root, { attributes: true, attributeFilter: ['data-ink'] });
  }

  private last: ReelState | null = null;
  private note: string | null = null;

  /** Show a short note (a speed, a skip) in the window instead of the sentence; null puts the sentence back. */
  flash(text: string | null): void {
    this.note = text;
    if (text === null) this.shownKey = '';
    if (text !== null) this.plain('note', text);
    else if (this.last) this.update(this.last);
  }

  update(state: ReelState): void {
    this.last = state;
    if (this.note !== null) return;
    setAttr(this.root, 'aria-busy', String(state.loading));
    const s = state.sentence;
    // Between lines, and before the first line is spoken, the window clears, as subtitles do; the sentence stays the reel's current one.
    const between = !!s && !s.synthetic && !state.holding && state.phase !== 'ended' && state.phase !== 'before' && (state.captionsOn || !state.captionsAvailable) && (state.time > s.end + 0.3 || state.time < s.start - 0.15);
    if (between) this.root.setAttribute('data-between', ''); else this.root.removeAttribute('data-between');
    // Words off: the window rests on the film's title in dim dots. The sentence is not lost: it is still spoken, and Words brings it back.
    if (!state.captionsOn && state.captionsAvailable) {
      this.root.setAttribute('data-quiet', '');
      this.plain('quiet', this.title || LABELS.pressPlay);
      return;
    }
    this.root.removeAttribute('data-quiet');
    // Before the first play the window rests on the film's title, as the board shows (the sentence appears when the film plays).
    if (state.phase === 'before' && this.title) { this.plain('rest', this.title); return; }
    if (!s) {
      // Never the words "Loading words" on the display: until sentences exist the window shows the film's title (or the invitation to press Play); aria-busy still says it is working.
      this.plain(state.resting || state.loading ? 'rest' : 'none', state.resting || state.loading ? (this.title || LABELS.pressPlay) : LABELS.noSentence);
      return;
    }
    if (s.synthetic) {
      this.plain(`seg:${s.index}:${state.captionsAvailable}`, state.captionsAvailable ? LABELS.segmentLine(s.index + 1, state.count) : LABELS.noCaptionsWindow);
      return;
    }
    if (this.shownKey !== `text:${s.index}:${s.text}`) this.words(`text:${s.index}:${s.text}`, wordTimings(s));
    // At the end every word is said and none is spoken.
    const active = state.phase === 'ended' ? this.timings.length : state.holding ? this.timings.length - 1 : activeWordIndex(this.timings, state.time);
    if (active === this.activeWord) return;
    this.spans.forEach((span, i) => {
      if (i === active) span.setAttribute('data-spoken', '');
      else span.removeAttribute('data-spoken');
      if (i < active) span.setAttribute('data-said', ''); else span.removeAttribute('data-said');
    });
    this.activeWord = active;
    this.page();
    this.underline();
  }

  private plain(key: string, text: string): void {
    const full = `${key}|${text}`;
    if (this.shownKey === full) return;
    this.shownKey = full;
    this.timings = [];
    this.spans = [];
    this.activeWord = -2;
    const plain = el('p', 'sr-sentence', {}, text);
    this.underlineEl = null;
    this.root.replaceChildren(plain);
    this.watchSentence(plain);
    this.fit();
  }

  private words(key: string, timings: WordTiming[]): void {
    this.shownKey = key;
    this.timings = timings;
    this.activeWord = -2;
    const p = el('p', 'sr-sentence');
    this.spans = timings.map((t, i) => {
      // A full stop at the end of the sentence is not drawn in the window (the board shows none); it stays in the page text for screen readers.
      const tail = i === timings.length - 1 ? SENTENCE_TAIL.exec(t.word) : null;
      const span = el('span', 'sr-word', {}, tail ? t.word.slice(0, tail.index) : t.word);
      if (tail) span.append(el('span', 'sr-stop', {}, tail[0]));
      p.append(span);
      if (i < timings.length - 1) p.append(document.createTextNode(' '));
      return span;
    });
    // The one underline: a thin element under the spoken word, moved by transform only (translate and scale from the measured word box).
    this.underlineEl = el('span', 'sr-ul', { 'aria-hidden': 'true', 'data-off': '' });
    p.append(this.underlineEl);
    this.root.replaceChildren(p);
    this.watchSentence(p);
    this.fit();
  }

  /**
   * Measure the real layout: how many lines the face holds, whether the sentence needs paging, where each word is.
   * Long sentences wrap at the one text size and turn pages by the spoken word, so the window never grows into the keys.
   * Nothing here runs without a layout (a test in jsdom, a hidden player).
   */
  private fit(): void {
    const sentence = this.root.firstElementChild as HTMLElement | null;
    let m = this.measure(this.root, sentence, this.spans);
    if (!m.width) return;
    const perPage = linesPerPage(m);
    const paged = !!sentence && m.lineHeight > 0 && m.sentenceHeight > m.lineHeight * perPage + 1;
    if (this.root.style.getPropertyValue('--sr-page-lines') !== String(perPage)) this.root.style.setProperty('--sr-page-lines', String(perPage));
    // What the face holds beyond whole lines: the window takes it as top padding, so no sliver of the next line shows.
    const slack = m.faceHeight && m.faceHeight > 0 && m.lineHeight > 0 ? Math.max(0, m.faceHeight - perPage * (m.linePitch ?? m.lineHeight)) : 0;
    this.root.style.setProperty('--sr-slack', `${slack.toFixed(2)}px`);
    if (m.faceHeight) this.root.style.setProperty('--sr-face', `${m.faceHeight.toFixed(2)}px`);
    if (paged) this.root.setAttribute('data-paged', ''); else this.root.removeAttribute('data-paged');
    // Paging is decided from the measured line boxes, so it holds at every width: the page is the block of lines that holds the spoken word.
    this.metrics = m = this.measure(this.root, sentence, this.spans);
    this.page();
    this.underline(true);
  }

  /** Show the page of lines that holds the spoken word (the first word while none is spoken; page 0 when the sentence is not paged). */
  private page(): void {
    let page = 0;
    const m = this.metrics;
    if (m && this.root.hasAttribute('data-paged') && this.spans.length > 0) {
      page = pageOfWord(m.wordTops[Math.min(this.spans.length - 1, Math.max(0, this.activeWord))] ?? 0, m.linePitch ?? m.lineHeight, linesPerPage(m));
    }
    if (this.root.style.getPropertyValue('--sr-page') !== String(page)) this.root.style.setProperty('--sr-page', String(page));
  }

  /**
   * Put the one underline under the spoken word. Only transform changes (translateX, translateY, scaleX from the measured word box);
   * a new sentence or a re-fit places it without the glide. Hidden while no word is spoken. Reduced motion: the stylesheet removes the glide.
   */
  private underline(jump = false): void {
    const ul = this.underlineEl;
    const m = this.metrics;
    if (!ul) return;
    const i = this.activeWord;
    let left = m?.wordLefts?.[i]; let width = m?.wordWidths?.[i]; const top = m?.wordTops[i];
    // A spoken word can take a heavier weight (the picture line on a light frame), which changes its box after the sentence was measured: read the live box of this one word.
    const span = this.spans[i]; const sentence = span?.parentElement;
    if (span && sentence && typeof span.getBoundingClientRect === 'function' && span.isConnected) {
      const r = span.getBoundingClientRect(); const base = sentence.getBoundingClientRect();
      if (r.width > 0) { left = r.left - base.left; width = r.width; }
    }
    if (i < 0 || left === undefined || width === undefined || top === undefined || !(width > 0)) { ul.setAttribute('data-off', ''); return; }
    const pitch = m?.linePitch ?? m?.lineHeight ?? 0;
    const place = jump || ul.hasAttribute('data-off');
    if (place) ul.setAttribute('data-jump', '');
    ul.removeAttribute('data-off');
    ul.style.setProperty('--ul-x', `${left.toFixed(2)}px`);
    ul.style.setProperty('--ul-y', `${(top + pitch).toFixed(2)}px`);
    ul.style.setProperty('--ul-w', width.toFixed(2));
    if (place) { void ul.offsetWidth; ul.removeAttribute('data-jump'); }
  }

  /** Re-fit when the sentence changes size by itself (the dot face finishing its load, a zoom change, a font fallback): the size change is reported without forcing a layout. */
  private watchSentence(p: HTMLElement): void {
    if (typeof ResizeObserver !== 'function') return;
    this.sentenceWatcher ??= new ResizeObserver((entries) => {
      const h = entries[entries.length - 1]?.contentRect.height ?? 0;
      if (this.metrics && Math.abs(h - this.metrics.sentenceHeight) > 1) this.fit();
    });
    this.sentenceWatcher.disconnect();
    this.sentenceWatcher.observe(p);
  }

  /** Re-plan when the window's width changes (resize, rotation, zoom, full screen). */
  watch(signal: AbortSignal): void {
    if (typeof ResizeObserver !== 'function') return;
    let width = 0;
    const watcher = new ResizeObserver(() => {
      if (this.root.clientWidth === width) return;
      width = this.root.clientWidth;
      this.fit();
    });
    watcher.observe(this.root);
    signal.addEventListener('abort', () => { watcher.disconnect(); this.sentenceWatcher?.disconnect(); }, { once: true });
  }
}
