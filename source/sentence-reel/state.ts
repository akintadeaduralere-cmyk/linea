import { VOLUME_LEVELS } from './constants.ts';
import { indexAt, progressIn } from './sentences.ts';
import { MESSAGES } from './constants.ts';
import type { Phase, ReelState, Sentence } from './types.ts';

export interface StateInputs {
  media: HTMLMediaElement;
  sentences: readonly Sentence[];
  /** Sentence Wait is holding at, or -1. */
  held: number;
  words: boolean;
  captionsAvailable: boolean;
  wait: boolean;
  waiting: boolean;
  message: string;
  volumeSettable: boolean;
  fullscreen: boolean;
  navCount: number;
  totalKnown: boolean;
  buffering: boolean;
  /** At rest: waiting for intent, so nothing has been fetched. */
  resting?: boolean;
}

/** The end of the buffered range that holds the playhead, or null when the media reports no ranges. */
function bufferedEnd(media: HTMLMediaElement, t: number): number | null {
  try {
    const b = media.buffered;
    if (!b || b.length === 0) return null;
    for (let i = 0; i < b.length; i += 1) if (t >= b.start(i) - 0.5 && t <= b.end(i) + 0.5) return b.end(i);
    return b.end(b.length - 1) < t ? b.end(b.length - 1) : null;
  } catch { return null; }
}

/**
 * At the end of the film: the browser says ended, or the playhead has reached the last buffered picture within END_SLACK_S of the
 * stated length (12 Nov 2026: a stream whose audio and video differ by a fraction of a second stalled at 12:14.0 of 12:14.25 for ever,
 * so "ended" never fired and the end screen never came). Real streams often differ like this; a skin must not hang on them.
 */
const END_SLACK_S = 0.5;
export function atEnd(media: HTMLMediaElement): boolean {
  if (media.ended) return true;
  const d = media.duration, t = media.currentTime || 0;
  if (!Number.isFinite(d) || d <= 0 || d - t > END_SLACK_S) return false;
  const end = bufferedEnd(media, t);
  return end !== null && end >= d - END_SLACK_S && t >= end - 0.15 && media.readyState < 3;
}

/** Read the media element and the controller's flags into one immutable snapshot. */
export function buildState(i: StateInputs): ReelState {
  const { media, sentences, held } = i;
  const count = sentences.length;
  const t = media.currentTime || 0;
  const index = held >= 0 ? held : Math.max(0, indexAt(sentences, t));
  const sentence = count > 0 ? sentences[index] : null;
  const failed = i.message === MESSAGES.mediaError || i.message === MESSAGES.playFailed;
  const ended = atEnd(media);
  const phase: Phase = failed ? 'error' : ended ? 'ended' : i.buffering ? 'buffering' : !media.paused ? 'playing' : t > 0 ? 'paused' : 'before';
  return {
    ready: count > 0,
    ended,
    failed,
    phase,
    // At rest (nothing asked for yet) the player is not loading, whatever the live track is doing.
    loading: i.waiting && count === 0 && !(i.resting && count === 0),
    resting: !!i.resting && count === 0,
    count,
    totalKnown: i.totalKnown,
    index,
    progress: sentence ? (held >= 0 ? 1 : progressIn(sentence, t)) : 0,
    paused: media.paused,
    buffering: i.buffering,
    time: t,
    bufferedTo: bufferedEnd(media, t),
    duration: Number.isFinite(media.duration) ? media.duration : 0,
    captionsOn: i.words,
    captionsAvailable: i.captionsAvailable,
    wait: i.wait,
    holding: held >= 0,
    muted: media.muted,
    volume: media.volume,
    level: media.muted ? 0 : Math.round(media.volume * VOLUME_LEVELS),
    volumeSettable: i.volumeSettable,
    fullscreen: i.fullscreen,
    message: i.message,
    sentence,
    canNext: count > 0 && index < count - 1,
    navCount: i.navCount,
  };
}
