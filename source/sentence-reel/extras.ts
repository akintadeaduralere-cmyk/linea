import type { Clock } from './clock.ts';
import type { ReelController } from './controller.ts';
import { canvasReader, InkSampler, type FrameReader } from './ink-sampler.ts';
import { buildDrawer, type Drawer } from './drawer.ts';
import { buildEtched, type EtchedLayer } from './etched.ts';
import { Outputs } from './outputs.ts';
import { buildStandby } from './standby.ts';
import { VOLUME_LEVELS } from './constants.ts';
import type { ReelState } from './types.ts';

export interface ExtrasContext {
  host: HTMLElement;
  media: HTMLMediaElement;
  stage: HTMLElement;
  controller: ReelController;
  doc: Document;
  clock: Clock;
  signal: AbortSignal;
  /** Test seam: where the picture is read from. */
  frameReader?: FrameReader;
  /** The video's own title, etched on the glass while the film waits. */
  title?: string;
  /** The ember parts with their shade and spec layers (ember-layers.css). */
  emberLayers?: boolean;
  /** Add the settings drawer. */
  drawer?: boolean;
  loadArt?: () => Promise<void>;
}

export interface Extras {
  /** The etched glass layer registers its marks here; each gets data-ink. */
  etched: InkSampler;
  /** The settings drawer, when it was asked for. */
  drawer: Drawer | null;
  /** Figures etched low on the picture for a moment. */
  feedback: EtchedLayer['feedback'];
  /** Called with every state the controller emits. */
  onState(state: ReelState): void;
  destroy(): void;
}

/**
 * The parts of the digital system that sit around the controls and do not depend on the final look: the ink sampler for the etched glass
 * layer, then (added by their own modules) the settings drawer, the outputs and the states. The look swaps in later through the
 * `data-*` attributes these write; nothing here draws a visible part.
 */
export function mountExtras(ctx: ExtrasContext): Extras {
  const { host, media, stage, doc, clock, signal } = ctx;
  const etched = new InkSampler({ clock, host, reader: ctx.frameReader ?? canvasReader(media, doc) });
  // Once on seek, pause, play and resize (a seek or resize shows a different picture, so the first look settles at once); four a second while playing (onState).
  const settle = (): void => etched.sampleNow(true);
  let rate = media.playbackRate;
  media.addEventListener('ratechange', () => { if (media.playbackRate !== rate) { rate = media.playbackRate; glass.feedback('speed', `${Number(rate.toFixed(2))} \u00d7`); } }, { signal });
  for (const type of ['seeked', 'pause', 'playing', 'loadeddata']) media.addEventListener(type, settle, { signal });
  const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(settle) : null;
  watcher?.observe(stage);
  const outputs = new Outputs(media, doc, signal, () => { if (lastState) glass.update(lastState, outputs); });
  const glass = buildEtched(stage, ctx.title ?? '', etched, clock, () => ctx.controller.sentenceList());
  // The first look happens now, not at the first picture: if the canvas cannot be read at all (no 2d context, or getImageData throws) every etched mark is hidden before it is ever drawn.
  etched.sampleNow(true);
  const standby = buildStandby(stage);
  let lastState: ReelState | null = null;
  if (ctx.emberLayers) host.setAttribute('data-ember-layers', '');
  const drawer = ctx.drawer ? buildDrawer({ media, controller: ctx.controller, host, doc, signal, loadArt: ctx.loadArt }) : null;
  if (drawer) { host.append(drawer.pull, drawer.panel); (host.querySelector('.sr-stage') ?? host).append(drawer.outs); }
  return {
    etched,
    drawer,
    feedback: (kind, text, extra) => glass.feedback(kind, text, extra),
    onState(state) {
      if (lastState && state.level !== lastState.level) glass.feedback('volume', `${Math.round((state.level / VOLUME_LEVELS) * 100)} %`, { lamps: { on: state.level, of: VOLUME_LEVELS } });
      lastState = state;
      glass.update(state, outputs);
      host.toggleAttribute('data-remote', outputs.airplay.active || outputs.pip.active);
      // One word for the whole player's situation: before, buffering, playing, paused, ended or error. The look styles on it.
      if (host.getAttribute('data-phase') !== state.phase) host.setAttribute('data-phase', state.phase);
      if (!state.paused) etched.onFrame();
    },
    destroy() { standby.remove(); watcher?.disconnect(); etched.destroy(); host.removeAttribute('data-phase'); glass.destroy(); drawer?.outs.remove(); drawer?.pull.remove(); drawer?.panel.remove(); host.removeAttribute('data-drawer'); host.removeAttribute('data-ember-layers'); },
  };
}
