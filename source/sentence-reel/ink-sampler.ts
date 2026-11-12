import type { Clock } from './clock.ts';
import { findVideo } from './cue-guard.ts';

/**
 * The frame-brightness sampler for the etched glass layer (05-design/DIGITAL-SYSTEM.md 3.4).
 * Every etched mark is ink straight on the picture: white ink where the frame behind it is dark enough, graphite ink where it is
 * bright enough, and hidden where neither ink reaches 4.5:1 (no outline, no halo, no backing). The look decides what a mark is;
 * this module only says which ink each registered mark takes, and writes it as `data-ink` ("white", "graphite" or "none") on the mark.
 */

/** The two inks. */
export const WHITE_INK = '#f6f6f2';
export const GRAPHITE_INK = '#0b0c0f';
const INK_CONTRAST = 4.5;
const lumOfHex = (hex: string): number => relativeLuminance(Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16));
/**
 * White ink reaches 4.5:1 against any pixel at or below this relative luminance, graphite ink against any pixel at or above the other one.
 * Both come from the inks' own luminance. (The design note gives 0.183 for white ink; that is the limit for pure white. #f6f6f2 is a little
 * darker, so its limit is 0.166, and 0.183 would give 4.2:1.)
 */
export const WHITE_INK_MAX_LUM = (lumOfHex(WHITE_INK) + 0.05) / INK_CONTRAST - 0.05;
export const GRAPHITE_INK_MIN_LUM = INK_CONTRAST * (lumOfHex(GRAPHITE_INK) + 0.05) - 0.05;
export const SAMPLE_WIDTH = 64;
export const SAMPLE_HEIGHT = 36;
/** Four reads a second while playing. */
export const SAMPLE_INTERVAL_MS = 250;
/** A new ink needs this many agreeing samples in a row (500 ms at four a second). */
export const AGREEING_SAMPLES = 2;

export type Ink = 'white' | 'graphite' | 'none';
/** A mark's box as fractions of the picture (0 to 1). */
export interface Box { x0: number; y0: number; x1: number; y1: number }

/** WCAG relative luminance of an sRGB pixel (0 to 255 per channel). */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The darkest and brightest relative luminance inside a box of an RGBA frame. */
export function boxExtremes(data: ArrayLike<number>, width: number, height: number, box: Box): { min: number; max: number } {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(box.x0 * width)));
  const x1 = Math.max(x0, Math.min(width - 1, Math.ceil(box.x1 * width) - 1));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(box.y0 * height)));
  const y1 = Math.max(y0, Math.min(height - 1, Math.ceil(box.y1 * height) - 1));
  let min = 1; let max = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * width + x) * 4;
      const l = relativeLuminance(data[i], data[i + 1], data[i + 2]);
      if (l < min) min = l;
      if (l > max) max = l;
    }
  }
  return { min, max };
}

/** The ink a box can carry at 4.5:1 or better, or "none" where neither reaches it (mixed or mid-grey). */
export function inkFor(extremes: { min: number; max: number }): Ink {
  if (extremes.max <= WHITE_INK_MAX_LUM) return 'white';
  if (extremes.min >= GRAPHITE_INK_MIN_LUM) return 'graphite';
  return 'none';
}

/** Full ink needs a margin of 9:1, not only 4.5:1, before secondary text on the same mark may be dimmed to 62 percent (coming words in the full screen sentence line). */
export const STRONG_CONTRAST = 9;
export function strongMargin(extremes: { min: number; max: number }, ink: Ink): boolean {
  if (ink === 'white') return extremes.max <= (lumOfHex(WHITE_INK) + 0.05) / STRONG_CONTRAST - 0.05;
  if (ink === 'graphite') return extremes.min >= STRONG_CONTRAST * (lumOfHex(GRAPHITE_INK) + 0.05) - 0.05;
  return false;
}

/** Changes the answer only after AGREEING_SAMPLES samples in a row agree on it, so a passing flash never flips an ink. */
export class InkHysteresis {
  private current: Ink;
  private candidate: Ink | null = null;
  private count = 0;
  constructor(initial: Ink = 'white') { this.current = initial; }
  get ink(): Ink { return this.current; }
  /** Take an answer at once (the first look after a seek or a resize). */
  reset(ink: Ink): void { this.current = ink; this.candidate = null; this.count = 0; }
  push(sample: Ink): Ink {
    if (sample === this.current) { this.candidate = null; this.count = 0; return this.current; }
    if (sample === this.candidate) this.count += 1; else { this.candidate = sample; this.count = 1; }
    if (this.count >= AGREEING_SAMPLES) { this.current = sample; this.candidate = null; this.count = 0; }
    return this.current;
  }
}

/** One frame of the picture, 64 x 36, RGBA. Throws when the picture cannot be read (a cross-origin frame without CORS, Safari's native HLS). */
export interface FrameReader { read(): { data: ArrayLike<number>; width: number; height: number } }

/** The default reader: a small offscreen canvas read often (willReadFrequently keeps it on the CPU). */
export function canvasReader(media: HTMLMediaElement, doc: Document): FrameReader {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  return {
    read() {
      const video = findVideo(media) ?? (media as unknown as HTMLVideoElement);
      canvas ??= Object.assign(doc.createElement('canvas'), { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT });
      ctx ??= canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d canvas');
      ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      return ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    },
  };
}

export interface EtchedMark {
  /** Gets data-ink. */
  el: HTMLElement;
  /** Its box on the picture, as fractions. Called at sample time. Null: skip this round. */
  box: () => Box | null;
}

export interface InkSamplerOptions {
  clock: Clock;
  reader: FrameReader;
  /** Where data-etched="off" goes when the picture cannot be read. */
  host: HTMLElement;
}

/**
 * Samples the picture and sets each mark's ink. `onFrame` is called by whoever already runs per frame (the controller's state emissions);
 * it reads at most four times a second. `sampleNow` is for a seek, a pause, a resize or an ink change.
 * If the picture cannot be read, every mark gets data-ink="none" and the host gets data-etched="off": the title then shows only in the
 * sentence window's resting line, and no mark is ever shown on an unreadable background.
 */
export class InkSampler {
  private readonly opts: InkSamplerOptions;
  private readonly marks = new Map<EtchedMark, InkHysteresis>();
  private lastRead = Number.NEGATIVE_INFINITY;
  private tainted = false;

  constructor(opts: InkSamplerOptions) { this.opts = opts; }

  get unreadable(): boolean { return this.tainted; }

  register(mark: EtchedMark): () => void {
    this.marks.set(mark, new InkHysteresis('white'));
    mark.el.setAttribute('data-ink', this.tainted ? 'none' : 'white');
    return () => { this.marks.delete(mark); };
  }

  onFrame(): void {
    if (this.tainted || this.opts.clock.now() - this.lastRead < SAMPLE_INTERVAL_MS) return;
    this.sampleNow();
  }

  /** `settle` skips the hysteresis (first look at a frame after a seek, a resize or a new mark): there is no earlier ink to protect. */
  sampleNow(settle = false): void {
    if (this.tainted) return;
    this.lastRead = this.opts.clock.now();
    let frame: ReturnType<FrameReader['read']>;
    try { frame = this.opts.reader.read(); } catch { this.taint(); return; }
    for (const [mark, hyst] of this.marks) {
      const box = mark.box();
      if (!box) continue;
      const extremes = boxExtremes(frame.data, frame.width, frame.height, box);
      const sample = inkFor(extremes);
      if (settle) hyst.reset(sample);
      const ink = settle ? sample : hyst.push(sample);
      if (mark.el.getAttribute('data-ink') !== ink) mark.el.setAttribute('data-ink', ink);
      const margin = strongMargin(extremes, ink) ? 'strong' : 'weak';
      if (mark.el.getAttribute('data-margin') !== margin) mark.el.setAttribute('data-margin', margin);
    }
  }

  private taint(): void {
    this.tainted = true;
    this.opts.host.setAttribute('data-etched', 'off');
    for (const mark of this.marks.keys()) mark.el.setAttribute('data-ink', 'none');
  }

  destroy(): void {
    this.marks.clear();
    this.opts.host.removeAttribute('data-etched');
  }
}
