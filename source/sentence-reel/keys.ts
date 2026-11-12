export type KeyAction =
  | 'toggle-play' | 'again' | 'next' | 'previous' | 'seek-back' | 'seek-forward'
  | 'captions' | 'wait' | 'mute' | 'volume-up' | 'volume-down' | 'fullscreen'
  | 'skip-back' | 'skip-forward' | 'speed-down' | 'speed-up' | 'start' | 'end' | JumpAction;
/** 0 to 9: jump to 0 to 90 percent of the film. */
export type JumpAction = `jump-${number}`;

export interface KeyTarget {
  tag: string;
  type?: string;
  role?: string;
  /** True when the target was reached by keyboard (:focus-visible); false after a mouse click left focus on it. */
  keyboardFocus?: boolean;
}

export interface KeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  /** Reading direction of the player. */
  rtl?: boolean;
  /** What has focus: the element's tag, its type (for inputs) and role. */
  target: KeyTarget;
}

const LETTER_ACTIONS: Record<string, KeyAction> = {
  a: 'again', n: 'next', c: 'captions', w: 'wait', m: 'mute', f: 'fullscreen',
  k: 'toggle-play', j: 'skip-back', l: 'skip-forward',
};
/** Keys that may repeat while held. Everything else fires once per press. */
const REPEATABLE = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'n', 'N']);

const isSlider = (t: KeyTarget): boolean => t.role === 'slider' || (t.tag === 'input' && t.type === 'range');
const isRadio = (t: KeyTarget): boolean => t.role === 'radio';
const isPressable = (t: KeyTarget): boolean =>
  t.tag === 'button' || t.tag === 'a' || t.tag === 'summary' || t.role === 'button' || t.role === 'switch' || t.role === 'radio';
const isTextField = (t: KeyTarget): boolean =>
  (t.tag === 'input' && !isSlider(t) && t.type !== 'checkbox' && t.type !== 'radio') || t.tag === 'textarea' || t.tag === 'select';

/**
 * Map a key press to a player action, or null to leave it alone (WCAG 2.1.4: only inside the player,
 * never with Ctrl, Alt or Meta). Native behaviour wins where the focused control already handles the key:
 * Space on a button presses that button; arrows on a slider move that slider.
 */
export function keyAction(input: KeyInput): KeyAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey || input.isComposing) return null;
  const { key, target } = input;
  if (isTextField(target)) return null;
  if (input.repeat && !REPEATABLE.has(key)) return null;
  // Space presses a key only when the viewer reached it by keyboard. After a mouse click (on Full screen, say) focus stays on that
  // button, and Space must still play or pause, as on YouTube, never press the clicked key again (12 Nov 2026: it left full screen).
  if (key === ' ') return isPressable(target) && target.keyboardFocus !== false ? null : 'toggle-play';
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (isSlider(target) || isRadio(target)) return null;
    const forward = (key === 'ArrowRight') !== Boolean(input.rtl);
    if (input.shiftKey) return forward ? 'seek-forward' : 'seek-back';
    return forward ? 'next' : 'previous';
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (isSlider(target) || isRadio(target) || input.shiftKey) return null;
    return key === 'ArrowUp' ? 'volume-up' : 'volume-down';
  }
  // Speed: the < and > keys (Shift+, and Shift+. on a US layout).
  if (key === '<' || (key === ',' && input.shiftKey)) return 'speed-down';
  if (key === '>' || (key === '.' && input.shiftKey)) return 'speed-up';
  if ((key === 'Home' || key === 'End') && !isSlider(target) && !isRadio(target)) return key === 'Home' ? 'start' : 'end';
  if (/^[0-9]$/.test(key) && !input.shiftKey && !isSlider(target)) return `jump-${Number(key)}` as JumpAction;
  return LETTER_ACTIONS[key.toLowerCase()] ?? null;
}
