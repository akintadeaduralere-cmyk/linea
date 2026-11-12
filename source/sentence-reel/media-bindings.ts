import { SPEEDS } from './constants.ts';
import { captionTracks } from './cues.ts';

/** The playback rates Video.js offers (its default list), the same list as the keys. The speed dial rests only on these. */
export const PLAYBACK_RATES: readonly number[] = SPEEDS;

/** The rate in the list nearest to `rate`. */
export function nearestRate(rate: number): number {
  return PLAYBACK_RATES.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best), PLAYBACK_RATES[0]);
}

/** The rate one step up (1) or down (-1) in the list from the nearest listed rate, held at the ends. */
export function stepRate(rate: number, direction: 1 | -1): number {
  const at = PLAYBACK_RATES.indexOf(nearestRate(rate));
  return PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, Math.max(0, at + direction))];
}

export const rateText = (rate: number): string => `${Number(rate.toFixed(2))} times speed`;

export interface RenditionOption { id: string; height: number; label: string; bitrate?: number }

interface RenditionLike { id?: string; height?: number; selected?: boolean; enabled?: boolean }
type RenditionList = ArrayLike<RenditionLike> & { selectedIndex?: number; addEventListener?: EventTarget['addEventListener'] };
const listOf = (media: HTMLMediaElement): RenditionList | null => (media as unknown as { videoRenditions?: RenditionList }).videoRenditions ?? null;

/** The renditions the media offers (Mux and HLS media expose `videoRenditions`), tallest first. Empty where the browser plays the stream natively. */
const STANDARD_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240] as const;

export function renditionsOf(media: HTMLMediaElement): RenditionOption[] {
  const list = listOf(media);
  if (!list) return [];
  const out: RenditionOption[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const r = list[i];
    if (r && typeof r.height === 'number' && r.height > 0) {
      // Name the rendition the way viewers know it: a wide film (1920 x 800) is "1080", as YouTube and Netflix name it, never "800".
      const w = typeof (r as { width?: number }).width === 'number' ? (r as { width: number }).width : 0;
      const tall = Math.max(r.height, Math.round((w * 9) / 16));
      const named = STANDARD_HEIGHTS.reduce((best, h) => (Math.abs(h - tall) < Math.abs(best - tall) ? h : best), STANDARD_HEIGHTS[0]);
      const bitrate = (r as { bitrate?: number }).bitrate;
      out.push({ id: String(r.id ?? i), height: named, label: String(named), bitrate: typeof bitrate === 'number' ? bitrate : 0 });
    }
  }
  // Two levels of one size (a light one the player can start on, a rich one it climbs to): the richest comes first, so choosing "1080" gets the best picture.
  return out.sort((a, b) => b.height - a.height || (b.bitrate ?? 0) - (a.bitrate ?? 0));
}

/** The id of the rendition in use, or "auto". */
export function selectedRendition(media: HTMLMediaElement): string {
  const list = listOf(media);
  if (!list || typeof list.selectedIndex !== 'number' || list.selectedIndex < 0) return 'auto';
  const r = list[list.selectedIndex];
  return r ? String(r.id ?? list.selectedIndex) : 'auto';
}

/** Choose a rendition by id, or "auto" to let the player adapt. */
export function selectRendition(media: HTMLMediaElement, id: string): void {
  const list = listOf(media);
  if (!list) return;
  if (id === 'auto') { list.selectedIndex = -1; return; }
  for (let i = 0; i < list.length; i += 1) {
    if (String(list[i]?.id ?? i) === id) { list.selectedIndex = i; return; }
  }
}

export interface CaptionOption { index: number; language: string; label: string }

/** One option per captions or subtitles track: a short legend (the language code) and the full name. */
export function captionOptions(media: HTMLMediaElement): CaptionOption[] {
  return captionTracks(media).map((t, index) => ({ index, language: (t.language || String(index + 1)).toUpperCase(), label: t.label || t.language || `Track ${index + 1}` }));
}

/** At most three renditions beside Auto: the ones nearest 1080, 720 and 480 (a tray row holds four tiles). */
export function ladder(list: readonly RenditionOption[]): RenditionOption[] {
  if (list.length <= 3) return [...list];
  const picked: RenditionOption[] = [];
  // A 4K (or 1440) stream keeps its top rung in the menu: the tallest, then 1080 and 720, so the tray still fits.
  const tallest = Math.max(...list.map((r) => r.height));
  const wants = tallest > 1080 ? [tallest, 1080, 720] : [1080, 720, 480];
  for (const want of wants) {
    const best = [...list].filter((r) => !picked.includes(r)).sort((a, b) => Math.abs(a.height - want) - Math.abs(b.height - want) || (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    if (best) picked.push(best);
  }
  return picked.sort((a, b) => b.height - a.height);
}
