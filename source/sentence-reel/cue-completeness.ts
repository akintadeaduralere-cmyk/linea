import { COMPLETE_TOLERANCE_SECONDS, COVER_SLACK_MIN_SECONDS, COVER_SLACK_SHARE, CUE_SETTLE_MS, SENTENCE_END } from './constants.ts';
import { cleanCueText } from './sentences.ts';

export interface CompletenessInput {
  /** The live track's cues so far. */
  cues: TextTrack['cues'];
  /** The media duration (NaN or 0 when unknown). */
  duration: number;
  /** How long the cue count has held still, in ms. */
  stillMs: number;
  /** True once the long watch for new cues has run out. */
  watchExpired: boolean;
}

/**
 * Is the live cue list complete, so its total may be shown? The rules are in constants.ts: the last cue reaches
 * the end of the media; or it ends a sentence, is near the end, and the list has been still; or nothing new has
 * come for the whole watch.
 */
export function isCueListComplete(i: CompletenessInput): boolean {
  const last = i.cues && i.cues.length > 0 ? i.cues[i.cues.length - 1] : null;
  const known = last !== null && Number.isFinite(i.duration) && i.duration > 0;
  const reachesEnd = known && last.endTime >= i.duration - COMPLETE_TOLERANCE_SECONDS;
  const endsSentence = last !== null && SENTENCE_END.test(cleanCueText((last as VTTCue).text ?? ''));
  const nearEnd = known && last.endTime >= i.duration - Math.max(COVER_SLACK_MIN_SECONDS, i.duration * COVER_SLACK_SHARE);
  return reachesEnd || (i.stillMs >= CUE_SETTLE_MS && endsSentence && nearEnd) || i.watchExpired;
}
