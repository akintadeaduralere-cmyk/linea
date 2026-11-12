import { VOLUME_LEVELS } from './constants.ts';
import type { ReelController } from './controller.ts';
import { el, flashLamp, setAttr, toggleAttr } from './dom.ts';
import { LABELS } from './labels.ts';
import { bindScrub } from './pointer.ts';
import { sliderIntent } from './slider-keys.ts';
import type { ReelState } from './types.ts';

export interface VolumeView {
  root: HTMLElement;
  update(state: ReelState): void;
}

/**
 * The volume roller: a slider of five levels plus off. Arrow keys here change the volume and nothing else.
 * It is hidden where scripts cannot set the volume (iPhone), where Sound only mutes.
 */
export function buildVolume(c: ReelController, signal: AbortSignal, rtl: () => boolean): VolumeView {
  const root = el('div', 'sr-volume', {
    role: 'slider', tabindex: '0', 'aria-label': LABELS.volume, 'aria-valuemin': '0', 'aria-valuemax': String(VOLUME_LEVELS), 'aria-valuenow': '0',
  });
  const lamps = Array.from({ length: VOLUME_LEVELS }, () => el('span', 'sr-lamp', { 'aria-hidden': 'true' }));
  root.append(...lamps);
  // The wheel (desktop): the scrolling tile in the housing's window, the fixed light layers over it, the housing on top. Pictures only, set in the stylesheet.
  const tile = el('i', 'sr-lv-tile');
  const win = el('span', 'sr-lv-win', { 'aria-hidden': 'true' }, '');
  win.append(tile);
  root.append(win, el('i', 'sr-lv-mul', { 'aria-hidden': 'true' }), el('i', 'sr-lv-scr', { 'aria-hidden': 'true' }), el('i', 'sr-lv-house', { 'aria-hidden': 'true' }));

  root.addEventListener('keydown', (e) => {
    const intent = sliderIntent({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, rtl: rtl() });
    if (!intent) return;
    e.preventDefault();
    if (intent.type === 'home') c.setLevel(0);
    else if (intent.type === 'end') c.setLevel(VOLUME_LEVELS);
    else c.stepLevel(intent.delta);
  }, { signal });
  // A click anywhere sets the nearest of the five levels, so no drag is needed.
  bindScrub(root, signal, (f) => c.setLevel(Math.max(1, Math.ceil((rtl() ? 1 - f : f) * VOLUME_LEVELS))));

  function update(s: ReelState): void {
    root.hidden = !s.volumeSettable;
    lamps.forEach((lamp, i) => {
      const on = i < s.level;
      const was = lamp.hasAttribute('data-on');
      toggleAttr(lamp, 'data-on', on);
      if (was !== on && lamp.hasAttribute('data-seen')) flashLamp(lamp);
      if (!lamp.hasAttribute('data-seen')) lamp.setAttribute('data-seen', '');
    });
    root.style.setProperty('--sr-level', String(s.level));
    setAttr(root, 'aria-valuenow', String(s.level));
    setAttr(root, 'aria-valuetext', `${LABELS.levelValue(s.level)}${s.muted ? LABELS.muted : ''}`);
  }

  return { root, update };
}
