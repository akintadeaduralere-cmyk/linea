/**
 * Google Cast through Google's official Web Sender SDK (owner, 12 Nov 2026: a Google TV is found by Chrome's Cast SDK but not by the
 * browser's generic remote playback). Loaded only in Chromium browsers off iOS, only once, and only from Google's own address.
 * The TV plays the film itself from its address (the Default Media Receiver), so the film must be at an address the TV can reach.
 */
const SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

type CastWindow = Window & {
  __onGCastApiAvailable?: (ok: boolean) => void;
  cast?: { framework?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  chrome?: { cast?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export interface CastLink { available: boolean; active: boolean; open(media: HTMLMediaElement): void }

let loading: Promise<boolean> | null = null;

/** True where the SDK can work: a Chromium browser that is not on iOS (iPhone browsers are WebKit, which has no Cast). */
export function castSdkApplies(win: Window): boolean {
  const ua = win.navigator.userAgent;
  return /Chrome\//.test(ua) && !/iPhone|iPad|iPod/.test(ua) && typeof win.document?.createElement === 'function';
}

function load(win: CastWindow): Promise<boolean> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    if (win.cast?.framework) { resolve(true); return; }
    win.__onGCastApiAvailable = (ok) => resolve(ok);
    const s = win.document.createElement('script');
    s.src = SDK_URL; s.async = true; s.onerror = () => resolve(false);
    win.document.head.append(s);
  });
  return loading;
}

/** Start the SDK and report device availability to `changed`. Returns a link whose fields stay current. */
export function connectCast(win: CastWindow, changed: () => void): CastLink {
  const link: CastLink = { available: false, active: false, open: () => {} };
  void load(win).then((ok) => {
    const fw = win.cast?.framework; const cc = win.chrome?.cast;
    if (!ok || !fw || !cc) return;
    const ctx = fw.CastContext.getInstance();
    ctx.setOptions({ receiverApplicationId: cc.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: cc.AutoJoinPolicy.ORIGIN_SCOPED });
    const update = (): void => {
      const state = ctx.getCastState();
      link.available = state !== fw.CastState.NO_DEVICES_AVAILABLE;
      link.active = state === fw.CastState.CONNECTED;
      changed();
    };
    ctx.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, update);
    update();
    link.open = (media) => {
      void ctx.requestSession().then(() => {
        const session = ctx.getCurrentSession();
        const src = media.currentSrc || media.src;
        if (!session || !src) return;
        const info = new cc.media.MediaInfo(src, /\.m3u8/i.test(src) ? 'application/x-mpegURL' : 'video/mp4');
        const req = new cc.media.LoadRequest(info);
        req.currentTime = media.currentTime;
        void session.loadMedia(req).then(() => media.pause()).catch(() => { /* the TV refused the media */ });
      }).catch(() => { /* picker closed */ });
    };
  });
  return link;
}
