/**
 * Organic dock blob — round glass hug around the plus circle, then soft
 * taper to the Home / Bank ends. Symmetric top / bottom.
 */

export type DockGeom = {
  /** Circle diameter of the center hug (around the plus face). */
  midH: number;
  /** Thickness near the rounded ends. */
  endH: number;
};

export function dockCanvasHeight(geom: DockGeom): number {
  return geom.midH;
}

/** Center Y of the hug circle — also the plus face center. */
export function dockCircleCenterY(geom: DockGeom): number {
  return geom.midH / 2;
}

/** Cubic approximating a circular arc (standard math angles, y-down screen). */
function circularCubic(
  cx: number,
  cy: number,
  R: number,
  a0: number,
  a1: number,
): string {
  const delta = a1 - a0;
  const k = (4 / 3) * Math.tan(delta / 4);
  const x0 = cx + R * Math.cos(a0);
  const y0 = cy + R * Math.sin(a0);
  const x3 = cx + R * Math.cos(a1);
  const y3 = cy + R * Math.sin(a1);
  const x1 = x0 - k * R * Math.sin(a0);
  const y1 = y0 + k * R * Math.cos(a0);
  const x2 = x3 + k * R * Math.sin(a1);
  const y2 = y3 - k * R * Math.cos(a1);
  return `C ${x1} ${y1} ${x2} ${y2} ${x3} ${y3}`;
}

export function dockSilhouettePath(width: number, geom: DockGeom): string {
  if (width <= 0) return '';

  const { midH, endH } = geom;
  const outerR = midH / 2;
  const endR = Math.min(endH / 2, outerR - 2);

  const cx = width / 2;
  const cy = dockCircleCenterY(geom);

  const topEnd = cy - endR;
  const botEnd = cy + endR;

  const dx = Math.sqrt(Math.max(outerR * outerR - endR * endR, 1));
  const leftJoin = cx - dx;
  const rightJoin = cx + dx;

  const left = 0;
  const right = width;
  const fillet = Math.min(dx * 0.14, (leftJoin - (left + endR)) * 0.35);

  const aTopLeft = Math.atan2(topEnd - cy, leftJoin - cx);
  const aTop = -Math.PI / 2;
  const aTopRight = Math.atan2(topEnd - cy, rightJoin - cx);
  const aBotRight = Math.atan2(botEnd - cy, rightJoin - cx);
  const aBot = Math.PI / 2;
  const aBotLeft = Math.atan2(botEnd - cy, leftJoin - cx);

  return [
    `M ${left + endR} ${topEnd}`,
    `C ${left + endR + fillet} ${topEnd}, ${leftJoin - fillet * 0.25} ${topEnd}, ${leftJoin} ${topEnd}`,
    circularCubic(cx, cy, outerR, aTopLeft, aTop),
    circularCubic(cx, cy, outerR, aTop, aTopRight),
    `C ${rightJoin + fillet * 0.25} ${topEnd}, ${right - endR - fillet} ${topEnd}, ${right - endR} ${topEnd}`,
    `A ${endR} ${endR} 0 0 1 ${right - endR} ${botEnd}`,
    `C ${right - endR - fillet} ${botEnd}, ${rightJoin + fillet * 0.25} ${botEnd}, ${rightJoin} ${botEnd}`,
    circularCubic(cx, cy, outerR, aBotRight, aBot),
    circularCubic(cx, cy, outerR, aBot, aBotLeft),
    `C ${leftJoin - fillet * 0.25} ${botEnd}, ${left + endR + fillet} ${botEnd}, ${left + endR} ${botEnd}`,
    `A ${endR} ${endR} 0 0 1 ${left + endR} ${topEnd}`,
    'Z',
  ].join(' ');
}
