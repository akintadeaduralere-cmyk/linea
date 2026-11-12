/** Where browsers differ: read-only volume (iPhone) and native full screen. */

/** The probe moves the volume by this much, toward the middle, then puts it back. */
const PROBE_STEP = 0.25;
const PROBE_MIDPOINT = 0.5;
const VOLUME_TOLERANCE = 1e-3;

/** True when a script can change the volume. iOS Safari ignores the assignment. */
export function probeVolumeSettable(media: HTMLMediaElement): boolean {
  try {
    const original = media.volume;
    const probe = original > PROBE_MIDPOINT ? original - PROBE_STEP : original + PROBE_STEP;
    media.volume = probe;
    const ok = Math.abs(media.volume - probe) < VOLUME_TOLERANCE;
    media.volume = original;
    return ok;
  } catch {
    return false;
  }
}

/** iPhone, iPod, iPad (including iPadOS, which reports as a Mac with a touch screen). */
export function isIosLike(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

export interface NativeVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
}

/** The real <video> behind a media element: itself, or inside its shadow root, or a child. */
export function nativeVideo(media: HTMLMediaElement): NativeVideo | null {
  const direct = media as Partial<NativeVideo>;
  if (typeof direct.webkitEnterFullscreen === 'function') return media as NativeVideo;
  try {
    const inner = media.shadowRoot?.querySelector('video') ?? media.querySelector?.('video') ?? null;
    return (inner as NativeVideo | null) ?? (media.tagName === 'VIDEO' ? (media as NativeVideo) : null);
  } catch {
    return null;
  }
}
