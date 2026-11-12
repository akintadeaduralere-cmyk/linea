import { VALUETEXT_MAX_CHARS, VOLUME_LEVELS } from './constants.ts';
import { formatTime, shorten } from './format.ts';
import type { Sentence } from './types.ts';

/** Every name and hint the controls show or speak, in one place so it can move to Video.js i18n. */
export const LABELS = {
  player: 'Video player',
  controls: 'Controls',
  reel: 'Reel',
  now: 'Now',
  reelHint: 'Turn to move one line at a time',
  play: 'Play',
  pause: 'Pause',
  loading: 'Loading',
  again: 'Repeat',
  againHint: 'Plays this line again. In the first second of a line it goes to the line before.',
  next: 'Next',
  nextHint: 'Goes to the next line',
  words: 'Captions',
  wordsHint: 'Shows or hides captions on the film',
  wordsNone: 'No captions available',
  wait: 'Step',
  waitHint: 'Pauses after each line until you go on',
  waitOn: 'Step on',
  waitOff: 'Step off',
  fullscreen: 'Full screen',
  sound: 'Mute',
  soundHint: 'Mutes or unmutes',
  volume: 'Volume',
  timeline: 'Seek',
  timelineHint: 'Moves through the whole video',
  time: 'Time',
  timeOf: ' of ',
  timeRemaining: 'Time remaining',
  sentenceWindow: 'Current sentence',
  loadingWords: 'Loading words',
  dismiss: 'Close',
  retry: 'Retry',
  replay: 'Replay',
  tryAgain: 'Try again',
  errorTitle: 'This film could not play',
  errorHint: 'Press Retry on the reel \u00b7 Esc closes',
  noSentence: 'Waiting for the video to load.',
  /** The resting line in the sentence window before the first touch, when the video has no title. */
  pressPlay: 'Press play',
  noCaptionsWindow: 'No captions for this video',
  muted: ', muted',
  segmentLine: (n: number, total: number): string => `Part ${n} of ${total}`,
  levelValue: (level: number): string => `Level ${level} of ${VOLUME_LEVELS}`,
  timeValue: (now: string, total: string): string => `${now} of ${total}`,
} as const;

/**
 * "Sentence 13 of 28: text" (cut at a word), or "Segment 13 of 28, 1:12" in time mode. While the total is not
 * known (the cue list may still grow) it is "Sentence 13: text", with no total. Empty for no sentence.
 */
export function sentenceStatus(s: Sentence | null, count: number, totalKnown = true): string {
  if (!s) return '';
  const n = s.index + 1;
  if (s.synthetic) return `Segment ${n} of ${count}, ${formatTime(s.start)}`;
  const of = totalKnown ? ` of ${count}` : '';
  return `Sentence ${n}${of}: ${shorten(s.text, VALUETEXT_MAX_CHARS)}`;
}
