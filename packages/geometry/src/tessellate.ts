import type { Vec2 } from '@cadkit/types'

/**
 * Screen-space adaptive curve tessellation.
 * `pixelError` is the max deviation in screen pixels; `worldPerPixel = 1/zoom`.
 */
export function tessellateArc(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
  pixelError: number,
  worldPerPixel: number,
): Vec2[] {
  const absErr = Math.max(1e-9, pixelError * worldPerPixel)
  const sweep = normalizeSweep(startAngle, endAngle)
  // chord error ≈ r (1 - cos(θ/2)) → θ ≈ 2 acos(1 - err/r)
  const ratio = Math.min(1, Math.max(0, 1 - absErr / Math.max(radius, 1e-9)))
  const step = Math.max(0.02, 2 * Math.acos(ratio))
  const count = Math.max(2, Math.ceil(Math.abs(sweep) / step))
  const points: Vec2[] = []
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const a = startAngle + sweep * t
    points.push({
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a),
    })
  }
  return points
}

export function tessellateCubicBezier(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  pixelError: number,
  worldPerPixel: number,
): Vec2[] {
  const tol = Math.max(1e-9, pixelError * worldPerPixel)
  const out: Vec2[] = [p0]
  // subdivideCubic always appends the segment end (p3); do not push it again.
  subdivideCubic(p0, p1, p2, p3, tol, out, 0)
  return out
}

/**
 * Tessellate a chained cubic Bezier polyline packed as
 * [p0, c1, c2, p1, c1', c2', p2, ...] (length = 3k+1).
 */
export function tessellateCubicChain(
  points: readonly Vec2[],
  pixelError: number,
  worldPerPixel: number,
  closed = false,
): Vec2[] {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }))
  if (points.length < 4) {
    const out = points.map((p) => ({ x: p.x, y: p.y }))
    if (closed && out.length >= 2) out.push({ x: out[0]!.x, y: out[0]!.y })
    return out
  }
  const out: Vec2[] = []
  for (let i = 0; i + 3 < points.length; i += 3) {
    const seg = tessellateCubicBezier(
      points[i]!,
      points[i + 1]!,
      points[i + 2]!,
      points[i + 3]!,
      pixelError,
      worldPerPixel,
    )
    if (out.length) out.pop()
    out.push(...seg)
  }
  if (closed && out.length >= 2) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-9) {
      out.push({ x: first.x, y: first.y })
    }
  }
  return out
}

function subdivideCubic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  tol: number,
  out: Vec2[],
  depth: number,
): void {
  if (depth > 16) {
    out.push(p3)
    return
  }
  const d = flatness(p0, p1, p2, p3)
  if (d <= tol * tol) {
    out.push(p3)
    return
  }
  const m01 = mid(p0, p1)
  const m12 = mid(p1, p2)
  const m23 = mid(p2, p3)
  const m012 = mid(m01, m12)
  const m123 = mid(m12, m23)
  const m0123 = mid(m012, m123)
  // Left half ends by appending m0123; right half continues from there and
  // only appends further samples / p3 (no pop — that used to drop every join
  // and collapse curved pens to straight chords).
  subdivideCubic(p0, m01, m012, m0123, tol, out, depth + 1)
  subdivideCubic(m0123, m123, m23, p3, tol, out, depth + 1)
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function flatness(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): number {
  // max distance of control points from chord p0-p3, squared
  const ux = p3.x - p0.x
  const uy = p3.y - p0.y
  const len2 = ux * ux + uy * uy || 1
  const d1 = distToSegment2(p1, p0, ux, uy, len2)
  const d2 = distToSegment2(p2, p0, ux, uy, len2)
  return Math.max(d1, d2)
}

function distToSegment2(p: Vec2, a: Vec2, ux: number, uy: number, len2: number): number {
  const vx = p.x - a.x
  const vy = p.y - a.y
  const t = Math.max(0, Math.min(1, (vx * ux + vy * uy) / len2))
  const dx = vx - t * ux
  const dy = vy - t * uy
  return dx * dx + dy * dy
}

function normalizeSweep(start: number, end: number): number {
  let sweep = end - start
  while (sweep <= -Math.PI * 2) sweep += Math.PI * 2
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2
  if (Math.abs(sweep) < 1e-12) sweep = Math.PI * 2
  return sweep
}

/** Quantize zoom into LOD bins with hysteresis to avoid thrashing. */
export function lodBin(zoom: number, previousBin: number | null = null): number {
  const bin = Math.round(Math.log2(Math.max(zoom, 1e-9)) * 2)
  if (previousBin == null) return bin
  if (Math.abs(bin - previousBin) <= 1) return previousBin
  return bin
}
