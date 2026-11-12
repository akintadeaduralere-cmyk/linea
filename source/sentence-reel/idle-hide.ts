import type { Clock } from './clock.ts';
import { IDLE_HIDE_MS } from './constants.ts';
import type { ReelState } from './types.ts';

/**
 * Full screen: the controls hide after IDLE_HIDE_MS without input, playing or paused (owner, 12 Nov 2026: a paused
 * frame in full screen is for looking at). data-idle on the host; the stylesheet fades them, or just hides them with
 * reduced motion. Pointer move, tap or any key brings them back. Never while the Settings tray is open, never while
 * keyboard focus is inside the controls, never before the first play, at the end of the film or after an error.
 */
export function watchIdle(host: HTMLElement, controls: HTMLElement, doc: Document, clock: Clock, signal: AbortSignal): (state: ReelState) => void {
  let eligible = false;
  let lastState: ReelState | null = null;
  // A phone turned sideways plays as theatre: full screen without asking the browser (iOS allows that only from a tap).
  const theatre = typeof matchMedia === 'function' ? matchMedia('(orientation: landscape) and (max-height: 520px) and (pointer: coarse)') : null;
  const syncTheatre = (): void => { host.toggleAttribute('data-theatre', !!theatre?.matches); if (lastState) update(lastState); };
  let last = clock.now();
  let timer: unknown = null;
  const clear = (): void => { if (timer !== null) { clock.clearTimeout(timer); timer = null; } };
  const show = (): void => { if (host.hasAttribute('data-idle')) host.removeAttribute('data-idle'); };
  const arm = (): void => {
    if (timer !== null || !eligible) return;
    const wait = Math.max(0, last + IDLE_HIDE_MS - clock.now());
    timer = clock.setTimeout(() => {
      timer = null;
      if (!eligible) return;
      const active = doc.activeElement;
      // Only keyboard focus keeps the controls up: a mouse click (on Full screen itself) leaves focus on a button and must not.
      if (active && controls.contains(active) && active.matches(':focus-visible') && !active.hasAttribute('data-pointer-focus')) { last = clock.now(); arm(); return; }
      if (host.getAttribute('data-drawer') === 'open') { last = clock.now(); arm(); return; }
      if (clock.now() - last < IDLE_HIDE_MS) { arm(); return; }
      host.setAttribute('data-idle', '');
    }, wait);
  };
  const activity = (): void => { last = clock.now(); show(); arm(); };
  for (const type of ['pointermove', 'pointerdown', 'touchstart', 'keydown']) host.addEventListener(type, activity, { signal, passive: true });
  signal.addEventListener('abort', () => { clear(); show(); }, { once: true });
  const update = (state: ReelState): void => {
    lastState = state;
    const was = eligible;
    eligible = (state.fullscreen || host.hasAttribute('data-theatre')) && !state.failed && state.phase !== 'ended' && state.phase !== 'before';
    if (!eligible) { clear(); show(); return; }
    if (!was) last = clock.now();
    arm();
  };
  theatre?.addEventListener?.('change', syncTheatre, { signal });
  signal.addEventListener('abort', () => host.removeAttribute('data-theatre'), { once: true });
  host.toggleAttribute('data-theatre', !!theatre?.matches);
  return update;
}
