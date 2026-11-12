/** Tiny DOM helpers shared by the control builders. */

let counter = 0;
/** A page-unique id, so two players on one page (or one player mounted twice) never share ids. */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attrs: Record<string, string> = {},
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

/** A real <button>. A click does nothing while it is aria-disabled (it stays focusable). */
export function button(
  className: string,
  label: string,
  onClick: () => void,
  attrs: Record<string, string> = {},
  signal?: AbortSignal,
): HTMLButtonElement {
  const b = el('button', className, { type: 'button', 'data-label': label, ...attrs }, label);
  b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') onClick(); }, { signal });
  return b;
}

/**
 * A description that a control points at with aria-describedby. It is `hidden`, so it is not loose text
 * in the accessibility tree; a hidden node can still be a description.
 */
export function hint(text: string): HTMLElement {
  return el('span', '', { id: uid('sr-hint'), hidden: '' }, text);
}

export function setBool(node: Element, attr: string, on: boolean): void {
  setAttr(node, attr, String(on));
}

/** Present when `on`, absent otherwise, written only when that changes: a state update that changes nothing must not dirty the page's style or layout. */
export function toggleAttr(node: Element, name: string, on: boolean): void {
  if (node.hasAttribute(name) !== on) { if (on) node.setAttribute(name, ''); else node.removeAttribute(name); }
}

/** Set an attribute only when it changed, so a screen reader is not nudged for nothing. */
export function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** Reading direction of an element. */
export function isRtl(node: Element): boolean {
  const computed = node.ownerDocument.defaultView?.getComputedStyle(node).direction;
  if (computed) return computed === 'rtl';
  return node.closest('[dir]')?.getAttribute('dir') === 'rtl';
}

/** A lamp that has just changed shows ember for 400 ms, then settles to white (set) or hollow (off): the style does the colour work from data-flash. */
export function flashLamp(node: HTMLElement): void {
  node.setAttribute('data-flash', '');
  const win = node.ownerDocument.defaultView;
  const timers = (node as unknown as { __flash?: number });
  if (timers.__flash !== undefined) win?.clearTimeout(timers.__flash);
  timers.__flash = win?.setTimeout(() => node.removeAttribute('data-flash'), 400);
}

