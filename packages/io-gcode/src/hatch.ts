import type { Vec2 } from '@cadkit/types'

export interface HatchSegment {
  a: Vec2
  b: Vec2
}

/** Axis-aligned hatch (angle 0 = horizontal). Alternating direction per row. */
export function hatchPolygon(
  ring: readonly Vec2[],
  spacing: number,
  angleRad = 0,
): HatchSegment[] {
  if (ring.length < 3 || !(spacing > 0)) return []
  const cos = Math.cos(-angleRad)
  const sin = Math.sin(-angleRad)
  const rot = (p: Vec2): Vec2 => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos })
  const unrot = (p: Vec2): Vec2 => ({
    x: p.x * cos + p.y * sin,
    y: -p.x * sin + p.y * cos,
  })

  const local = ring.map(rot)
  let minY = Infinity
  let maxY = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  for (const p of local) {
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
  }
  if (!(maxY > minY) || !(maxX > minX)) return []

  const segs: HatchSegment[] = []
  let row = 0
  const y0 = minY + spacing * 0.5
  for (let y = y0; y <= maxY - spacing * 0.25; y += spacing, row++) {
    const xs = intersectHorizontal(local, y)
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = xs[i]!
      const x1 = xs[i + 1]!
      if (x1 - x0 < 1e-9) continue
      const a = unrot({ x: x0, y })
      const b = unrot({ x: x1, y })
      segs.push(row % 2 === 0 ? { a, b } : { a: b, b: a })
    }
  }
  return segs
}

function intersectHorizontal(ring: readonly Vec2[], y: number): number[] {
  const xs: number[] = []
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const p = ring[i]!
    const q = ring[(i + 1) % n]!
    const y0 = p.y
    const y1 = q.y
    if (Math.abs(y1 - y0) < 1e-12) continue
    const min = Math.min(y0, y1)
    const max = Math.max(y0, y1)
    if (y < min || y >= max) continue
    const t = (y - y0) / (y1 - y0)
    xs.push(p.x + t * (q.x - p.x))
  }
  return xs
}
