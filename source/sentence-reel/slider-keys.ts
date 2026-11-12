export type SliderIntent =
  | { type: 'step'; delta: 1 | -1; shift: boolean }
  | { type: 'page'; delta: 1 | -1 }
  | { type: 'home' }
  | { type: 'end' };

export interface SliderKeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  rtl?: boolean;
}

/**
 * What a key means to a slider. Ctrl, Alt and Meta are never ours (VoiceOver uses Ctrl+Option+arrows).
 * Right and Up increase, Left and Down decrease; in right-to-left Left and Right swap, Up and Down do not.
 */
export function sliderIntent(input: SliderKeyInput): SliderIntent | null {
  if (input.ctrlKey || input.altKey || input.metaKey) return null;
  const shift = Boolean(input.shiftKey);
  const flip = input.rtl ? -1 : 1;
  switch (input.key) {
    case 'ArrowRight': return { type: 'step', delta: (1 * flip) as 1 | -1, shift };
    case 'ArrowLeft': return { type: 'step', delta: (-1 * flip) as 1 | -1, shift };
    case 'ArrowUp': return { type: 'step', delta: 1, shift };
    case 'ArrowDown': return { type: 'step', delta: -1, shift };
    case 'PageUp': return { type: 'page', delta: 1 };
    case 'PageDown': return { type: 'page', delta: -1 };
    case 'Home': return { type: 'home' };
    case 'End': return { type: 'end' };
    default: return null;
  }
}
