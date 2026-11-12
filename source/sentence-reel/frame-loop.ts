import type { Clock } from './clock.ts';

/**
 * Calls `step` every animation frame until stopped, or until `step` returns false. Used to redraw while
 * playing. Nothing depends on it for correctness: in a hidden tab frames do not run.
 */
export class FrameLoop {
  private readonly clock: Clock;
  private readonly step: () => boolean;
  private handle: unknown = null;

  constructor(clock: Clock, step: () => boolean) {
    this.clock = clock;
    this.step = step;
  }

  start(): void {
    this.stop();
    const tick = (): void => {
      this.handle = null;
      if (this.step()) this.handle = this.clock.requestFrame(tick);
    };
    this.handle = this.clock.requestFrame(tick);
  }

  stop(): void {
    if (this.handle !== null) this.clock.cancelFrame(this.handle);
    this.handle = null;
  }
}
