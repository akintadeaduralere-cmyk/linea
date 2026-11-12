import type { FrameLoop } from './frame-loop.ts';
import type { MediaEventType } from './media-events.ts';
import type { PlayRequest } from './play-request.ts';
import type { WaitGuard } from './wait.ts';

export interface ReactionTargets {
  playReq: PlayRequest;
  wait: WaitGuard;
  loop: FrameLoop;
  /** Playback works: a media error or a failed play shown earlier no longer applies. */
  recover(): void;
}

/** What the player does for each media event, in one place. The caller emits afterwards. */
export function reactToMedia(type: MediaEventType, t: ReactionTargets): void {
  t.playReq.onEvent(type);
  switch (type) {
    case 'play':
    case 'playing':
      t.recover();
      t.wait.release();
      t.wait.arm();
      t.loop.start();
      break;
    case 'seeking':
      if (!t.wait.isOwnSeek()) t.wait.release();
      break;
    case 'seeked':
      t.wait.clearOwnSeek();
      t.wait.arm();
      break;
    case 'timeupdate':
      t.wait.check();
      t.recover();
      break;
    case 'canplay':
    case 'loadeddata': t.recover(); break;
    case 'volumechange': t.wait.onSoundChange(); break;
    case 'pause':
    case 'ratechange': t.wait.arm(); break;
    default: break;
  }
}
