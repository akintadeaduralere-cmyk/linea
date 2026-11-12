import type { ReelController } from './controller.ts';
import { button, el, flashLamp, hint, setAttr, setBool } from './dom.ts';
import { buildFader } from './fader.ts';
import { formatTime, isoDuration, spokenTime } from './format.ts';
import { LABELS } from './labels.ts';
import { buildReel } from './reel.ts';
import type { ReelState } from './types.ts';
import { buildVolume } from './volume.ts';

export interface Controls {
  root: HTMLElement;
  /** The reel slider, the Wait switch and the Full screen key, which the mount needs to know about. */
  reel: HTMLElement;
  wait: HTMLButtonElement;
  full: HTMLButtonElement;
  /** The Play key: where focus goes back to after the message is dismissed. */
  hub: HTMLButtonElement;
  update(state: ReelState): void;
}

/** `sign` is drawn before the digits (the minus of the remaining time); `after` is spoken after them. */
/** Set a toggle's state; a lamp that changes (not the first write) flashes. */
function lamp(node: HTMLElement, attr: string, on: boolean): void {
  const was = node.getAttribute(attr);
  const first = !node.hasAttribute('data-lamp-seen');
  if (first) node.setAttribute('data-lamp-seen', '');
  setBool(node, attr, on);
  if (!first && was !== String(on)) flashLamp(node);
}

function setTime(node: HTMLTimeElement, seconds: number, sign = '', after = ''): void {
  const text = sign + formatTime(seconds);
  const shown = node.firstElementChild;
  if (shown && shown.textContent === text && node.getAttribute('data-after') === after) return;
  node.setAttribute('data-after', after);
  // aria-label is not supported on <time> (axe: aria-prohibited-attr), so the spoken form is hidden text and the digits are for the eye.
  node.replaceChildren(el('span', '', { 'aria-hidden': 'true' }, text), el('span', 'sr-only', {}, spokenTime(seconds) + after));
  node.setAttribute('datetime', isoDuration(seconds));
  // Any film length must fit the face (12:14, 1:02:03): the face reads its longest figure and the CSS steps the size down.
  const face = node.parentElement;
  if (face) face.setAttribute('data-len', String(Math.max(...Array.from(face.querySelectorAll('time'), (t) => t.firstElementChild?.textContent?.length ?? 0))));
}

/**
 * Plain controls, lightly structured. Every control is a real focusable element with a visible,
 * live-text name; the reel and the hub are siblings in one group. Source order is the Tab order and
 * the reading order, as A11Y-SPEC section 2 lists it: Again, Next, Words, Wait, Full screen, Sound,
 * Volume, Reel, Play or Pause, then the Timeline. The stylesheet never reorders it.
 */
export function buildControls(c: ReelController, signal: AbortSignal, rtl: () => boolean, title = ''): Controls {
  const root = el('div', 'sr-controls', { role: 'group', 'aria-label': LABELS.controls });
  const reel = buildReel(c, signal, rtl, title);
  const fader = buildFader(c, signal, rtl);
  const volume = buildVolume(c, signal, rtl);

  const againHint = hint(LABELS.againHint);
  const nextHint = hint(LABELS.nextHint);
  const wordsHint = hint(LABELS.wordsHint);
  const wordsNone = hint(LABELS.wordsNone);
  const waitHint = hint(LABELS.waitHint);
  const soundHint = hint(LABELS.soundHint);

  const again = button('sr-btn sr-again', LABELS.again, () => c.again(), { 'aria-keyshortcuts': 'A', 'aria-describedby': againHint.id }, signal);
  const next = button('sr-btn sr-next', LABELS.next, () => c.next(), { 'aria-keyshortcuts': 'N', 'aria-describedby': nextHint.id }, signal);
  const hub = button('sr-hub', LABELS.play, () => c.togglePlay(), { 'aria-keyshortcuts': 'Space' }, signal);
  // The ember chase that runs round the hub ring while the film buffers (board F section 3).
  const chase = el('i', 'sr-hub-chase', { 'aria-hidden': 'true' });
  const words = button('sr-btn sr-words', LABELS.words, () => { c.toggleCaptions(); }, { 'aria-pressed': 'false', 'aria-keyshortcuts': 'C' }, signal);
  // Wait is an on or off setting, so it is a switch.
  const wait = button('sr-btn sr-wait', LABELS.wait, () => { c.toggleWait(); }, { role: 'switch', 'aria-checked': 'false', 'aria-keyshortcuts': 'W', 'aria-describedby': waitHint.id }, signal);
  const full = button('sr-btn sr-full', LABELS.fullscreen, () => void c.toggleFullscreen(), { 'aria-pressed': 'false', 'aria-keyshortcuts': 'F' }, signal);
  const sound = button('sr-btn sr-sound', LABELS.sound, () => c.toggleMute(), { 'aria-pressed': 'false', 'aria-keyshortcuts': 'M', 'aria-describedby': soundHint.id }, signal);

  const reelGroup = el('div', 'sr-reelwrap', { role: 'group', 'aria-label': LABELS.reel });
  reelGroup.append(again, reel.root, next, hub);
  const keys = el('div', 'sr-keys');
  keys.append(words, wait, full, sound, volume.root);

  const nowTime = el('time', '');
  const totalTime = el('time', '');
  const time = el('div', 'sr-time', { role: 'group', 'aria-label': LABELS.time, dir: 'ltr' });
  const ofWord = el('span', 'sr-only', {}, LABELS.timeOf);
  const slash = el('span', 'sr-slash', { 'aria-hidden': 'true' }, ' / ');
  time.append(nowTime, ofWord, slash, totalTime);
  const timeline = el('div', 'sr-timeline');
  // The time face toggles between elapsed over total and the time remaining. A real button over the face: keyboard, 44 px, announced as pressed.
  let remaining = false;
  let lastState: ReelState | null = null;
  const timeToggle = button('sr-time-toggle', LABELS.timeRemaining, () => { remaining = !remaining; if (lastState) paintTime(lastState); }, { 'aria-pressed': 'false' }, signal);
  time.append(timeToggle);
  function paintTime(s: ReelState): void {
    lastState = s;
    time.toggleAttribute('data-remaining', remaining);
    timeToggle.setAttribute('aria-pressed', String(remaining));
    if (remaining) { setTime(nowTime, Math.max(0, s.duration - s.time), '\u2212', ' remaining'); totalTime.replaceChildren(); totalTime.removeAttribute('datetime'); totalTime.removeAttribute('data-after'); }
    else { setTime(nowTime, s.time); setTime(totalTime, s.duration); }
    ofWord.hidden = remaining; slash.hidden = remaining;
  }
  timeline.append(fader.root, time);

  root.append(timeline, reelGroup, keys, reel.hint, fader.hint, againHint, nextHint, wordsHint, wordsNone, waitHint, soundHint);

  function update(s: ReelState): void {
    reel.update(s);
    fader.update(s);
    volume.update(s);

    setAttr(hub, 'data-paused', String(s.paused || s.failed || s.ended));
    // The control follows what the media is really doing, not what was asked of it.
    // Failed: Retry. Ended: Replay. Buffering: the hub keeps Pause (the ring chases, aria-busy says why); the viewer can still cancel.
    const hubName = s.failed ? LABELS.retry : s.ended ? LABELS.replay : s.buffering ? LABELS.pause : s.paused ? LABELS.play : LABELS.pause;
    if (hub.textContent !== hubName || !hub.contains(chase)) { hub.textContent = hubName; hub.setAttribute('data-label', hubName); hub.append(chase); }
    if (s.buffering && !s.ended && !s.failed) hub.setAttribute('aria-busy', 'true'); else hub.removeAttribute('aria-busy');   // at the end nothing is loading
    setBool(again, 'aria-disabled', !s.ready);
    setBool(next, 'aria-disabled', !s.canNext);
    lamp(words, 'aria-pressed', s.captionsOn);
    setBool(words, 'aria-disabled', !s.captionsAvailable);
    setAttr(words, 'aria-describedby', s.captionsAvailable ? wordsHint.id : wordsNone.id);
    lamp(wait, 'aria-checked', s.wait);
    setAttr(wait, 'data-holding', String(s.holding));
    lamp(full, 'aria-pressed', s.fullscreen);
    // The key is named Mute, so pressed (and its lamp lit) means the sound is off.
    lamp(sound, 'aria-pressed', s.muted || s.volume === 0);
    paintTime(s);
  }

  return { root, reel: reel.root, wait, full, hub, update };
}
