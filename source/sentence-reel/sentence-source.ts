import { MIN_TEXT_SENTENCES } from './constants.ts';
import { buildSentences, fallbackSegments } from './sentences.ts';
import type { Cue, Sentence } from './types.ts';

/**
 * Where the reel's sentences come from. Caption cues become sentences, but only once the cue list has
 * settled: cues arrive in batches, so a list built early has the wrong total, and a wrong total must
 * never be shown or announced. When there are no cues, too few, or they cannot be read, equal
 * segments of the duration stand in (time mode); that is never an error message (Words says "No captions
 * available" and the sentence window says so). After the first settle,
 * later growth (or captions arriving late) is published at once.
 */
export class SentenceSource {
  /** The sentences (or segments) now in use. Do not change the array. */
  list: Sentence[] = [];
  /** The captions could not be read at all (none, or an unreadable track): Words has nothing to show. */
  captionsFailed = false;
  private pending: readonly Cue[] | null = null;
  private settledOnce = false;
  private complete = false;
  /** The list came complete from an up-front load: it is final and the live text track no longer changes it. */
  private locked = false;
  private readonly media: HTMLMediaElement;
  private readonly signal: AbortSignal;
  private readonly changed: () => void;
  private destroyed = false;

  constructor(media: HTMLMediaElement, signal: AbortSignal, changed: () => void) {
    this.media = media;
    this.signal = signal;
    this.changed = changed;
    signal.addEventListener('abort', () => { this.destroyed = true; });
  }

  /**
   * True when the sentence total may be shown or announced: the cue list is complete, or the reel is in
   * time mode (equal segments, whose count is known). Until then the reel works but shows no total.
   */
  totalKnown(): boolean {
    return this.list.length > 0 && (this.list[0].synthetic || this.complete);
  }

  /** Use a complete list, final from this first publish. False if it is too short to make a reel. */
  adoptComplete(cues: readonly Cue[]): boolean {
    const built = buildSentences(cues);
    if (built.length < MIN_TEXT_SENTENCES) return false;
    this.locked = true;
    this.complete = true;
    this.settledOnce = true;
    this.list = built;
    this.changed();
    return true;
  }

  setComplete(complete: boolean): void {
    if (this.locked || this.complete === complete) return;
    this.complete = complete;
    this.changed();
  }

  /** Forget the list (a new source, `sentences-src` or language): the reel goes back to loading. */
  reset(): void {
    this.list = [];
    this.pending = null;
    this.complete = false;
    this.locked = false;
    this.settledOnce = false;
    this.captionsFailed = false;
    this.changed();
  }

  /** Let the live text track drive the list again (the up-front load failed). */
  unlock(): void {
    this.locked = false;
    this.complete = false;
    this.settledOnce = false;
  }

  /** A new caption track began to load: hold its cues back until they settle. Current sentences stay meanwhile. */
  beginLoad(): void {
    if (this.locked) return;
    this.settledOnce = false;
    this.pending = null;
  }

  /** Cues arrived (or more of them did). */
  adopt(cues: readonly Cue[]): void {
    if (this.locked) return;
    if (this.settledOnce) this.publish(cues);
    else this.pending = cues;
  }

  /** The cue count stopped growing: the list is final. */
  settled(): void {
    if (this.locked) return;
    this.settledOnce = true;
    if (this.pending) this.publish(this.pending);
    this.pending = null;
  }

  giveUp(): void {
    if (this.locked) return;
    this.settledOnce = true;
    if (this.list.length > 0) return;
    this.captionsFailed = true;
    this.useFallback();
  }

  private publish(cues: readonly Cue[]): void {
    const built = buildSentences(cues);
    if (built.length < MIN_TEXT_SENTENCES) {
      if (this.list.length === 0 || this.list[0].synthetic) this.useFallback();
      return;
    }
    this.list = built;
    this.captionsFailed = false;
    this.changed();
  }

  /** Equal segments, as soon as the duration is known. */
  private useFallback(): void {
    const build = (): boolean => {
      if (this.destroyed || (this.list.length > 0 && !this.list[0].synthetic)) return true;
      const segments = fallbackSegments(this.media.duration);
      if (segments.length === 0) return false;
      this.list = segments;
      this.changed();
      return true;
    };
    if (!build()) this.media.addEventListener('durationchange', () => { build(); }, { once: true, signal: this.signal });
  }
}
