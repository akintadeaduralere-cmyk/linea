import { SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from './constants.ts';

const pad = (n: number): string => String(n).padStart(2, '0');
const whole = (seconds: number): number => (Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0);

function parts(seconds: number): { h: number; m: number; s: number } {
  const t = whole(seconds);
  return { h: Math.floor(t / SECONDS_PER_HOUR), m: Math.floor((t % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE), s: t % SECONDS_PER_MINUTE };
}

/** m:ss, or h:mm:ss for an hour or more. */
export function formatTime(seconds: number): string {
  const { h, m, s } = parts(seconds);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** ISO 8601 duration for the datetime of a <time> element, such as PT1M12S. */
export function isoDuration(seconds: number): string {
  const { h, m, s } = parts(seconds);
  if (h === 0 && m === 0) return `PT${s}S`;
  return `PT${h > 0 ? `${h}H` : ''}${m > 0 || h > 0 ? `${m}M` : ''}${s > 0 ? `${s}S` : ''}`;
}

const unit = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "1 minute 12 seconds", the way a screen reader should say a time. */
export function spokenTime(seconds: number): string {
  const { h, m, s } = parts(seconds);
  const out: string[] = [];
  if (h > 0) out.push(unit(h, 'hour'));
  if (h > 0 || m > 0) out.push(unit(m, 'minute'));
  if (s > 0 || out.length === 0) out.push(unit(s, 'second'));
  return out.join(' ');
}

const ELLIPSIS = '…';

/** Cut text to at most `max` characters at a word boundary, ending with an ellipsis when cut. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - ELLIPSIS.length);
  const lastSpace = room.lastIndexOf(' ');
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room;
  return `${cut.trimEnd()}${ELLIPSIS}`;
}
