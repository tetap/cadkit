import type { Vec2 } from '@cadkit/types'

export function distancePointToPoint(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

export function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const len2 = ux * ux + uy * uy
  if (len2 < 1e-24) return distancePointToPoint(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.y - a.y) * uy) / len2))
  return Math.hypot(p.x - (a.x + t * ux), p.y - (a.y + t * uy))
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const len2 = ux * ux + uy * uy
  if (len2 < 1e-24) return { x: a.x, y: a.y }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.y - a.y) * uy) / len2))
  return { x: a.x + t * ux, y: a.y + t * uy }
}

export function distancePointToCircle(p: Vec2, center: Vec2, radius: number): number {
  return Math.abs(distancePointToPoint(p, center) - radius)
}

export function nearlyEqual(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) <= tolerance
}
