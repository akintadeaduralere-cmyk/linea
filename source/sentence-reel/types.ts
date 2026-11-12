import type { Clock } from './clock.ts';
import type { CompleteOptions } from './complete-captions.ts';
import type { CueGuard } from './cue-guard.ts';

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface Sentence {
  index: number;
  start: number;
  end: number;
  text: string;
  /** True when the sentence is an equal segment with no caption text behind it (time mode). */
  synthetic: boolean;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export type Phase = 'before' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';

export interface ReelState {
  /** Sentences (or equal segments) exist, so the reel can move. */
  ready: boolean;
  /** Waiting for caption cues and no sentences yet. */
  loading: boolean;
  /** Nothing is known yet and nothing has been asked for: the player is at rest, not loading. */
  resting: boolean;
  count: number;
  /** The total may be shown and announced. False while the cue list may still grow: "Sentence 3", no "of N". */
  totalKnown: boolean;
  /** Sentence being shown. While Wait is holding at a sentence end, this is the sentence just finished. */
  index: number;
  /** 0 to 1 inside the shown sentence. */
  progress: number;
  paused: boolean;
  /** The film has played to its end. */
  ended: boolean;
  /** Playback failed (the media error or a refused play); the hub offers Retry until the viewer retries or closes the message. */
  failed: boolean;
  /** One word for the whole player's situation, for the look to style (written as data-phase on the player). */
  phase: Phase;
  /** Play was requested (or the media stalled) and it is not playing yet: the Play control says Loading. */
  buffering: boolean;
  time: number;
  duration: number;
  /** Seconds buffered from the playhead's range, or null where the media does not say (then nothing is drawn as unbuffered). */
  bufferedTo: number | null;
  /** Words: captions are showing on the film. */
  captionsOn: boolean;
  /** A caption track exists, so Words can do something. */
  captionsAvailable: boolean;
  wait: boolean;
  holding: boolean;
  muted: boolean;
  volume: number;
  /** 0 (off) to 5. */
  level: number;
  /** False where scripts cannot set the volume (iPhone). */
  volumeSettable: boolean;
  fullscreen: boolean;
  /** Message to show the viewer, or empty. */
  message: string;
  sentence: Sentence | null;
  /** Another sentence exists after the shown one. */
  canNext: boolean;
  /** Counts user moves between sentences, so views can tell a move from plain playback. */
  navCount: number;
}

export type Listener = (state: ReelState) => void;

/** Where a move between sentences came from. */
export type NavSource = 'again' | 'next' | 'previous' | 'reel' | 'language';

export interface Navigation {
  source: NavSource;
  /** The sentence shown before the move. When it equals `index` the reel's own value did not change. */
  from: number;
  index: number;
  count: number;
  totalKnown: boolean;
  sentence: Sentence | null;
}

export interface ReelOptions {
  clock?: Clock;
  doc?: Document;
  /** Skip the check and say whether scripts can set the volume. */
  volumeSettable?: boolean;
  guard?: CueGuard;
  /** Where the etched glass layer reads the picture's brightness from (default: a 64 x 36 canvas). A test seam. */
  frameReader?: import('./ink-sampler.ts').FrameReader;
  /** Use the re-exported ember parts with their shade and spec layers (data-ember-layers on the player). On by default (owner approved board F); turn off with `emberLayers: false` or `reel-ember-layers="off"`. */
  emberLayers?: boolean;
  /** Add the settings drawer (speed, words, quality, outputs). On by default (board F); turn off with `drawer: false` or `reel-drawer="off"`. */
  drawer?: boolean;
  /** Fetches the drawer's art on the first pull. */
  loadDrawerArt?: () => Promise<void>;
  /** A complete WebVTT file to take the sentences from (the `sentences-src` attribute). */
  sentencesSrc?: string;
  /** fetch, for the up-front caption load (default: the page's own). */
  fetchFn?: CompleteOptions['fetchFn'];
  loadTimeoutMs?: number;
  /** Fetch the complete captions as soon as the player exists, not on intent (off by default). */
  eagerLoad?: boolean;
  /** The video's own title, drawn live on the disc beside the sentence count (the `reel-title` attribute). */
  title?: string;
}
