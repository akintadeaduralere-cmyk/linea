import type { Clock } from './clock.ts';
import { nativeVideo } from './platform.ts';

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export interface FullscreenDeps {
  doc: Document;
  root: HTMLElement;
  media: HTMLMediaElement;
  /** The video is in the device's own full-screen player (iPhone). */
  nativeActive: boolean;
}

/** The element the page is showing full screen, with the old WebKit name as a fallback. */
export function fullscreenElementOf(doc: Document): Element | null {
  const d = doc as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/**
 * Enter or leave full screen. The player container is tried first (so the skin stays on screen);
 * where the browser has no element full screen (iPhone Safari) the video's own player is used.
 * Returns false when nothing could be done.
 */
export async function toggleFullscreen(d: FullscreenDeps): Promise<boolean> {
  const doc = d.doc as FsDocument;
  const root = d.root as FsElement;
  const native = nativeVideo(d.media);

  if (fullscreenElementOf(d.doc)) {
    const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
    if (!exit) return false;
    await exit.call(doc);
    return true;
  }
  if (d.nativeActive) {
    if (!native?.webkitExitFullscreen) return false;
    native.webkitExitFullscreen();
    return true;
  }
  const enabled = doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
  if (enabled) {
    try {
      if (typeof root.requestFullscreen === 'function') await root.requestFullscreen();
      else if (typeof root.webkitRequestFullscreen === 'function') await root.webkitRequestFullscreen();
      else throw new Error('no element full screen');
      return true;
    } catch {
      // Fall through to the video's own player.
    }
  }
  if (native?.webkitEnterFullscreen) {
    try {
      native.webkitEnterFullscreen();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** toggleFullscreen, but a browser that never answers (or throws) counts as a refusal after `timeoutMs`. */
export async function toggleFullscreenOrRefuse(d: FullscreenDeps, clock: Clock, timeoutMs: number): Promise<boolean> {
  let timer: unknown = null;
  const refused = new Promise<boolean>((resolve) => { timer = clock.setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([toggleFullscreen(d), refused]);
  } catch {
    return false;
  } finally {
    if (timer !== null) clock.clearTimeout(timer);
  }
}
