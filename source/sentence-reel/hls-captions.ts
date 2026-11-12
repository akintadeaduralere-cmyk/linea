import type { Clock } from './clock.ts';
import { MPEGTS_HZ, parseVtt, type ParsedVtt } from './vtt.ts';
import type { Cue } from './types.ts';

/** How long the whole up-front load may take (ms) before the live text track is used instead. */
export const LOAD_TIMEOUT_MS = 20000;
/** At most this many caption requests at a time, so the film's own requests are never crowded out. */
export const FETCH_CONCURRENCY = 6;
/** All the text fetched for one video may not exceed this many characters; more falls back to the live track. */
export const MAX_CHARACTERS = 8_000_000;
const CUE_KEY_DECIMALS = 2;

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; text(): Promise<string> }>;

export interface LoadOptions {
  /** Media source URL (an HLS master playlist for the automatic route). */
  src: string;
  /** A complete WebVTT file; when given it is used and the playlists are not read. */
  sentencesSrc?: string;
  fetchFn: Fetcher;
  clock: Clock;
  timeoutMs?: number;
  /** The rendition the viewer chose (matched by language, then name). Default: the playlist's DEFAULT, else the first. */
  prefer?: { language?: string; name?: string };
}

/** Attributes of an #EXT-X-MEDIA line, quoted values included. */
function attributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) out[m[1]] = m[3] ?? m[2];
  return out;
}

/** The subtitles playlist a master playlist offers: the preferred language or name, else DEFAULT, else the first. */
export function parseMasterSubtitles(text: string, baseUrl: string, prefer?: LoadOptions['prefer']): string | null {
  const tracks = text.split(/\r?\n/).filter((l) => l.startsWith('#EXT-X-MEDIA:')).map(attributes).filter((a) => a.TYPE === 'SUBTITLES' && a.URI);
  const pick = tracks.find((a) => prefer?.language && a.LANGUAGE === prefer.language) ?? tracks.find((a) => prefer?.name && a.NAME === prefer.name)
    ?? tracks.find((a) => a.DEFAULT === 'YES') ?? tracks[0];
  return pick ? new URL(pick.URI, baseUrl).href : null;
}

/** Only a finished playlist (#EXT-X-ENDLIST, not an EVENT playlist) holds every cue the film will ever have. */
export function playlistEnded(text: string): boolean {
  return /^#EXT-X-ENDLIST/m.test(text) && !/^#EXT-X-PLAYLIST-TYPE:EVENT/m.test(text);
}

/** Run `work` over every item, at most `limit` at a time, results in order. The first failure stops the rest. */
async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const i = next++;
      try { out[i] = await work(items[i]); } catch (e) { failed = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/** The segment URLs of a media playlist, in order. */
export function parseSegmentUrls(text: string, baseUrl: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => new URL(l, baseUrl).href);
}

/**
 * Merge the cues of every segment into one list. Each segment's X-TIMESTAMP-MAP says where its local time
 * sits on the stream clock; segments are shifted by how far their map differs from the first one's (all the
 * same on the Mux stream, so no shift). A cue that straddles a segment boundary is written in both segments
 * with the same times and text: duplicates are dropped. The first segment's own map fixes the media start (its
 * LOCAL and MPEGTS need not be zero: the offset is MPEGTS / 90000 - LOCAL), so a stream that does not begin at
 * clock zero still lands on the media timeline.
 */
export function mergeSegments(segments: readonly ParsedVtt[]): Cue[] {
  const offset = (s: ParsedVtt): number => (s.map ? s.map.mpegts / MPEGTS_HZ - s.map.local : 0);
  const base = segments.find((s) => s.map) ? offset(segments.find((s) => s.map) as ParsedVtt) : 0;
  const seen = new Set<string>();
  const merged: Cue[] = [];
  for (const seg of segments) {
    const shift = seg.map ? offset(seg) - base : 0;
    for (const c of seg.cues) {
      const cue = { start: c.start + shift, end: c.end + shift, text: c.text };
      const key = `${cue.start.toFixed(CUE_KEY_DECIMALS)}|${cue.end.toFixed(CUE_KEY_DECIMALS)}|${cue.text}`;
      if (!seen.has(key)) { seen.add(key); merged.push(cue); }
    }
  }
  return merged.sort((a, b) => a.start - b.start);
}

/**
 * The complete cue list, fetched once up front instead of waiting for the text track to fill as HLS loads
 * caption segments during playback. Route (a): a WebVTT file named by `sentencesSrc`. Route (b): the
 * subtitles playlist of an HLS master playlist, but only a finished one (#EXT-X-ENDLIST), with its segments
 * fetched a few at a time. Any failure, a CORS refusal, an empty result, a live playlist, a budget overrun or a
 * timeout gives null, quietly, and the caller uses the live text track.
 */
export async function loadCompleteCues(o: LoadOptions): Promise<Cue[] | null> {
  const abort = new AbortController();
  const timer = o.clock.setTimeout(() => abort.abort(), o.timeoutMs ?? LOAD_TIMEOUT_MS);
  let characters = 0;
  const get = async (url: string): Promise<string> => {
    const res = await o.fetchFn(url, { signal: abort.signal });
    if (!res.ok) throw new Error('not ok');
    const text = await res.text();
    characters += text.length;
    if (characters > MAX_CHARACTERS) throw new Error('over budget');
    return text;
  };
  const timedOut = new Promise<null>((resolve) => abort.signal.addEventListener('abort', () => resolve(null), { once: true }));
  const work = (async (): Promise<Cue[] | null> => {
    if (o.sentencesSrc) return parseVtt(await get(o.sentencesSrc)).cues;
    if (!/\.m3u8/i.test(o.src)) return null;
    const playlist = parseMasterSubtitles(await get(o.src), o.src, o.prefer);
    if (!playlist) return null;
    const list = await get(playlist);
    if (!playlistEnded(list)) return null;
    const urls = parseSegmentUrls(list, playlist);
    if (urls.length === 0) return null;
    return mergeSegments((await mapLimited(urls, FETCH_CONCURRENCY, get)).map(parseVtt));
  })().catch(() => { abort.abort(); return null; });
  try {
    const cues = await Promise.race([work, timedOut]);
    return cues && cues.length > 0 ? cues : null;
  } finally {
    o.clock.clearTimeout(timer);
    abort.abort();
  }
}
