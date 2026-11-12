/**
 * Turning the reel by hand. The pointer's angle from the reel's centre (clockwise from twelve o'clock, in degrees) is
 * mapped to a notch, so the same movement gives the same sentence for a mouse, a finger or a pen.
 *
 * The ring turns so the current notch is at nine o'clock: moving to the next notch turns it counter-clockwise by one pitch.
 * So a drag that turns the ring clockwise by one pitch goes back one notch.
 */

/** The angle of a point relative to the centre, clockwise from twelve o'clock, -180 to 180 degrees. */
export function conicAngle(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** The smallest signed turn from one angle to another, -180 (exclusive) to 180 degrees. */
export function shortestTurn(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/** The notch (0 to count - 1) drawn under a pointer at this angle, when the current notch is `now`. Notch k sits at -90 + (k - now) pitch. */
export function notchUnder(angle: number, count: number, now: number): number {
  if (count <= 0) return 0;
  const pitch = 360 / count;
  const k = Math.round((angle + 90) / pitch + now);
  return ((k % count) + count) % count;
}

/**
 * One drag: begin at an angle on a notch, then each move gives the notch the pointer has turned the reel to. The angle is
 * accumulated from move to move by the shortest turn, so a drag that crosses the top of the dial does not jump, and the
 * same sequence of angles always gives the same sequence of notches. Notches are clamped to the first and the last.
 */
export class DialDrag {
  private last: number;
  private turned = 0;
  private readonly start: number;
  private readonly pitch: number;
  private readonly count: number;

  constructor(angle: number, startNotch: number, count: number) {
    this.last = angle;
    this.start = startNotch;
    this.count = count;
    this.pitch = count > 0 ? 360 / count : 360;
  }

  /** How far the pointer has turned the dial since the press, in notch pitches (signed, clockwise positive). */
  get turnedPitches(): number {
    return this.turned / this.pitch;
  }

  move(angle: number): number {
    this.turned += shortestTurn(this.last, angle);
    this.last = angle;
    const k = this.start - Math.round(this.turned / this.pitch);
    return Math.min(this.count - 1, Math.max(0, k));
  }
}
