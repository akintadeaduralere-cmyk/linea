import type { ReelController } from './controller.ts';
import { captionTracks } from './cues.ts';
import { el, uid } from './dom.ts';
import { captionOptions, ladder, nearestRate, PLAYBACK_RATES, rateText, renditionsOf, selectedRendition, selectRendition, stepRate } from './media-bindings.ts';
import { Outputs } from './outputs.ts';

/**
 * The settings drawer, behaviour only (05-design/DIGITAL-SYSTEM.md 3.8). Its look (the machined plate, the toggle bank, the S2 slam) is added
 * by the stylesheet later through the classes and data attributes written here; nothing in this file draws.
 *
 * - A pull button (aria-expanded, aria-controls) opens a non-modal dialog. NO focus trap: Tab moves through it and on into the deck.
 *   Escape or the pull closes it and focus goes back to the pull. In the top layer (popover="manual") where the browser has it.
 * - SPEED: role=slider over the Video.js rates (0.5, 1, 1.25, 1.5, 2); arrows step, Home and End jump; Slower and Faster buttons are the
 *   single-pointer alternative to turning it.
 * - WORDS and QUALITY: role=radiogroup (OFF or AUTO, then the options), arrows move and choose. QUALITY is hidden where there is only one rendition.
 * - OUTPUT: Pop out and AirPlay, each shown only when available; the group is hidden when neither is.
 * - The drawer's art loads on the first pull (`loadArt`), so the resting image budget does not change.
 */
export interface DrawerOptions {
  media: HTMLMediaElement;
  controller: ReelController;
  host: HTMLElement;
  doc: Document;
  signal: AbortSignal;
  /** Fetches the drawer's art on the first pull; the stylesheet shows it when data-art is "ready". */
  loadArt?: () => Promise<void>;
}

export interface Drawer {
  pull: HTMLButtonElement;
  /** Pop out, AirPlay and Cast: the picture's top-right group. */
  outs: HTMLElement;
  panel: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** Re-read the media's rates, tracks, renditions and outputs (called on the media's own events). */
  refresh(): void;
}

/** The knob art has its index at 1.25 (45 degrees); each detent is where the index points (anchors.json tray.detentsDeg). */
const DETENT_DEG: Record<number, number> = { 0.5: 135, 1: 90, 1.25: 45, 1.5: 0, 2: -45 };

export const DRAWER_LABELS = { settings: 'Settings', speed: 'Speed', slower: 'Slower', faster: 'Faster', words: 'Language', off: 'Off', quality: 'Quality', auto: 'Auto', output: 'Output', popOut: 'Pop out', airplay: 'AirPlay', cast: 'Cast', watchElsewhere: 'Watch elsewhere', unavailable: 'Not available in this browser or on this device' } as const;

export function buildDrawer(o: DrawerOptions): Drawer {
  const { media, controller, host, doc, signal } = o;
  const id = uid('sr-drawer');
  const pull = el('button', 'sr-pull', { type: 'button', 'aria-expanded': 'false', 'aria-controls': id, 'aria-haspopup': 'dialog' }, DRAWER_LABELS.settings);
  const panel = el('div', 'sr-drawer', { id, role: 'dialog', 'aria-label': DRAWER_LABELS.settings, 'data-art': 'none' });
  panel.hidden = true;
  // The tray sits on the deck in art millimetres, inside the player (not in the top layer), so it moves and scales with it.
  const supportsPopover = false as boolean;
  let artStarted = false;
  let isOpen = false;

  const group = (name: string, key: string): { box: HTMLElement; label: HTMLElement } => {
    const box = el('div', 'sr-group', { 'data-group': key });
    const label = el('span', 'sr-group-label', { id: uid('sr-gl') }, name);
    box.append(label);
    return { box, label };
  };

  // ---- Speed: a slider over the Video.js rates.
  const speed = group(DRAWER_LABELS.speed, 'speed');
  const dial = el('div', 'sr-dial', { role: 'slider', tabindex: '0', 'aria-labelledby': speed.label.id, 'aria-valuemin': String(PLAYBACK_RATES[0]), 'aria-valuemax': String(PLAYBACK_RATES[PLAYBACK_RATES.length - 1]) });
  // Slower and Faster stay as named buttons for assistive technology and switch access; for the pointer the two halves of the dial itself do the same (so the dial is one large target, not two buttons laid over it).
  const slower = el('button', 'sr-dial-down', { type: 'button', tabindex: '-1' }, DRAWER_LABELS.slower);
  const faster = el('button', 'sr-dial-up', { type: 'button', tabindex: '-1' }, DRAWER_LABELS.faster);
  const knob = el('i', 'sr-tray-knob', { 'aria-hidden': 'true' });
  const detents = PLAYBACK_RATES.map((r) => el('span', 'sr-detent', { 'data-rate': String(r), 'aria-hidden': 'true' }, String(r)));
  speed.box.append(knob, ...detents, slower, dial, faster);
  const setRate = (rate: number): void => { media.playbackRate = rate; refreshSpeed(); };
  slower.addEventListener('click', () => setRate(stepRate(media.playbackRate, -1)), { signal });
  faster.addEventListener('click', () => setRate(stepRate(media.playbackRate, 1)), { signal });
  dial.addEventListener('click', (e) => {
    const box = dial.getBoundingClientRect();
    setRate(stepRate(media.playbackRate, e.clientX < box.left + box.width / 2 ? -1 : 1));
  }, { signal });
  dial.addEventListener('keydown', (e) => {
    const k = e.key;
    let next: number | null = null;
    if (k === 'ArrowRight' || k === 'ArrowUp' || k === 'PageUp') next = stepRate(media.playbackRate, 1);
    else if (k === 'ArrowLeft' || k === 'ArrowDown' || k === 'PageDown') next = stepRate(media.playbackRate, -1);
    else if (k === 'Home') next = PLAYBACK_RATES[0];
    else if (k === 'End') next = PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
    if (next === null) return;
    e.preventDefault();
    setRate(next);
  }, { signal });
  function refreshSpeed(): void {
    const r = nearestRate(media.playbackRate || 1);
    dial.setAttribute('aria-valuenow', String(r));
    dial.setAttribute('aria-valuetext', rateText(r));
    dial.textContent = `${r}\u00d7`;
    knob.style.setProperty('--detent-deg', `${DETENT_DEG[r] ?? 45}deg`);
    slower.setAttribute('aria-disabled', String(r === PLAYBACK_RATES[0]));
    faster.setAttribute('aria-disabled', String(r === PLAYBACK_RATES[PLAYBACK_RATES.length - 1]));
  }

  // ---- A radio group: roving tabindex, arrows move and choose.
  function radioGroup(name: string, key: string): { box: HTMLElement; list: HTMLElement; render(options: { id: string; legend: string; label: string }[], checked: string, choose: (id: string) => void): void } {
    const g = group(name, key);
    const list = el('div', 'sr-radios', { role: 'radiogroup', 'aria-labelledby': g.label.id });
    g.box.append(list);
    return {
      box: g.box,
      list,
      render(options, checked, choose) {
        // Only when something changed: a redraw while a radio has focus would drop it.
        const sig = JSON.stringify([options, checked]);
        if (list.getAttribute('data-sig') === sig) return;
        list.setAttribute('data-sig', sig);
        list.replaceChildren();
        const radios = options.map((opt) => {
          const on = opt.id === checked;
          const r = el('button', 'sr-radio', { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': opt.label, tabindex: on ? '0' : '-1', 'data-id': opt.id }, opt.legend);
          r.addEventListener('click', () => choose(opt.id), { signal });
          r.addEventListener('keydown', (e) => {
            const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            const to = radios[(radios.indexOf(r) + dir + radios.length) % radios.length];
            to.focus();
            choose(to.getAttribute('data-id') ?? '');
          }, { signal });
          return r;
        });
        if (!radios.some((r) => r.tabIndex === 0) && radios[0]) radios[0].tabIndex = 0;
        list.append(...radios);
      },
    };
  }

  // ---- Words: Off, then one per caption track. Off is the window lamp; a track also becomes the one followed.
  const words = radioGroup(DRAWER_LABELS.words, 'words');
  let chosenTrack = 0;
  function refreshWords(on = controller.state().captionsOn): void {
    const options = captionOptions(media);
    words.box.hidden = options.length === 0;
    if (options.length === 0) return;
    const all = [{ id: 'off', legend: DRAWER_LABELS.off.toUpperCase(), label: DRAWER_LABELS.off }, ...options.map((t) => ({ id: String(t.index), legend: t.language, label: t.label }))];
    words.render(all, on ? String(Math.min(chosenTrack, options.length - 1)) : 'off', (pick) => {
      if (pick === 'off') { controller.setWords(false); } else {
        chosenTrack = Number(pick);
        controller.setWords(true);
        const tracks = captionTracks(media); // the same order as the tiles (captions first), so a tile switches on its own track
        tracks.forEach((t, i) => { if (i === chosenTrack) t.mode = 'showing'; else if (t.mode === 'showing') t.mode = 'hidden'; });
      }
      refreshWords();
    });
  }

  // ---- Quality: Auto, then the renditions, tallest first. Hidden where there is only one.
  const quality = radioGroup(DRAWER_LABELS.quality, 'quality');
  function refreshQuality(): void {
    const all = renditionsOf(media);
    const list = ladder(all);
    quality.box.hidden = all.length < 2;
    qualityStep.hidden = all.length < 2;
    if (all.length < 2) return;
    // The compact form for narrow trays: one tile that steps through Auto and the renditions (the full row is used where it fits).
    const steps = ['auto', ...list.map((r) => r.id)];
    const now = selectedRendition(media);
    const named = now === 'auto' ? DRAWER_LABELS.auto.toUpperCase() : (list.find((r) => r.id === now)?.label ?? DRAWER_LABELS.auto.toUpperCase());
    qualityStep.querySelector('.sr-q-now')!.textContent = named;
    qualityStep.setAttribute('aria-label', `${DRAWER_LABELS.quality}: ${named === 'AUTO' ? DRAWER_LABELS.auto : named + ' p'}`);
    qualityStep.onclick = () => { const i = steps.indexOf(now); selectRendition(media, steps[(i + 1) % steps.length]); refreshQuality(); };
    quality.render([{ id: 'auto', legend: DRAWER_LABELS.auto.toUpperCase(), label: DRAWER_LABELS.auto }, ...list.map((r) => ({ id: r.id, legend: r.label, label: `${r.label} p` }))], selectedRendition(media), (pick) => { selectRendition(media, pick); refreshQuality(); });
  }

  // ---- Output: Pop out and AirPlay, each only when available.
  const output = group(DRAWER_LABELS.output, 'output');
  const popOut = el('button', 'sr-output', { type: 'button', 'data-output': 'pip', 'aria-pressed': 'false' }, DRAWER_LABELS.popOut);
  const airplay = el('button', 'sr-output', { type: 'button', 'data-output': 'airplay', 'aria-pressed': 'false' }, DRAWER_LABELS.airplay);
  const cast = el('button', 'sr-output', { type: 'button', 'data-output': 'cast', 'aria-pressed': 'false' }, DRAWER_LABELS.cast);
  const icon = (): HTMLElement => el('i', 'sr-ic', { 'aria-hidden': 'true' });
  popOut.append(icon()); airplay.append(icon()); cast.append(icon());
  const outputRow = el('div', 'sr-outputs');
  const qualityStep = el('button', 'sr-output sr-q-step', { type: 'button', 'data-output': 'quality' });
  qualityStep.append(el('span', 'sr-q-now', { 'aria-hidden': 'true' }, 'AUTO'), el('span', 'sr-q-name', { 'aria-hidden': 'true' }, DRAWER_LABELS.quality));
  qualityStep.hidden = true;
  // Full screen shows the whole picture, never cropped (owner, 12 Nov 2026: a zoom cut the credits "This film is supported by the
  // Netherlands Film Fund" off the edge). A skin plays other people's videos and cannot know what sits at their edges, so it never
  // zooms or crops: the film is as large as the screen allows, and any band left is the film's own shape.
  const big = (): boolean => doc.fullscreenElement === host || host.hasAttribute('data-theatre');
  // Captions on the picture sit in the black band under the film when there is room (owner, 12 Nov 2026: precision): the band is
  // measured from the film's real shape; 72 px or more holds two lines, so the caption is centred in it, never straddling the
  // picture's edge. Without a band (most phones sideways) it stays on the picture.
  const BAND_MIN_PX = 72;
  const syncBand = (): void => { doc.defaultView?.requestAnimationFrame(() => {
    const box = host.querySelector('.sr-stage')?.getBoundingClientRect();
    const vw = (media as HTMLVideoElement).videoWidth, vh = (media as HTMLVideoElement).videoHeight;
    const band = big() && box && vw && vh ? Math.max(0, (box.height - Math.min(box.height, box.width * vh / vw)) / 2) : 0;
    host.style.setProperty('--sr-band', `${Math.round(band)}px`);
    host.toggleAttribute('data-band', band >= BAND_MIN_PX);
  }); };
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) doc.addEventListener(type, syncBand, { signal });
  doc.defaultView?.addEventListener('resize', syncBand, { signal });
  for (const type of ['loadedmetadata', 'loadeddata', 'resize', 'playing']) media.addEventListener(type, syncBand, { signal });
  const bandWatch = doc.defaultView?.MutationObserver ? new doc.defaultView.MutationObserver(syncBand) : undefined;
  bandWatch?.observe(host, { attributes: true, attributeFilter: ['data-theatre'] });
  signal.addEventListener('abort', () => bandWatch?.disconnect());
  // Control map (owner, 12 Nov 2026): Pop out, AirPlay and Cast sit on the picture, top right, where viewers look for them;
  // the tray keeps Speed, Language and Quality. The quality step tile is no longer needed: the phone tray has room for the row.
  const outs = el('div', 'sr-outs', { role: 'group', 'aria-label': DRAWER_LABELS.watchElsewhere });
  // Icon keys: the name stays as live text (read aloud, translatable) but visually hidden, and shows as the tooltip; the key draws only its icon.
  for (const b of [popOut, airplay, cast]) {
    const name = (b.textContent ?? '').trim();
    b.setAttribute('title', name); b.dataset.name = name;
    for (const n of [...b.childNodes]) if (n.nodeType === 3) n.remove();
    b.prepend(el('span', 'sr-vh', {}, name));
  }
  outs.append(popOut, airplay, cast);
  outputRow.append(qualityStep);
  output.box.append(outputRow);
  const outputs = new Outputs(media, doc, signal, () => refreshOutputs());
  popOut.addEventListener('click', () => { if (outputs.pip.available) void outputs.togglePip(); }, { signal });
  airplay.addEventListener('click', () => { if (outputs.airplay.available) outputs.showAirPlay(); }, { signal });
  cast.addEventListener('click', () => { if (outputs.cast.available) outputs.showCast(); }, { signal });
  function refreshOutputs(): void {
    const pip = outputs.pip; const ap = outputs.airplay; const ca = outputs.cast;
    // Always shown, so every viewer sees the full set (owner, 12 Nov 2026); where this device cannot do it the tile is
    // dimmed and says so, and a press does nothing.
    for (const [b, o] of [[popOut, pip], [airplay, ap], [cast, ca]] as const) {
      b.hidden = false;
      b.setAttribute('aria-disabled', String(!o.available));
      const name = b.dataset.name ?? ''; b.setAttribute('title', o.available ? name : `${name}: ${DRAWER_LABELS.unavailable}`);
    }
    popOut.setAttribute('aria-pressed', String(pip.active)); airplay.setAttribute('aria-pressed', String(ap.active)); cast.setAttribute('aria-pressed', String(ca.active));
    output.box.hidden = true;
  }

  // The panel is a clip window at the body's lower edge; the plate and its parts slide up inside it (board F: the tray slides out of the body edge).
  const inner = el('div', 'sr-tray-in');
  // The tiles are drawn from what the media offers and flow in this order (words, output, quality); an empty group is hidden and the rest re-flow.
  const tiles = el('div', 'sr-tiles');
  tiles.append(words.box, output.box, quality.box);
  inner.append(speed.box, tiles);
  panel.append(inner);
  const refresh = (): void => { refreshSpeed(); refreshWords(); refreshQuality(); refreshOutputs(); };

  // The deck's keys sit under the open tray: inert (no focus, no pointer, not read) until it closes.
  const setDeckInert = (on: boolean): void => { host.querySelectorAll<HTMLElement>('.sr-keys, .sr-again, .sr-next, .sr-time-toggle').forEach((k) => { k.inert = on; }); };
  function open(): void {
    if (isOpen) return;
    isOpen = true;
    setDeckInert(true);
    if (closeTimer !== undefined) { doc.defaultView?.clearTimeout(closeTimer); closeTimer = undefined; }
    panel.removeAttribute('data-closing');
    refresh();
    panel.hidden = false;
    if (supportsPopover) { try { (panel as unknown as { showPopover(): void }).showPopover(); } catch { /* already showing */ } }
    pull.setAttribute('aria-expanded', 'true');
    host.setAttribute('data-drawer', 'open');
    // However many rows the media gives the tray (Quality appears with a stream), the SETTINGS tab moves to sit just below it, never under it.
    // Placed at once, from the tray's laid-out height (its slide-in is a transform and does not change layout), so the tab is never left over the tiles
    // while the tray arrives; measured again once the tray has settled, in case a row arrived late.
    placePull();
    doc.defaultView?.setTimeout(placePull, 600);
    if (!artStarted) {
      artStarted = true;
      panel.setAttribute('data-art', 'loading');
      Promise.resolve(o.loadArt?.()).then(() => panel.setAttribute('data-art', 'ready'), () => panel.setAttribute('data-art', 'failed'));
    }
  }
  let pullShift = 0;
  function placePull(): void {
    if (!isOpen || big()) return;   // full screen: tab and tray sit top right, nothing to move
    // Measured on the drawer, which holds still while the tray slides in inside it (their bottoms are the same once it has settled).
    // Where a page shows the player scaled (a zoomed or transformed preview), drawn pixels and the tab's own pixels differ by that scale.
    const scale = host.offsetWidth > 0 ? host.getBoundingClientRect().width / host.offsetWidth || 1 : 1;
    // The tab's resting top is its drawn top less the shift it is showing right now (it may be mid-glide).
    const shown = parseFloat((doc.defaultView?.getComputedStyle(pull).translate ?? '').split(' ')[1] ?? '0') || 0;
    const restTop = pull.getBoundingClientRect().top - shown * scale;
    const gap = Math.ceil((panel.getBoundingClientRect().bottom - restTop) / scale + 6);
    const next = gap > 0 ? gap : 0;
    if (next === pullShift) return;
    pullShift = next;
    pull.style.translate = next ? `0 ${next}px` : '';
  }
  const restPull = (): void => { pullShift = 0; pull.style.translate = ''; };
  let closeTimer: number | undefined;
  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    setDeckInert(false);
    if (supportsPopover) { try { (panel as unknown as { hidePopover(): void }).hidePopover(); } catch { /* already hidden */ } }
    pull.setAttribute('aria-expanded', 'false');
    host.removeAttribute('data-drawer');
    // It slides back down in 240 ms (E) unless motion is reduced (then it just goes).
    const win = doc.defaultView;
    const motion = win?.matchMedia?.('(prefers-reduced-motion: no-preference)').matches === true;
    if (!motion) { restPull(); panel.hidden = true; return; }
    panel.setAttribute('data-closing', '');
    // The tab comes back only once the tray has gone, so it never crosses the tiles on the way.
    closeTimer = win?.setTimeout(() => { closeTimer = undefined; panel.removeAttribute('data-closing'); if (!isOpen) { panel.hidden = true; restPull(); } }, 240);
  }
  pull.addEventListener('click', () => { if (isOpen) { close(); } else open(); }, { signal });
  // Escape closes from anywhere in the drawer or on the pull, and focus returns to the pull. No trap: Tab is never intercepted.
  const escape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !isOpen) return;
    const t = e.target as Node;
    // A tile rebuilt by refresh() (a language or quality change) drops focus to the body, so the body counts as "in the drawer" too.
    if (panel.contains(t) || host.contains(t) || t === doc.body || t === doc.documentElement) { e.preventDefault(); close(); pull.focus({ preventScroll: true }); }
  };
  doc.addEventListener('keydown', escape, { signal });
  for (const type of ['ratechange', 'loadedmetadata', 'emptied']) media.addEventListener(type, () => { if (isOpen) refresh(); }, { signal });
  const lists: (EventTarget | undefined)[] = [media.textTracks as unknown as EventTarget, (media as unknown as { videoRenditions?: EventTarget }).videoRenditions];
  for (const l of lists) for (const type of ['addtrack', 'removetrack', 'change', 'addrendition', 'removerendition']) l?.addEventListener?.(type, () => { if (isOpen) refresh(); }, { signal });
  controller.subscribe((state) => { if (isOpen) refreshWords(state.captionsOn); });
  return { pull, panel, outs, get isOpen() { return isOpen; }, open, close, refresh };
}
