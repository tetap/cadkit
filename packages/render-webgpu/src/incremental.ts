import type { ScreenRect } from '@cadkit/render-core'

/** Device-pixel scissor from CSS rect; returns null if empty after clamp. */
export function cssRectToScissor(
  r: ScreenRect,
  dpr: number,
  bufW: number,
  bufH: number,
): { x: number; y: number; w: number; h: number } | null {
  const x = Math.floor(r.x * dpr)
  const y = Math.floor(r.y * dpr)
  const w = Math.ceil(r.w * dpr)
  const h = Math.ceil(r.h * dpr)
  const x0 = Math.max(0, Math.min(bufW, x))
  const y0 = Math.max(0, Math.min(bufH, y))
  const x1 = Math.max(0, Math.min(bufW, x + w))
  const y1 = Math.max(0, Math.min(bufH, y + h))
  const sw = x1 - x0
  const sh = y1 - y0
  if (sw <= 0 || sh <= 0) return null
  return { x: x0, y: y0, w: sw, h: sh }
}

/** Uncovered CSS strips after shifting content by (dx, dy). */
export function panStripRects(cssW: number, cssH: number, dx: number, dy: number): ScreenRect[] {
  const rects: ScreenRect[] = []
  if (dx > 0) rects.push({ x: 0, y: 0, w: dx, h: cssH })
  else if (dx < 0) rects.push({ x: cssW + dx, y: 0, w: -dx, h: cssH })
  if (dy > 0) rects.push({ x: 0, y: 0, w: cssW, h: dy })
  else if (dy < 0) rects.push({ x: 0, y: cssH + dy, w: cssW, h: -dy })
  return rects
}
