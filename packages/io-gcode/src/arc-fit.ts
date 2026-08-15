import type { Vec2 } from '@cadkit/types'

/** Fitted cut segment in the same space as the source polyline. */
export type FittedSeg =
  | { kind: 'line'; to: Vec2 }
  | { kind: 'arc'; to: Vec2; center: Vec2; via: Vec2 }

const MIN_PTS = 4
/** Reject sharp polygon corners (hexagon = 60°) so chords stay G1. */
const MAX_TURN = (40 * Math.PI) / 180
/** Ignore near-collinear noise. */
const MIN_TURN = (0.35 * Math.PI) / 180
const MAX_RADIUS = 1e5

/**
 * Collapse smooth circular runs in a polyline to G2/G3-ready arcs.
 * Straight edges and sharp corners stay as lines.
 */
export function fitPolylineArcs(points: readonly Vec2[], tolerance = 0.05): FittedSeg[] {
  if (points.length < 2) return []
  const pts = points
  const tol = Math.max(1e-6, tolerance)
  const out: FittedSeg[] = []
  let i = 0
  while (i < pts.length - 1) {
    const end = longestArcEnd(pts, i, tol)
    if (end != null) {
      const a = pts[i]!
      const b = pts[end]!
      const via = pts[i + ((end - i) >> 1)]!
      const circ = circumcircle(a, via, b) ?? circumcircle(a, pts[i + 1]!, pts[i + 2]!)
      if (circ) {
        out.push({ kind: 'arc', to: b, center: circ.c, via })
        i = end
        continue
      }
    }
    out.push({ kind: 'line', to: pts[i + 1]! })
    i += 1
  }
  return out
}

function longestArcEnd(pts: readonly Vec2[], start: number, tol: number): number | null {
  if (start + MIN_PTS - 1 >= pts.length) return null
  if (!tripleLooksCircular(pts[start]!, pts[start + 1]!, pts[start + 2]!)) return null

  let circ: { c: Vec2; r: number } | null = null
  let last = -1
  for (let j = start + MIN_PTS - 1; j < pts.length; j++) {
    if (!rangeTurnsSmooth(pts, start, j)) break
    if (!circ) {
      const mid = start + ((j - start) >> 1)
      const next = circumcircle(pts[start]!, pts[mid]!, pts[j]!)
      if (!next || !seedOk(next) || !rangeOnCircle(pts, start, j, next, tol)) {
        continue
      }
      circ = next
      last = j
      continue
    }
    const p = pts[j]!
    if (Math.abs(Math.hypot(p.x - circ.c.x, p.y - circ.c.y) - circ.r) > tol) break
    last = j
  }
  return last >= start + MIN_PTS - 1 ? last : null
}

function seedOk(seed: { c: Vec2; r: number }): boolean {
  return seed.r > 1e-6 && seed.r <= MAX_RADIUS && Number.isFinite(seed.r)
}

function rangeOnCircle(
  pts: readonly Vec2[],
  start: number,
  end: number,
  seed: { c: Vec2; r: number },
  tol: number,
): boolean {
  for (let k = start; k <= end; k++) {
    const p = pts[k]!
    if (Math.abs(Math.hypot(p.x - seed.c.x, p.y - seed.c.y) - seed.r) > tol) return false
  }
  return true
}

function rangeTurnsSmooth(pts: readonly Vec2[], start: number, end: number): boolean {
  let sign = 0
  let ref = 0
  for (let k = start; k <= end - 2; k++) {
    const t = turnAngle(pts[k]!, pts[k + 1]!, pts[k + 2]!)
    const mag = Math.abs(t)
    if (mag < MIN_TURN || mag > MAX_TURN) return false
    const s = t < 0 ? -1 : 1
    if (sign === 0) {
      sign = s
      ref = mag
    } else if (s !== sign) {
      return false
    } else if (Math.abs(mag - ref) > Math.max(0.12, ref * 0.55)) {
      return false
    }
  }
  return sign !== 0
}

function tripleLooksCircular(a: Vec2, b: Vec2, c: Vec2): boolean {
  const t = Math.abs(turnAngle(a, b, c))
  return t >= MIN_TURN && t <= MAX_TURN
}

function turnAngle(a: Vec2, b: Vec2, c: Vec2): number {
  const x1 = b.x - a.x
  const y1 = b.y - a.y
  const x2 = c.x - b.x
  const y2 = c.y - b.y
  return Math.atan2(x1 * y2 - y1 * x2, x1 * x2 + y1 * y2)
}

function circumcircle(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-12) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  const r = Math.hypot(a.x - ux, a.y - uy)
  if (!(r > 1e-9) || !Number.isFinite(r)) return null
  return { c: { x: ux, y: uy }, r }
}
