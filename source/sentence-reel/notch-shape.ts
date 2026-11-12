const SVG = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;

export interface NotchGeometry {
  /** Radii of the band, millimetres from the disc centre. */
  inner: number;
  outer: number;
  /** Half the angle a notch spans, degrees. */
  halfDeg: number;
  /** Corner radius, millimetres. */
  corner: number;
  /** Half the width of the drawing, millimetres (the disc radius). */
  extent: number;
}

/** A point on a circle, angle in degrees clockwise from twelve o'clock, y down. */
const at = (radius: number, deg: number): string => `${(radius * Math.sin(deg * DEG)).toFixed(2)} ${(-radius * Math.cos(deg * DEG)).toFixed(2)}`;

/**
 * The outline of one notch as an annular sector inset by the corner radius; stroked with a round join of twice that
 * width and the same colour, it becomes the sector with rounded corners. The angle is where the notch sits on the ring.
 */
export function notchPath(centreDeg: number, g: NotchGeometry): string {
  const r1 = g.inner + g.corner;
  const r2 = g.outer - g.corner;
  const inset = (g.corner / ((g.inner + g.outer) / 2)) / DEG;
  const a0 = centreDeg - g.halfDeg + inset;
  const a1 = centreDeg + g.halfDeg - inset;
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${at(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${at(r1, a1)} L ${at(r2, a1)} A ${r2} ${r2} 0 ${large} 0 ${at(r2, a0)} Z`;
}

/** The thin ember edge on the outer rim of a dark notch. */
export function notchRim(centreDeg: number, g: NotchGeometry): string {
  const r = g.outer - 0.35;
  const inset = (g.corner / g.outer) / DEG;
  const a0 = centreDeg - g.halfDeg + inset;
  const a1 = centreDeg + g.halfDeg - inset;
  return `M ${at(r, a0)} A ${r} ${r} 0 0 1 ${at(r, a1)}`;
}

/** One notch's drawing: a body, a soft bevel over it and the rim light. Decoration: hidden from assistive technology. */
export function notchShape(centreDeg: number, g: NotchGeometry, gradientId: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'sr-notch-shape');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('viewBox', `${-g.extent} ${-g.extent} ${g.extent * 2} ${g.extent * 2}`);
  const d = notchPath(centreDeg, g);
  const body = document.createElementNS(SVG, 'path');
  body.setAttribute('class', 'sr-notch-body');
  body.setAttribute('d', d);
  const bevel = document.createElementNS(SVG, 'path');
  bevel.setAttribute('class', 'sr-notch-bevel');
  bevel.setAttribute('d', d);
  bevel.setAttribute('fill', `url(#${gradientId})`);
  bevel.setAttribute('stroke', `url(#${gradientId})`);
  const rim = document.createElementNS(SVG, 'path');
  rim.setAttribute('class', 'sr-notch-rim');
  rim.setAttribute('d', notchRim(centreDeg, g));
  svg.append(body, bevel, rim);
  return svg;
}

/** The soft top bevel: light at the upper left fading to a darker lower right, fixed in the drawing's own space. */
export function bevelGradient(id: string, extent: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'sr-notch-defs');
  const defs = document.createElementNS(SVG, 'defs');
  const grad = document.createElementNS(SVG, 'linearGradient');
  grad.setAttribute('id', id);
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');
  grad.setAttribute('x1', String(-extent * 0.6));
  grad.setAttribute('y1', String(-extent * 0.8));
  grad.setAttribute('x2', String(extent * 0.6));
  grad.setAttribute('y2', String(extent * 0.8));
  for (const [offset, colour, opacity] of [['0', '#ffffff', '0.44'], ['0.5', '#ffffff', '0.05'], ['1', '#000000', '0.36']] as const) {
    const stop = document.createElementNS(SVG, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', colour);
    stop.setAttribute('stop-opacity', opacity);
    grad.append(stop);
  }
  defs.append(grad);
  svg.append(defs);
  return svg;
}
