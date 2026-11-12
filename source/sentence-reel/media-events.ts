import { nativeVideo } from './platform.ts';

export const MEDIA_EVENTS = [
  'play', 'playing', 'pause', 'seeking', 'seeked', 'timeupdate', 'ratechange',
  'volumechange', 'durationchange', 'loadedmetadata', 'loadeddata', 'canplay', 'waiting', 'stalled', 'ended', 'progress',
] as const;

export type MediaEventType = (typeof MEDIA_EVENTS)[number];

export interface MediaEventSink {
  onMedia(type: MediaEventType): void;
  onError(): void;
  /** The page's full screen changed, or the video's own player opened (true) or closed (false). */
  onFullscreen(nativePlayer?: boolean): void;
}

/** Listen to a media element, the document's full screen events and the device's own video player. All tied to `signal`. */
export function bindMediaEvents(media: HTMLMediaElement, doc: Document, signal: AbortSignal, sink: MediaEventSink): void {
  for (const type of MEDIA_EVENTS) media.addEventListener(type, () => sink.onMedia(type), { signal });
  media.addEventListener('error', () => sink.onError(), { signal });
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) doc.addEventListener(type, () => sink.onFullscreen(), { signal });
  const video = nativeVideo(media);
  for (const target of new Set<EventTarget>([media, ...(video ? [video] : [])])) {
    target.addEventListener('webkitbeginfullscreen', () => sink.onFullscreen(true), { signal });
    target.addEventListener('webkitendfullscreen', () => sink.onFullscreen(false), { signal });
  }
}
