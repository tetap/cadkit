import type { Vec2 } from '@cadkit/types'

/** Local-space axis-aligned rect from polyline points, or null. */
export function localAxisAlignedRect(
  points: readonly Vec2[],
  closed: boolean,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!closed || points.length < 4) return null
  let n = points.length
  // Drop closing duplicate.
  if (n >= 5) {
    const a = points[0]!
    const b = points[n - 1]!
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) n -= 1
  }
  if (n !== 4) return null

  const xs = [points[0]!.x, points[1]!.x, points[2]!.x, points[3]!.x]
  const ys = [points[0]!.y, points[1]!.y, points[2]!.y, points[3]!.y]
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  if (!(maxX > minX) || !(maxY > minY)) return null

  // Each vertex must sit on a corner of the AABB (axis-aligned rectangle).
  for (let i = 0; i < 4; i++) {
    const x = xs[i]!
    const y = ys[i]!
    const onV = Math.abs(x - minX) < 1e-9 || Math.abs(x - maxX) < 1e-9
    const onH = Math.abs(y - minY) < 1e-9 || Math.abs(y - maxY) < 1e-9
    if (!onV || !onH) return null
  }
  return { minX, minY, maxX, maxY }
}

/**
 * World-space axis-aligned rect [x, y, w, h] after transforming local corners.
 * Returns null when the result is rotated / skewed.
 */
export function worldAxisAlignedRectInstance(
  points: readonly Vec2[],
  closed: boolean,
  wp: (x: number, y: number) => Vec2,
): Float64Array | null {
  const local = localAxisAlignedRect(points, closed)
  if (!local) return null
  const corners = [
    wp(local.minX, local.minY),
    wp(local.maxX, local.minY),
    wp(local.maxX, local.maxY),
    wp(local.minX, local.maxY),
  ]
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  for (const p of corners) {
    const onV = Math.abs(p.x - minX) < 1e-6 || Math.abs(p.x - maxX) < 1e-6
    const onH = Math.abs(p.y - minY) < 1e-6 || Math.abs(p.y - maxY) < 1e-6
    if (!onV || !onH) return null
  }
  const w = maxX - minX
  const h = maxY - minY
  if (!(w > 0) || !(h > 0)) return null
  return new Float64Array([minX, minY, w, h])
}
