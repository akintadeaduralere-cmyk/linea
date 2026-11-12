import { el } from './dom.ts';
import { LABELS } from './labels.ts';

/** The fixed pictures under and over the live parts, in the order they are drawn. Each is decoration. */
const LAYERS = ['shadow', 'body', 'platter', 'light', 'arm', 'hub', 'hubgrain', 'glass', 'corners'] as const;

export interface Art {
  /** Holds the layers; placed absolutely over the whole player box. */
  root: HTMLElement;
  /** Gives the player its height from the layout's aspect ratio. */
  spacer: HTMLElement;
  remove(): void;
}

/**
 * The skin's pictures, as empty elements. All of them are `aria-hidden` and ignore the pointer.
 * Their images, sizes and positions come from the stylesheet, which is generated from the artist's anchors.
 */
export function buildArt(): Art {
  const root = el('div', 'sr-art', { 'aria-hidden': 'true' });
  for (const name of LAYERS) root.append(el('span', `sr-a-${name}`));
  // The reel's index label: the current sentence is the notch under it.
  root.append(el('span', 'sr-a-now', {}, LABELS.now));
  const spacer = el('div', 'sr-spacer', { 'aria-hidden': 'true' });
  return { root, spacer, remove: () => { root.remove(); spacer.remove(); } };
}
