/**
 * Some engines (HLS through hls.js) only load caption cues while the track is "showing". The guard
 * hides the browser's own caption drawing for that short time, so nothing flashes on the film.
 * It is scoped to this player's own <video> by an attribute, so no other video on the page is touched.
 */
export interface CueGuard {
  engage(): void;
  release(): void;
}

export const GUARD_ATTRIBUTE = 'data-sr-guard';

type StyleRoot = Document | ShadowRoot;
let counter = 0;

function guardCss(id: string, attribute: string): string {
  const v = `video[${attribute}="${id}"]`;
  return `${v}::cue{opacity:0 !important;visibility:hidden !important;}${v}::-webkit-media-text-track-container{visibility:hidden !important;}`;
}

/** The real <video> behind a media element: itself, or inside its open shadow root, or a child. Null if none. */
export function findVideo(media: HTMLMediaElement): HTMLVideoElement | null {
  try {
    const found = media.shadowRoot?.querySelector('video') ?? (media.tagName === 'VIDEO' ? media : media.querySelector?.('video'));
    return (found as HTMLVideoElement | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * A guard that marks this player's video and adds one stylesheet, in the tree that holds the video,
 * that matches only that mark. A constructed sheet is used where supported (works under a strict
 * style-src policy); a <style> element is the fallback. With no video to scope to, or if the sheet
 * cannot be added, the guard does nothing: the cost is a possible brief caption flash, never a page-wide change.
 */
export function createCueGuard(media: HTMLMediaElement, attribute: string = GUARD_ATTRIBUTE): CueGuard {
  let sheet: CSSStyleSheet | null = null;
  let style: HTMLStyleElement | null = null;
  let root: StyleRoot | null = null;
  let video: HTMLVideoElement | null = null;

  return {
    engage(): void {
      if (video) return;
      const target = findVideo(media);
      if (!target) return;
      counter += 1;
      const id = String(counter);
      try {
        root = target.getRootNode() as StyleRoot;
        const css = guardCss(id, attribute);
        if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
          sheet = new CSSStyleSheet();
          sheet.replaceSync(css);
          root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        } else {
          const doc = root.nodeType === 9 ? (root as Document) : (root as ShadowRoot).ownerDocument;
          style = doc.createElement('style');
          style.textContent = css;
          (root.nodeType === 9 ? (root as Document).head : root).append(style);
        }
        target.setAttribute(attribute, id);
        video = target;
      } catch {
        sheet = null;
        style = null;
      }
    },
    release(): void {
      try {
        if (sheet && root && 'adoptedStyleSheets' in root) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
        style?.remove();
        video?.removeAttribute(attribute);
      } catch {
        // The sheet is already gone with its tree.
      }
      sheet = null;
      style = null;
      video = null;
    },
  };
}
