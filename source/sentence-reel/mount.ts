import { FEEDBACK_MS, FOCUS_RETURN_MS, LOADING_ANNOUNCE_MS, SEEK_STEP_SECONDS, SKIP_SECONDS } from './constants.ts';
import { ReelController, type ReelOptions } from './controller.ts';
import { realClock } from './clock.ts';
import { buildArt } from './art.ts';
import { buildControls } from './controls.ts';
import { button, el, isRtl } from './dom.ts';
import { keyAction, type JumpAction, type KeyAction } from './keys.ts';
import { LABELS, sentenceStatus } from './labels.ts';
import { StatusRegion } from './status.ts';
import { createCueGuard, findVideo } from './cue-guard.ts';
import { attachTaps } from './gestures.ts';
import { mountExtras, type Extras } from './extras.ts';
import { watchIdle } from './idle-hide.ts';
import { formatTime } from './format.ts';
import { jumpSpoken, jumpText, skipSpoken, skipText, speedSpoken, speedText } from './transport.ts';
import { SentenceWindow } from './window-view.ts';

export interface ReelHandle {
  controller: ReelController;
  /** The etched glass layer registers its marks on this sampler (each mark gets data-ink). */
  etched: Extras['etched'];
  /** Remove everything this mount added and put the page back as it was. */
  destroy(): void;
}

const mounted = new WeakMap<HTMLElement, ReelHandle>();

interface Restore {
  className: string;
  tabindex: string | null;
  role: string | null;
  label: string | null;
}

/**
 * Mount the Sentence Reel behaviour and plain controls around a media element.
 * `host` becomes the full-screen and keyboard scope; the media element is moved inside a stage in it.
 * Mounting a host that is already mounted first removes the earlier mount.
 */
export function mountSentenceReel(host: HTMLElement, media: HTMLMediaElement, options: ReelOptions = {}): ReelHandle {
  mounted.get(host)?.destroy();

  const doc = host.ownerDocument;
  const clock = options.clock ?? realClock;
  const abort = new AbortController();
  const { signal } = abort;
  const rtl = (): boolean => isRtl(host);

  const restore: Restore = {
    className: host.className, tabindex: host.getAttribute('tabindex'), role: host.getAttribute('role'), label: host.getAttribute('aria-label'),
  };
  // The complete captions can be named on the host or the media element: sentences-src="full.vtt".
  const namedSrc = (): string | undefined => host.getAttribute('sentences-src') ?? media.getAttribute?.('sentences-src') ?? undefined;
  const sentencesSrc = options.sentencesSrc ?? namedSrc();
  const controller = new ReelController(media, host, { ...options, sentencesSrc, eagerLoad: options.eagerLoad ?? host.hasAttribute('eager-captions') });
  const untabbed = removeFromTabOrder(host, media, signal);
  // No JavaScript, no skin: the markup carries `controls` on the video so the film plays with the browser's own controls. The skin replaces them, so it takes the attribute off on mount (and puts it back on destroy).
  for (const native of new Set([media as Element, findVideo(media)])) {
    if (!native?.hasAttribute('controls')) continue;
    native.removeAttribute('controls');
    signal.addEventListener('abort', () => native.setAttribute('controls', ''), { once: true });
  }
  // The video's own title is drawn on the disc: reel-title on the host or the media element, else the count only.
  const title = options.title ?? host.getAttribute('reel-title') ?? media.getAttribute?.('reel-title') ?? '';
  const art = buildArt();
  const controls = buildControls(controller, signal, rtl, title);
  const sentenceWindow = new SentenceWindow(title);
  // One caption: the dot window is it. The picture never draws the text track (the guard hides its drawing; the track still loads and stays for assistive tech).
  // In full screen, only while the deck is hidden, a strip of the same dots carries the sentence on the picture.
  const strip = new SentenceWindow(title, undefined, true);
  const pictureGuard = createCueGuard(media, 'data-sr-nocap');
  pictureGuard.engage();
  // iPhone full screen is the system's own player, which draws captions itself: there the chosen track shows (one, never two).
  const nativeVideo = (findVideo(media) ?? media) as HTMLVideoElement;
  // Linea draws its own captions, so the chosen track is normally kept hidden; the system player draws only a showing one, so
  // with Captions on the chosen track is switched on for it and hidden again on the way back (captions missing in iPhone full
  // screen, owner, 12 Nov 2026).
  let shownForSystem: TextTrack | null = null;
  nativeVideo.addEventListener('webkitbeginfullscreen', () => {
    pictureGuard.release();
    const caps = Array.from(nativeVideo.textTracks ?? []).filter((t) => t.kind === 'captions' || t.kind === 'subtitles');
    const on = caps.filter((t) => t.mode === 'showing');
    on.slice(0, -1).forEach((t) => { t.mode = 'hidden'; });
    const captionsOn = host.querySelector('.sr-words')?.getAttribute('aria-pressed') === 'true';
    const chosen = on.length === 0 && captionsOn ? caps.find((t) => t.mode === 'hidden') : undefined;
    if (chosen) { chosen.mode = 'showing'; shownForSystem = chosen; }
  }, { signal });
  nativeVideo.addEventListener('webkitendfullscreen', () => {
    if (shownForSystem) { shownForSystem.mode = 'hidden'; shownForSystem = null; }
    pictureGuard.engage();
  }, { signal });
  const status = new StatusRegion(doc, clock);
  // The message is an alert with a Dismiss button (Escape does the same); the text is in its own span so the button survives a change of text.
  const message = el('div', 'sr-message', { role: 'alert' });
  message.hidden = true;
  const messageText = el('span', 'sr-message-text');
  const dismiss = button('sr-dismiss', LABELS.dismiss, () => dismissMessage(), {}, signal);
  // After a failure the message also offers Try again (the hub says Retry too); the look swaps in the etched buttons later.
  const retryButton = button('sr-retry', LABELS.tryAgain, () => controller.retry(), {}, signal);
  retryButton.hidden = true;
  // The etched error (board F): the title, the reason, then what to do (the hub says Retry, Escape closes). The two buttons stay for assistive tech and the plain layout.
  const messageTitle = el('span', 'sr-message-title', {}, LABELS.errorTitle);
  const messageHint = el('span', 'sr-message-hint', {}, LABELS.errorHint);
  messageTitle.hidden = true; messageHint.hidden = true;
  message.append(messageTitle, messageText, messageHint, retryButton, dismiss);
  const stage = el('div', 'sr-stage');

  sentenceWindow.watch(signal);
  strip.watch(signal);
  host.classList.add('sr-player', 'sr-look');
  host.tabIndex = -1;
  if (!restore.role) host.setAttribute('role', 'group');
  if (!restore.label) host.setAttribute('aria-label', LABELS.player);
  media.before(stage);
  stage.append(media);
  host.append(art.spacer, art.root, sentenceWindow.root, strip.root, message, controls.root, status.root);
  host.addEventListener('pointerdown', (e) => {
    if (e.target === media || e.target === stage) host.focus({ preventScroll: true });
  }, { signal });

  /** Dismiss the message and put focus back on the Play key (only if focus was on the message or lost). */
  function dismissMessage(): void {
    const active = doc.activeElement;
    controller.clearMessage();
    if (!active || active === dismiss || active === doc.body || active === host || message.contains(active)) controls.hub.focus({ preventScroll: true });
  }
  // A figure etched low on the glass for a moment (speed and volume come from the media itself), spoken once through the status region. `noteTimer` runs while it shows, so repeated skips add up.
  let noteTimer: unknown = null;
  function note(text: string, spoken: string, show = true): void {
    if (noteTimer !== null) clock.clearTimeout(noteTimer);
    if (show) extras.feedback('skip', text);
    status.announce(spoken);
    noteTimer = clock.setTimeout(() => { noteTimer = null; }, FEEDBACK_MS);
  }
  // Skips in the same direction while the note is still showing add up: "+10 SEC", then "+20 SEC".
  let skipTotal = 0;
  const skip = (seconds: number): void => {
    skipTotal = noteTimer !== null && Math.sign(skipTotal) === Math.sign(seconds) ? skipTotal + seconds : seconds;
    controller.seekBy(seconds);
    note(skipText(skipTotal), skipSpoken(skipTotal), false);
    extras.feedback('skip', `${skipTotal < 0 ? '\u2212' : '+'}${Math.abs(skipTotal)} SEC`, { small: formatTime(controller.state().time) });
  };
  const jump = (digit: number): void => { controller.seekToFraction(digit / 10); note(jumpText(digit), jumpSpoken(digit)); };
  attachTaps(stage, clock, { toggle: () => controller.togglePlay(), fullscreen: () => void controller.toggleFullscreen(), skip: (side) => skip(side === 'back' ? -SKIP_SECONDS : SKIP_SECONDS) }, signal);
  const run: Record<Exclude<KeyAction, JumpAction>, () => void> = {
    'skip-back': () => skip(-SKIP_SECONDS),
    'skip-forward': () => skip(SKIP_SECONDS),
    'speed-down': () => { const r = controller.stepSpeed(-1); note(speedText(r), speedSpoken(r), false); },
    'speed-up': () => { const r = controller.stepSpeed(1); note(speedText(r), speedSpoken(r), false); },
    start: () => { controller.seekToTime(0); note('0%', jumpSpoken(0)); },
    end: () => { controller.seekToFraction(1); note('END', 'End'); },
    'toggle-play': () => controller.togglePlay(),
    again: () => controller.again(),
    next: () => controller.next(),
    previous: () => controller.previous(),
    'seek-back': () => controller.seekBy(-SEEK_STEP_SECONDS),
    'seek-forward': () => controller.seekBy(SEEK_STEP_SECONDS),
    captions: () => { controller.toggleCaptions(); },
    wait: () => {
      const on = controller.toggleWait();
      // The Wait button announces its own change; from anywhere else the viewer would hear nothing.
      if (doc.activeElement !== controls.wait) status.announce(on ? LABELS.waitOn : LABELS.waitOff);
    },
    mute: () => controller.toggleMute(),
    'volume-up': () => controller.stepLevel(1),
    'volume-down': () => controller.stepLevel(-1),
    fullscreen: () => void controller.toggleFullscreen(),
  };
  // On the host, so a shortcut only fires while focus is inside the player (WCAG 2.1.4).
  // Which key the mouse or a finger last pressed. Space on that key plays or pauses rather than pressing it again (a clicked Full
  // screen key left full screen on Space, 12 Nov 2026). The browser relabels focus as keyboard focus the moment any key goes down,
  // so the player keeps this itself: Tab, or focus arriving any other way, clears it.
  // The key also carries data-pointer-focus, so the full-screen fade (idle-hide) does not mistake it for keyboard focus either.
  let pointerKey: Element | null = null;
  const setPointerKey = (k: Element | null): void => { pointerKey?.removeAttribute('data-pointer-focus'); pointerKey = k; k?.setAttribute('data-pointer-focus', ''); };
  host.addEventListener('pointerdown', (e) => { setPointerKey((e.target as Element).closest?.('button, [role=button], [role=switch]') ?? null); }, { signal, capture: true });
  host.addEventListener('focusin', (e) => { if (e.target !== pointerKey) setPointerKey(null); }, { signal });
  host.addEventListener('keyup', (e) => { if (e.key === ' ' && pointerKey && e.target === pointerKey) e.preventDefault(); }, { signal });
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') setPointerKey(null);
    // Escape dismisses a message that is showing (a full screen exit by Escape is the browser's own and still happens).
    if (e.key === 'Escape' && !message.hidden) { dismissMessage(); return; }
    const t = e.target as HTMLElement;
    const action = keyAction({
      key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, repeat: e.repeat, isComposing: e.isComposing, rtl: rtl(),
      target: { tag: t.tagName.toLowerCase(), type: (t as HTMLInputElement).type, role: t.getAttribute?.('role') ?? undefined, keyboardFocus: t !== pointerKey },
    });
    if (!action) return;
    e.preventDefault();
    if (action.startsWith('jump-')) jump(Number(action.slice(5)));
    else run[action as Exclude<KeyAction, JumpAction>]();
  }, { signal });

  // Sentence moves are spoken once, through the one status region. A focused reel already speaks a
  // changed value through its value text, so a move that changes it is skipped here; Again does not.
  const stopNav = controller.onNavigate((nav) => {
    if (doc.activeElement === controls.reel && nav.index !== nav.from) return;
    status.announce(sentenceStatus(nav.sentence, nav.count, nav.totalKnown));
  });
  // A new `sentences-src` or a new source: reset the list, the reel and the total, and load again.
  const reload = (): void => controller.reloadCaptions(namedSrc());
  media.addEventListener('emptied', reload, { signal });
  const watcher = typeof MutationObserver === 'function' ? new MutationObserver(reload) : null;
  for (const node of [host, media]) watcher?.observe(node, { attributes: true, attributeFilter: ['sentences-src', 'src'] });
  let lastMessage = '';
  let wasFullscreen = false;
  let focusTimer: unknown = null;
  /** Leaving full screen with Escape drops focus on the container: put it back on the Full screen key. */
  const returnFocus = (): void => {
    focusTimer = null;
    const active = doc.activeElement;
    if (!active || active === host || active === doc.body) controls.full.focus();
  };
  let loadingTimer: unknown = null;
  const idle = watchIdle(host, controls.root, doc, clock, signal);
  const extras = mountExtras({ host, media, stage, controller, doc, clock, signal, title, frameReader: options.frameReader, drawer: options.drawer ?? !(host.getAttribute('reel-drawer') === 'off' || media.getAttribute?.('reel-drawer') === 'off'), loadArt: options.loadDrawerArt, emberLayers: options.emberLayers ?? !(host.getAttribute('reel-ember-layers') === 'off' || media.getAttribute?.('reel-ember-layers') === 'off') });
  // The full screen sentence line (the strip) is ink on the picture too: it takes white or graphite from the sampler.
  extras.etched.register({ el: strip.root, box: () => {
    // The sentence as drawn (first word to last word), not the width of its container.
    const a = stage.getBoundingClientRect(); const words = strip.root.querySelectorAll('.sr-word');
    if (!(a.width > 0) || words.length === 0) return null;
    const first = words[0].getBoundingClientRect(); const last = words[words.length - 1].getBoundingClientRect();
    return { x0: (Math.min(first.left, last.left) - a.left) / a.width, y0: (Math.min(first.top, last.top) - a.top) / a.height, x1: (Math.max(first.right, last.right) - a.left) / a.width, y1: (Math.max(first.bottom, last.bottom) - a.top) / a.height };
  } });
  const stop = controller.subscribe((state) => {
    if (state.buffering && loadingTimer === null) loadingTimer = clock.setTimeout(() => status.announce(LABELS.loading), LOADING_ANNOUNCE_MS);
    else if (!state.buffering && loadingTimer !== null) { clock.clearTimeout(loadingTimer); loadingTimer = null; }
    if (wasFullscreen && !state.fullscreen) {
      if (focusTimer !== null) clock.clearTimeout(focusTimer);
      focusTimer = clock.setTimeout(returnFocus, FOCUS_RETURN_MS);
    }
    wasFullscreen = state.fullscreen;
    controls.update(state);
    idle(state);
    extras.onState(state);
    // Where scripts cannot set the volume (iPhone, iPad) the level cluster is hidden in every arrangement.
    host.toggleAttribute('data-volume-readonly', !state.volumeSettable);
    sentenceWindow.update(state);
    strip.update(state);
    host.toggleAttribute('data-strip', state.captionsOn && state.captionsAvailable && !!state.sentence && !state.sentence.synthetic);
    // The text first, then the element is shown: the alert is read when it appears. (It is an alert, so the status region does not repeat it.)
    if (messageText.textContent !== state.message) messageText.textContent = state.message;
    if (message.hidden !== !state.message) message.hidden = !state.message;
    if (retryButton.hidden === state.failed) retryButton.hidden = !state.failed;
    messageTitle.hidden = !state.failed; messageHint.hidden = !state.failed;
    message.setAttribute('data-kind', state.failed ? 'error' : 'note');
    lastMessage = state.message;
  });

  const handle: ReelHandle = {
    controller,
    etched: extras.etched,
    destroy(): void {
      abort.abort();
      watcher?.disconnect();
      if (focusTimer !== null) clock.clearTimeout(focusTimer);
      if (loadingTimer !== null) clock.clearTimeout(loadingTimer);
      if (noteTimer !== null) clock.clearTimeout(noteTimer);
      extras.destroy();
      untabbed();
      stop();
      stopNav();
      controller.destroy();
      status.destroy();
      art.remove();
      sentenceWindow.root.remove();
      strip.root.remove();
      pictureGuard.release();
      host.removeAttribute('data-strip');
      message.remove();
      controls.root.remove();
      stage.before(media);
      stage.remove();
      host.className = restore.className;
      if (!host.className) host.removeAttribute('class');
      for (const [name, value] of [['tabindex', restore.tabindex], ['role', restore.role], ['aria-label', restore.label]] as const) {
        if (value === null) host.removeAttribute(name); else host.setAttribute(name, value);
      }
      if (mounted.get(host) === handle) mounted.delete(host);
    },
  };
  mounted.set(host, handle);
  return handle;
}

/**
 * The video container (Video.js puts tabindex 0 on its media container) is not a control, so it comes
 * out of the Tab order while the reel is mounted. It is kept out if the page sets it again, and put back
 * on destroy. Returns the function that undoes it.
 */
function removeFromTabOrder(host: HTMLElement, media: HTMLMediaElement, signal: AbortSignal): () => void {
  const saved = new Map<HTMLElement, string>();
  const watchers: MutationObserver[] = [];
  for (let node: HTMLElement | null = media; node && node !== host; node = node.parentElement) {
    const target = node;
    const take = (): void => {
      const value = target.getAttribute('tabindex');
      if (value !== null && Number(value) >= 0) {
        if (!saved.has(target)) saved.set(target, value);
        target.setAttribute('tabindex', '-1');
      }
    };
    take();
    if (typeof MutationObserver === 'function') {
      const watcher = new MutationObserver(take);
      watcher.observe(target, { attributes: true, attributeFilter: ['tabindex'] });
      watchers.push(watcher);
    }
  }
  const undo = (): void => {
    for (const w of watchers) w.disconnect();
    for (const [node, value] of saved) node.setAttribute('tabindex', value);
    saved.clear();
  };
  signal.addEventListener('abort', () => undo(), { once: true });
  return undo;
}
