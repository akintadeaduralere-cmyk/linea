import { BAKED_RING_NOTCHES, NOTCH_NUMBERS_MAX, NOTCH_NUMBER_STEP, REEL_PAGE_SENTENCES, SEEK_STEP_SECONDS } from './constants.ts';
import type { ReelController } from './controller.ts';
import { el, hint, setAttr } from './dom.ts';
import { LABELS, sentenceStatus } from './labels.ts';
import { coveredNotches, notchOf, planNotches, type NotchPlan } from './notches.ts';
import { buildDiscText } from './disc-text.ts';
import { DialDrag, conicAngle, notchUnder } from './reel-drag.ts';
import { sliderIntent } from './slider-keys.ts';
import type { ReelState } from './types.ts';

export interface ReelView {
  /** The slider itself. */
  root: HTMLElement;
  /** Its description, to be placed in the player. */
  hint: HTMLElement;
  update(state: ReelState): void;
}

/**
 * The reel: a slider that moves one sentence at a time. Up to 40 notches are drawn; more sentences
 * share notches. While it has focus and the film plays, its spoken value is left alone so the screen
 * reader does not talk over the film; any move the viewer makes updates it at once.
 */
export function buildReel(c: ReelController, signal: AbortSignal, rtl: () => boolean, title = ''): ReelView {
  const description = hint(LABELS.reelHint);
  const root = el('div', 'sr-reel', {
    role: 'slider', tabindex: '0', 'aria-label': LABELS.reel, 'aria-describedby': description.id, 'aria-valuemin': '0', 'aria-valuenow': '0',
  });
  const notches = el('span', 'sr-notches', { 'aria-hidden': 'true' });
  const fine = el('span', 'sr-fine', { 'aria-hidden': 'true' });
  const disc = buildDiscText(root, signal, title);
  // The fine bead ring on the free edge: the pearls turn with the ring (the outer element is the mask), their colour does not (the inner one is turned back by the same angle).
  const beads = el('span', 'sr-beads', { 'aria-hidden': 'true' });
  beads.append(el('i', 'sr-beads-light'));
  // The baked ring for a 16-sentence film: three static pictures (unplayed, played through a mask, the current notch). Present always, shown and loaded only for 16 notches.
  const ring = el('span', 'sr-ring', { 'aria-hidden': 'true' });
  ring.append(el('i', 'sr-ring-unplayed'), el('i', 'sr-ring-played'), el('i', 'sr-ring-current'));
  // Smoked glass draws one fine tick per spoken line as vector strokes (hidden on silver by look-smoked.css): every tick the same width, every fifth longer.
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ticks = document.createElementNS(SVGNS, 'svg');
  ticks.setAttribute('class', 'sr-ticks'); ticks.setAttribute('aria-hidden', 'true'); ticks.setAttribute('focusable', 'false'); ticks.setAttribute('viewBox', '-170 -170 340 340');
  const tickAll = document.createElementNS(SVGNS, 'path'); tickAll.setAttribute('class', 'sr-tk-all');
  const tickLit = document.createElementNS(SVGNS, 'path'); tickLit.setAttribute('class', 'sr-tk-lit');
  const tickNow = document.createElementNS(SVGNS, 'path'); tickNow.setAttribute('class', 'sr-tk-now');
  ticks.append(tickAll, tickLit, tickNow);
  let tickCount = -1; let tickLine = -1;
  /** Tick i stands at i steps anticlockwise from the top, so the ring turning clockwise brings line after line under the NOW index. */
  let longNow = -1;
  const tickPath = (from: number, to: number, count: number): string => {
    let d = '';
    for (let i = from; i < to; i += 1) {
      const a = (i / count) * 2 * Math.PI; const sx = -Math.sin(a); const cy = -Math.cos(a); const r0 = i % 5 === 0 || longNow === i ? 150 : 156;
      d += `M${(sx * r0).toFixed(2)} ${(cy * r0).toFixed(2)}L${(sx * 165).toFixed(2)} ${(cy * 165).toFixed(2)}`;
    }
    return d;
  };
  const drawTicks = (count: number, line: number): void => {
    if (count !== tickCount) { tickCount = count; tickAll.setAttribute('d', count > 0 ? tickPath(0, count, count) : ''); tickLine = -1; }
    if (line !== tickLine) {
      tickLine = line;
      // The played ticks, and under NOW the current one as a fine full-length needle running on from the index.
      tickLit.setAttribute('d', count > 0 && line > 1 ? tickPath(0, Math.min(line - 1, count), count) : '');
      longNow = line - 1; tickNow.setAttribute('d', count > 0 && line > 0 ? tickPath(line - 1, line, count) : ''); longNow = -1;
    }
  };
  root.append(ring, notches, fine, disc.root, beads, ticks);
  let notchEls: HTMLElement[] = [];
  let current = -2;
  let lastNav = 0;
  let syncedCount = 0;
  let syncedKnown = false;

  const move = (to: number): void => c.seekToIndex(to, 'reel');
  root.addEventListener('keydown', (e) => {
    if (root.getAttribute('aria-disabled') === 'true') return;
    const intent = sliderIntent({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, rtl: rtl() });
    if (!intent) return;
    e.preventDefault();
    const s = c.state();
    if (intent.type === 'home') move(0);
    else if (intent.type === 'end') move(s.count - 1);
    else if (intent.type === 'page') move(s.index + intent.delta * REEL_PAGE_SENTENCES);
    else if (intent.shift) c.seekBy(intent.delta * SEEK_STEP_SECONDS);
    else move(s.index + intent.delta);
  }, { signal });

  // Turning the reel by hand. The ring follows the pointer like a wheel, the same for a mouse, a finger and a pen:
  //   - a counter-clockwise drag goes forward (the way the disc turns for Next and the Right arrow), one sentence per notch pitch;
  //   - a clockwise drag goes back; so dragging a notch toward the index (the NOW mark at nine o'clock) brings that sentence to NOW;
  //   - a press and release on a notch without moving (a tap) goes to that notch;
  //   - the drag stops at the first and at the last sentence, it never wraps round to the other end.
  // The pointer is captured, so a drag that leaves the disc goes on.
  let drag: DialDrag | null = null;
  let dragPointer = -1;
  let lastNotch = -1;
  /** The notch pressed on (a tap goes to it), or -1 when the press was not on a notch. */
  let tapNotch = -1;
  let smokedDrag = false;
  let lastStart = 0;
  let moved = false;
  /** The disc's centre and scale, read once when a press begins (not on every move: a drag must not force a layout per pointer event). */
  let geo: { cx: number; cy: number; perMm: number } | null = null;
  const readGeo = (): void => {
    const r = root.getBoundingClientRect();
    geo = r.width > 0 ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, perMm: r.width / ((cssNumber(root, '--disc') || 74) * 2 + 0.4) } : null;
  };
  const polar = (e: PointerEvent): { angle: number; mm: number } | null => {
    if (!geo) readGeo();
    if (!geo) return null;
    const dx = e.clientX - geo.cx;
    const dy = e.clientY - geo.cy;
    return { angle: conicAngle(dx, dy), mm: Math.hypot(dx, dy) / geo.perMm };
  };
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || root.getAttribute('aria-disabled') === 'true') return;
    readGeo();
    const at = polar(e);
    const s = c.state();
    if (!at || !s.ready) return;
    // Smoked glass: one tick per line, NOW at twelve o'clock, the ring turning clockwise as the film plays (earlier lines lie clockwise of NOW).
    smokedDrag = root.closest('.sr-smoked') !== null;
    const plan = planNotches(s.count);
    const now = smokedDrag ? s.index : notchOf(plan, s.index);
    const count = smokedDrag ? s.count : plan.count;
    const inBand = at.mm >= (cssNumber(root, '--band-in') || 61.5) - 2 && at.mm <= (cssNumber(root, '--band-out') || 70.5) + 2;
    tapNotch = !inBand ? -1 : smokedDrag ? (((Math.round(now - at.angle / (360 / Math.max(1, count)))) % count) + count) % count : notchUnder(at.angle, plan.count, now);   // the line drawn under the pointer, all the way round
    moved = false;
    drag = new DialDrag(at.angle, now, count);
    dragPointer = e.pointerId;
    lastNotch = now; lastStart = now;
    try { root.setPointerCapture(e.pointerId); } catch { /* capture is a nicety: the drag still works while the pointer stays on the disc */ }
    root.focus({ preventScroll: true });
    e.preventDefault();
  }, { signal });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== dragPointer) return;
    const at = polar(e);
    if (!at) return;
    const back = drag.move(at.angle);
    const notch = smokedDrag ? Math.min(c.state().count - 1, Math.max(0, lastStart + Math.round(drag.turnedPitches))) : back;
    // Turned by more than half a pitch (even if the first or last sentence stops it) is a drag, not a tap.
    if (Math.abs(drag.turnedPitches) >= 0.5) moved = true;
    if (notch === lastNotch) return;
    lastNotch = notch;
    move(smokedDrag ? notch : planNotches(c.state().count).firstIndex[notch]);
  }, { signal });
  const release = (e: PointerEvent): void => {
    if (e.pointerId !== dragPointer) return;
    // A tap: pressed on a notch and let go without turning the reel.
    if (e.type === 'pointerup' && !moved && tapNotch >= 0) move(smokedDrag ? tapNotch : planNotches(c.state().count).firstIndex[tapNotch]);
    drag = null;
    dragPointer = -1;
    tapNotch = -1;
    try { root.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  root.addEventListener('pointerup', release, { signal });
  root.addEventListener('pointercancel', release, { signal });

  /** The covered arc, as a fraction range the layout sets in CSS (zero on phone, so every number shows). */
  function applyCovered(): void {
    const covered = coveredNotches(notchEls.length, cssNumber(root, '--sr-glass-start'), cssNumber(root, '--sr-glass-end'));
    notchEls.forEach((n, i) => {
      if (covered[i]) n.setAttribute('data-covered', ''); else n.removeAttribute('data-covered');
    });
  }

  function drawNotches(plan: NotchPlan): void {
    notchEls = plan.firstIndex.map((first, k) => {
      const notch = el('span', 'sr-notch');
      notch.append(el('i', 'sr-notch-face'));
      notch.setAttribute('data-number', String(first + 1).padStart(2, '0'));
      notch.style.setProperty('--i', String(k));
      if ((k + 1) % NOTCH_NUMBER_STEP === 0) notch.setAttribute('data-fifth', '');
      return notch;
    });
    root.style.setProperty('--n', String(plan.count));
    if (plan.count === BAKED_RING_NOTCHES) root.setAttribute('data-ring16', ''); else root.removeAttribute('data-ring16');
    notches.replaceChildren(...notchEls);
    if (plan.count <= NOTCH_NUMBERS_MAX) notches.setAttribute('data-numbered', ''); else notches.removeAttribute('data-numbered');
    // Above that, only every fifth notch carries its number.
    if (plan.count > NOTCH_NUMBERS_MAX) notches.setAttribute('data-fifth', ''); else notches.removeAttribute('data-fifth');
    current = -2;
    applyCovered();
  }

  // The layout can change (rotate, zoom, container size) without the sentences changing.
  const view = root.ownerDocument.defaultView;
  if (typeof ResizeObserver === 'function') {
    const watcher = new ResizeObserver(() => applyCovered());
    watcher.observe(root);
    signal.addEventListener('abort', () => watcher.disconnect(), { once: true });
  } else view?.addEventListener('resize', () => applyCovered(), { signal });

  function update(s: ReelState): void {
    const plan = planNotches(s.count);
    if (plan.count !== notchEls.length) drawNotches(plan);
    // With no sentence known the ring shows its neutral form (a drawn ring of dark segments), not an empty hole.
    if (plan.count === 0) setAttr(notches, 'data-empty', ''); else notches.removeAttribute('data-empty');
    const now = s.ready ? notchOf(plan, s.index) : -1;
    if (now !== current) {
      notchEls.forEach((n, i) => {
        if (i === now) n.setAttribute('data-current', '');
        else n.removeAttribute('data-current');
        if (i < now) n.setAttribute('data-played', '');
        else n.removeAttribute('data-played');
      });
      current = now;
      root.style.setProperty('--sr-now', String(Math.max(0, now)));
    }
    // The line list is often complete before the media is ready (the seek slots are drawn from it at rest): smoked glass counts from it.
    const listed = c.sentenceList().length; const lineCount = s.count > 0 ? s.count : listed;
    disc.update(s, lineCount);
    drawTicks(lineCount, s.ready && s.count > 0 ? s.index + 1 : 0);
    // The smoked-glass skin prints "LINE 04 / 86" in its caption window from these two (CSS counters); the silver look does not use them.
    const host = root.closest<HTMLElement>('.sr-player');
    if (host && !host.hasAttribute('data-sr-lines')) {
      // Leave the host's markup as it was found when the player is taken down.
      host.setAttribute('data-sr-lines', '');
      signal.addEventListener('abort', () => { host.style.removeProperty('--sr-line'); host.style.removeProperty('--sr-lines'); host.removeAttribute('data-sr-lines'); if (!host.getAttribute('style')) host.removeAttribute('style'); }, { once: true });
    }
    if (host) {
      const line = String(s.ready && s.count > 0 ? s.index + 1 : 0), lines = String(lineCount);
      if (host.style.getPropertyValue('--sr-line') !== line) host.style.setProperty('--sr-line', line);
      if (host.style.getPropertyValue('--sr-lines') !== lines) host.style.setProperty('--sr-lines', lines);
    }
    // The plain layout's progress bar only (hidden in the look): written only when it moves a visible amount.
    const prog = (Math.round(s.progress * 50) / 50).toFixed(2);
    if (fine.style.getPropertyValue('--sr-progress') !== prog) fine.style.setProperty('--sr-progress', prog);

    const focused = root.ownerDocument.activeElement === root;
    // Quiet while playing, and when only the total changed after one was published (a late cue):
    // the focused reel keeps what it said until the viewer moves, so no changed total is announced.
    const lateTotal = syncedCount > 0 && (s.count !== syncedCount || s.totalKnown !== syncedKnown);
    const quiet = focused && s.navCount === lastNav && (!s.paused || lateTotal);
    lastNav = s.navCount;
    if (quiet) return;
    syncedCount = s.count;
    syncedKnown = s.totalKnown;
    setAttr(root, 'aria-disabled', String(!s.ready));
    setAttr(root, 'aria-valuemin', s.ready ? '1' : '0');
    // No maximum while the total could still change: a wrong one would be read out or shown by assistive technology.
    if (s.totalKnown) setAttr(root, 'aria-valuemax', String(s.count)); else root.removeAttribute('aria-valuemax');
    setAttr(root, 'aria-valuenow', s.ready ? String(s.index + 1) : '0');
    setAttr(root, 'aria-valuetext', s.ready ? sentenceStatus(s.sentence, s.count, s.totalKnown) : s.loading || s.resting ? (title.trim() || LABELS.pressPlay) : LABELS.noSentence);
  }

  return { root, hint: description, update };
}

/** A number from a CSS custom property that the layout sets (read from the element or the nearest ancestor that has it). */
function cssNumber(node: HTMLElement, name: string): number {
  const view = node.ownerDocument.defaultView;
  for (let n: HTMLElement | null = node; n && view; n = n.parentElement) {
    const raw = view.getComputedStyle(n).getPropertyValue(name).trim();
    if (raw) return Number.parseFloat(raw) || 0;
  }
  return 0;
}
