import type { Cue } from './types.ts';

/** The tracks that carry spoken words. Metadata and chapter tracks are left alone. */
export const isCaptionTrack = (t: TextTrack): boolean => t.kind === 'captions' || t.kind === 'subtitles';

/** Caption tracks in preference order: captions first, then subtitles, each in document order. */
export function captionTracks(media: HTMLMediaElement): TextTrack[] {
  const all = Array.from((media.textTracks ?? []) as Iterable<TextTrack>).filter(isCaptionTrack);
  return [...all.filter((t) => t.kind === 'captions'), ...all.filter((t) => t.kind === 'subtitles')];
}

export const cueCount = (track: TextTrack): number => track.cues?.length ?? 0;

/** Read every cue of a track, or null when it has none yet. */
export function readCues(track: TextTrack): Cue[] | null {
  const list = track.cues;
  if (!list || list.length === 0) return null;
  return Array.from(list, (c) => ({ start: c.startTime, end: c.endTime, text: (c as VTTCue).text ?? '' }));
}
