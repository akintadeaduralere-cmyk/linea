/**
 * Tells every listener the current state, in order. A listener may itself cause a change (a move, a message): that change must not be delivered while the pass is
 * running, or the listeners after it would be handed the OLDER state last (stale notches, stale value text). So a change during a pass only marks the state dirty,
 * and the pass starts again from the newest state until nothing changed: every listener always ends on the latest state. A listener that throws does not stop the others;
 * its error is reported on its own (never swallowed).
 */
export class Emitter<S> {
  private readonly listeners = new Set<(s: S) => void>();
  private readonly read: () => S;
  private readonly active: () => boolean;
  private emitting = false;
  private redo = false;

  constructor(read: () => S, active: () => boolean) { this.read = read; this.active = active; }

  add(fn: (s: S) => void): () => void {
    this.listeners.add(fn);
    fn(this.read());
    return () => this.listeners.delete(fn);
  }

  clear(): void { this.listeners.clear(); }

  emit(): void {
    if (!this.active()) return;
    if (this.emitting) { this.redo = true; return; }
    this.emitting = true;
    try {
      let guard = 0;
      do {
        this.redo = false;
        const s = this.read();
        for (const fn of [...this.listeners]) {
          try { fn(s); } catch (error) { setTimeout(() => { throw error; }, 0); }
        }
        guard += 1;
      } while (this.redo && guard < 20 && this.active());
    } finally {
      this.emitting = false;
    }
  }
}
