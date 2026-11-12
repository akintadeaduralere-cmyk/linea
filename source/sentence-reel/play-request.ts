import { PLAY_GIVE_UP_MS, PLAY_RETRY_MS } from './constants.ts';
import type { Clock } from './clock.ts';
import type { MediaEventType } from './media-events.ts';

export interface PlayRequestHooks {
  changed(): void;
  /** The request is still not playing after the retry: tell the viewer. */
  gaveUp(): void;
}

/**
 * Tracks whether the media is really playing. `buffering` is true from a play request until the media says
 * "playing", and whenever it stalls or waits while playing. A request that does not turn into playing is
 * retried once after PLAY_RETRY_MS and surfaced after PLAY_GIVE_UP_MS more, so it is never left hanging.
 */
export class PlayRequest {
  private readonly media: HTMLMediaElement;
  private readonly clock: Clock;
  private readonly hooks: PlayRequestHooks;
  private requested = false;
  private stalled = false;
  private timer: unknown = null;

  constructor(media: HTMLMediaElement, clock: Clock, hooks: PlayRequestHooks) {
    this.media = media;
    this.clock = clock;
    this.hooks = hooks;
  }

  get buffering(): boolean { return (this.requested || this.stalled) && !this.media.paused; }

  /** A play request was made. */
  request(): void {
    this.requested = true;
    this.arm(PLAY_RETRY_MS, () => {
      if (!this.requested) return;
      void Promise.resolve(this.media.play()).catch(() => {});
      this.arm(PLAY_GIVE_UP_MS, () => { this.clear(); this.hooks.gaveUp(); });
    });
  }

  /** The request itself was refused (play() rejected): nothing is pending any more. */
  cancel(): void { this.clear(); }

  onEvent(type: MediaEventType | 'waiting' | 'stalled'): void {
    if (type === 'playing') this.clear();
    else if (type === 'pause' || type === 'ended') this.clear();
    else if (type === 'waiting' || type === 'stalled') this.stalled = true;
  }

  destroy(): void { this.stop(); }

  private clear(): void {
    const was = this.requested || this.stalled;
    this.requested = false;
    this.stalled = false;
    this.stop();
    if (was) this.hooks.changed();
  }

  private arm(ms: number, fn: () => void): void {
    this.stop();
    this.timer = this.clock.setTimeout(() => { this.timer = null; fn(); this.hooks.changed(); }, ms);
  }

  private stop(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
