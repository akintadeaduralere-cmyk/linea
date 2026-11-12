import { findVideo } from './cue-guard.ts';
import { castSdkApplies, connectCast, type CastLink } from './cast-sdk.ts';

/**
 * Outputs: picture-in-picture, AirPlay and Cast (owner, 12 Nov 2026: viewers without Safari need Google's casting too).
 * Cast uses the standard Remote Playback API (Chrome and Edge on desktop and Android route it to Google Cast); it is not offered where
 * WebKit's AirPlay picker exists, since there the same API is AirPlay. Picture in picture uses the standard API
 * where the browser has it and WebKit's presentation mode otherwise (Safari); AirPlay is WebKit's playback target.
 * This is the same set of calls Video.js' own pip core makes; the module works on the media element so it needs no store.
 */
export interface OutputStatus { available: boolean; active: boolean }

type WebkitVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

export class Outputs {
  private readonly video: WebkitVideo;
  private readonly doc: Document;
  private readonly onChange: () => void;
  private airplayAvailable = false;
  private castAvailable = false;
  private sdk: CastLink | null = null;

  constructor(media: HTMLMediaElement, doc: Document, signal: AbortSignal, onChange: () => void) {
    this.video = (findVideo(media) ?? media) as WebkitVideo;
    this.doc = doc;
    this.onChange = onChange;
    const opts = { signal };
    const v = this.video;
    for (const type of ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged', 'webkitcurrentplaybacktargetiswirelesschanged', 'loadedmetadata'] as const) {
      v.addEventListener(type, () => this.onChange(), opts);
    }
    // WebKit says whether a playback target (an AirPlay receiver) is in range; it only reports after a listener exists.
    v.addEventListener('webkitplaybacktargetavailabilitychanged', (e) => {
      this.airplayAvailable = (e as Event & { availability?: string }).availability === 'available';
      this.onChange();
    }, opts);
    // Remote playback (Cast): the browser reports receivers in range; it refuses to watch on some sources (MSE streams), which leaves it unavailable.
    const win = doc.defaultView;
    if (win && castSdkApplies(win)) this.sdk = connectCast(win, () => this.onChange());
    const remote = (v as HTMLVideoElement & { remote?: RemotePlaybackLike }).remote;
    if (!this.sdk && remote && typeof v.webkitShowPlaybackTargetPicker !== 'function') {
      remote.watchAvailability?.((on: boolean) => { this.castAvailable = on; this.onChange(); }).catch(() => { this.castAvailable = false; this.onChange(); });
      for (const type of ['connect', 'connecting', 'disconnect']) remote.addEventListener?.(type, () => this.onChange(), opts);
    }
  }

  get cast(): OutputStatus {
    if (this.sdk) return { available: this.sdk.available, active: this.sdk.active };
    const remote = (this.video as HTMLVideoElement & { remote?: RemotePlaybackLike }).remote;
    return { available: this.castAvailable && !!remote, active: remote?.state === 'connected' || remote?.state === 'connecting' };
  }

  /** Open the browser's cast picker (Google Cast in Chrome and Edge). */
  showCast(): void {
    if (this.sdk) { this.sdk.open(this.video); return; }
    const remote = (this.video as HTMLVideoElement & { remote?: RemotePlaybackLike }).remote;
    try { void remote?.prompt?.().catch(() => { /* dismissed or refused */ }); } catch { /* refused */ }
  }

  get pip(): OutputStatus {
    const v = this.video;
    const standard = !!this.doc.pictureInPictureEnabled && typeof v.requestPictureInPicture === 'function' && !v.disablePictureInPicture;
    const webkit = typeof v.webkitSupportsPresentationMode === 'function' && safe(() => v.webkitSupportsPresentationMode?.('picture-in-picture') === true);
    const active = this.doc.pictureInPictureElement === v || v.webkitPresentationMode === 'picture-in-picture';
    return { available: standard || webkit, active };
  }

  get airplay(): OutputStatus {
    const v = this.video;
    return { available: this.airplayAvailable && typeof v.webkitShowPlaybackTargetPicker === 'function', active: v.webkitCurrentPlaybackTargetIsWireless === true };
  }

  /** Enter or leave picture in picture. A refusal (no user gesture, a policy) is not an error the viewer can act on: the button just stays as it was. */
  async togglePip(): Promise<void> {
    const v = this.video;
    try {
      if (this.pip.active) {
        if (this.doc.pictureInPictureElement === v) await this.doc.exitPictureInPicture();
        else v.webkitSetPresentationMode?.('inline');
      } else if (this.doc.pictureInPictureEnabled && typeof v.requestPictureInPicture === 'function' && !v.disablePictureInPicture) {
        await v.requestPictureInPicture();
      } else {
        v.webkitSetPresentationMode?.('picture-in-picture');
      }
    } catch { /* refused */ }
    this.onChange();
  }

  /** Open the system's AirPlay picker. */
  showAirPlay(): void {
    try { this.video.webkitShowPlaybackTargetPicker?.(); } catch { /* refused */ }
  }
}

interface RemotePlaybackLike {
  state?: string;
  watchAvailability?: (cb: (available: boolean) => void) => Promise<number>;
  prompt?: () => Promise<void>;
  addEventListener?: (type: string, fn: () => void, opts?: AddEventListenerOptions) => void;
}

function safe(fn: () => boolean): boolean { try { return fn(); } catch { return false; } }
