import { VOLUME_LEVELS } from './constants.ts';

/** Set the volume to level 0 to 5. Level 0 mutes and keeps the volume; any other level sets it and unmutes. */
export function applyLevel(media: HTMLMediaElement, level: number): void {
  const n = Math.min(VOLUME_LEVELS, Math.max(0, Math.round(level)));
  if (n === 0) {
    media.muted = true;
    return;
  }
  media.volume = n / VOLUME_LEVELS;
  media.muted = false;
}
