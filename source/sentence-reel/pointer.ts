/**
 * Drag or click along a slider: calls onFraction with the pointer's 0 to 1 position along the node
 * (left to right; the caller mirrors it for right-to-left). Does nothing for a node with no width.
 */
export function bindScrub(node: HTMLElement, signal: AbortSignal, onFraction: (fraction: number) => void): void {
  let active = false;
  /** Read once on the press, not on every move: a drag does not make the page lay out again for each pointer event. */
  let rect: DOMRect | null = null;
  const fraction = (e: PointerEvent): number | null => {
    const r = rect ?? node.getBoundingClientRect();
    return r.width > 0 ? (e.clientX - r.left) / r.width : null;
  };
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    rect = node.getBoundingClientRect();
    const f = fraction(e);
    if (f === null) return;
    active = true;
    try { node.setPointerCapture(e.pointerId); } catch { /* capture is a nicety: dragging still works inside the node */ }
    node.focus({ preventScroll: true });
    onFraction(f);
    e.preventDefault();
  }, { signal });
  node.addEventListener('pointermove', (e) => {
    if (!active) return;
    const f = fraction(e);
    if (f !== null) onFraction(f);
  }, { signal });
  const stop = (): void => { active = false; rect = null; };
  node.addEventListener('pointerup', stop, { signal });
  node.addEventListener('pointercancel', stop, { signal });
}
