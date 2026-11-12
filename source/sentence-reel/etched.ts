import type { Clock } from './clock.ts';
import { FEEDBACK_MS } from './constants.ts';
import { el } from './dom.ts';
import { formatTime } from './format.ts';
import type { InkSampler } from './ink-sampler.ts';
import type { Outputs } from './outputs.ts';
import type { ReelState, Sentence } from './types.ts';

/**
 * The etched glass layer (board F section 3): marks that are ink straight on the picture, no plates. The title top left while the film waits
 * (before play, paused, ended), and a status beside it ("THE END", "PLAYING ON AIRPLAY", "PICTURE IN PICTURE"). Each mark takes white or graphite
 * ink from the sampler, or hides where neither reaches 4.5:1. The marks repeat the deck, so the layer is aria-hidden; the title stays in the player's
 * accessible name and the status announcer speaks state changes.
 */
export const ETCHED = { theEnd: 'The end', airplay: 'Playing on AirPlay', pip: 'Picture in picture' } as const;

export type FeedbackKind = 'skip' | 'speed' | 'volume';

export interface EtchedLayer {
  root: HTMLElement;
  /** A figure etched low on the picture for a moment: a skip ("\u221210 SEC" with where it landed), a speed ("1.25 \u00d7"), or the level (five lamps and a percent). */
  feedback(kind: FeedbackKind, text: string, extra?: { small?: string; lamps?: { on: number; of: number } }): void;
  update(state: ReelState, outputs: Outputs): void;
  destroy(): void;
}

export function buildEtched(stage: HTMLElement, title: string, sampler: InkSampler, clock: Clock, sentences: () => readonly Sentence[] = () => []): EtchedLayer {
  const root = el('div', 'sr-etched', { 'aria-hidden': 'true' });
  const line = el('div', 'sr-etch-line');
  const name = el('span', 'sr-etch sr-etch-title', {}, title);
  const status = el('span', 'sr-etch sr-etch-status');
  const fb = el('span', 'sr-etch sr-etch-fb');
  line.append(name, status);
  // Full screen, console hidden: corner marks, the time remaining and the sentence scale (one tick per sentence; shape carries the state).
  const corners = ['tl', 'tr', 'bl', 'br'].map((c) => el('span', 'sr-etch sr-etch-corner', { 'data-c': c }));
  const remaining = el('span', 'sr-etch sr-etch-rem');
  const scale = el('span', 'sr-etch sr-etch-scale');
  root.append(line, fb, ...corners, remaining, scale);
  let ticks: HTMLElement[] = []; let tickSig = ''; let lastIndex = -1;
  stage.append(root);
  // A mark's box on the picture as fractions of the stage, read at sample time.
  const boxOf = (node: HTMLElement) => (): { x0: number; y0: number; x1: number; y1: number } | null => {
    const s = stage.getBoundingClientRect(); const r = node.getBoundingClientRect();
    if (!(s.width > 0) || !(r.width > 0)) return null;
    return { x0: (r.left - s.left) / s.width, y0: (r.top - s.top) / s.height, x1: (r.right - s.left) / s.width, y1: (r.bottom - s.top) / s.height };
  };
  const stops = [sampler.register({ el: name, box: boxOf(name) }), sampler.register({ el: status, box: boxOf(status) }), sampler.register({ el: fb, box: boxOf(fb) }), sampler.register({ el: remaining, box: boxOf(remaining) }), sampler.register({ el: scale, box: boxOf(scale) }), ...corners.map((c) => sampler.register({ el: c, box: boxOf(c) }))];
  let fbTimer: unknown = null;
  return {
    root,
    feedback(kind, text, extra) {
      fb.replaceChildren();
      if (extra?.lamps) {
        const lamps = el('span', 'sr-etch-lamps');
        for (let i = 0; i < extra.lamps.of; i += 1) lamps.append(el('i', 'sr-etch-lamp', i < extra.lamps.on ? { 'data-on': '' } : {}));
        fb.append(lamps);
      }
      fb.append(document.createTextNode(text));
      if (extra?.small) fb.append(' ', el('small', '', {}, extra.small));
      fb.setAttribute('data-kind', kind);
      fb.setAttribute('data-show', '');
      // Keep the figure inside the frame: at narrow widths the text would run past the right edge, so it moves left by the overshoot.
      fb.style.marginLeft = '';
      const frame = root.getBoundingClientRect(); const box = fb.getBoundingClientRect();
      if (frame.width > 0 && box.width > 0) { const over = box.right - (frame.right - 12); if (over > 0) fb.style.marginLeft = `-${Math.ceil(over)}px`; }
      if (fbTimer !== null) clock.clearTimeout(fbTimer);
      fbTimer = clock.setTimeout(() => { fbTimer = null; fb.removeAttribute('data-show'); }, FEEDBACK_MS);
    },
    update(state, outputs) {
      const list = sentences();
      const sig = `${list.length}:${list[0]?.start}:${list[list.length - 1]?.end}:${state.duration}`;
      if (sig !== tickSig) {
        tickSig = sig; lastIndex = -1;
        ticks = list.map((sent, i) => { const t = el('i', 'sr-tick'); t.style.setProperty('--at', state.duration > 0 ? String(Math.min(100, (sent.start / state.duration) * 100).toFixed(3)) : String((i / Math.max(1, list.length - 1)) * 100)); if (i % 4 === 0) t.append(el('b', '', {}, String(i + 1).padStart(2, '0'))); return t; });
        scale.replaceChildren(...ticks);
      }
      if (state.index !== lastIndex && ticks.length > 0) {
        lastIndex = state.index;
        ticks.forEach((t, i) => { t.toggleAttribute('data-played', i < state.index); t.toggleAttribute('data-current', i === state.index); });
      }
      const rem = state.duration > 0 ? `\u2212${formatTime(Math.max(0, state.duration - state.time))}` : '';
      if (remaining.textContent !== rem) remaining.textContent = rem;
      const airplay = outputs.airplay.active; const pip = outputs.pip.active;
      const text = airplay ? ETCHED.airplay : pip ? ETCHED.pip : state.phase === 'ended' ? ETCHED.theEnd : '';
      if (status.textContent !== text) status.textContent = text;
      // The title waits with the film; it is replaced by the status for AirPlay and picture in picture.
      root.setAttribute('data-show', airplay || pip ? 'status' : state.phase === 'before' || state.phase === 'paused' || state.phase === 'ended' ? 'title' : 'none');
      root.toggleAttribute('data-ended', state.phase === 'ended');
      root.toggleAttribute('data-remote', airplay || pip);
    },
    destroy() { if (fbTimer !== null) clock.clearTimeout(fbTimer); for (const s of stops) s(); root.remove(); },
  };
}
