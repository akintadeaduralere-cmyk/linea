import type { CaptionHandlers } from './captions.ts';
import type { CompleteCaptions } from './complete-captions.ts';
import type { SentenceSource } from './sentence-source.ts';

/**
 * What the live text track's events do. They go through the complete-captions gate: held while the full list
 * is on its way, dropped once it is final, passed on if the up-front load failed. Choosing another
 * subtitles track rebuilds the list for that language.
 */
export function liveCaptionHandlers(
  source: SentenceSource,
  complete: CompleteCaptions,
  ui: { words(on: boolean): void; loading(loading: boolean): void },
): CaptionHandlers {
  return {
    onCues: (cues) => { complete.observeLive(cues); complete.gate(() => source.adopt(cues)); },
    onSettled: () => complete.gate(() => source.settled()),
    onComplete: (done) => complete.gate(() => source.setComplete(done)),
    onGiveUp: () => complete.gate(() => source.giveUp()),
    onTrackChosen: (track, followLive) => complete.choose(track, followLive),
    onWords: ui.words,
    onLoading: (loading) => {
      if (loading) complete.gate(() => source.beginLoad());
      ui.loading(loading);
    },
  };
}
