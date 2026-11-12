import type { Cue } from './types.ts';

/** From an X-TIMESTAMP-MAP header: this local cue time is this MPEG-TS clock value (90 kHz). */
export interface TimestampMap {
  local: number;
  mpegts: number;
}

export interface ParsedVtt {
  cues: Cue[];
  map: TimestampMap | null;
}

export const MPEGTS_HZ = 90000;
const MILLIS = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;

/** "01:02:03.456" or "02:03.456" as seconds, or NaN. */
export function parseTime(text: string): number {
  const m = TIME.exec(text);
  if (!m) return Number.NaN;
  return Number(m[1] ?? 0) * SECONDS_PER_HOUR + Number(m[2]) * SECONDS_PER_MINUTE + Number(m[3]) + Number(m[4]) / MILLIS;
}

function parseMap(line: string): TimestampMap | null {
  const local = /LOCAL:([\d:.,]+)/.exec(line);
  const mpegts = /MPEGTS:(\d+)/.exec(line);
  return local && mpegts ? { local: parseTime(local[1]), mpegts: Number(mpegts[1]) } : null;
}

/** Parse a WebVTT file: its cues (as written, in local time) and its X-TIMESTAMP-MAP if it has one. */
export function parseVtt(text: string): ParsedVtt {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  let map: TimestampMap | null = null;
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines.find((l) => l.startsWith('X-TIMESTAMP-MAP='));
    if (header) map = parseMap(header);
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const [from, to] = lines[at].split('-->');
    const start = parseTime(from);
    const end = parseTime(to ?? '');
    const body = lines.slice(at + 1).join('\n').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && body) cues.push({ start, end, text: body });
  }
  return { cues, map };
}
