/**
 * Engraving toolpath order optimization.
 * Goal: minimize laser-off travel (cut length is fixed for a given geometry).
 *
 * Pipeline:
 *  1. Chain near-contiguous segments (hatch serpentine → fewer jumps)
 *  2. Nearest-neighbor with closed-loop entry + reverse
 *  3. 2-opt tour improvement (bounded for large path counts)
 */
import type { Vec2 } from '@cadkit/types'

export interface OptimizeOrderOptions {
  /** Initial tool position (CAD space). Default {0,0}. */
  start?: Vec2
  /** Merge path end→start when closer than this. Default 0.05. */
  chainTolerance?: number
  /** Max 2-opt improvement passes. Default 16. */
  twoOptPasses?: number
  /** Skip optimization (identity). */
  disabled?: boolean
}

/**
 * Reorder / reorient cut polylines to minimize empty travel.
 * Closed rings may be rotated to the best entry vertex.
 */
export function optimizePathOrder(
  paths: readonly Vec2[][],
  options: OptimizeOrderOptions = {},
): Vec2[][] {
  const usable = paths.filter((p) => p.length >= 2)
  if (usable.length <= 1 || options.disabled) {
    return usable.map((p) => p.map((q) => ({ ...q })))
  }

  const chainTol = options.chainTolerance ?? 0.05
  const start = options.start ?? { x: 0, y: 0 }
  const chained = chainNearbyPaths(usable, chainTol)
  const nn = nearestNeighborTour(chained, start)
  const passes = options.twoOptPasses ?? (nn.length > 200 ? 4 : nn.length > 80 ? 8 : 16)
  return twoOptImprove(nn, start, passes)
}

/** Total empty-travel length for an ordered list of cuts starting at `start`. */
export function travelLength(paths: readonly Vec2[][], start: Vec2 = { x: 0, y: 0 }): number {
  let cursor = start
  let travel = 0
  for (const pts of paths) {
    if (pts.length < 2) continue
    const a = pts[0]!
    travel += Math.hypot(cursor.x - a.x, cursor.y - a.y)
    cursor = pts[pts.length - 1]!
  }
  return travel
}

/**
 * Preserve generation order (hatch scanline rows). Merge path i→i+1 only when
 * geometrically adjacent — never jump ahead via global nearest-neighbor.
 * This keeps fill serpentine coherent; use {@link chainNearbyPaths} /
 * {@link optimizePathOrder} for outline / linework reordering.
 */
export function chainHatchPaths(paths: readonly Vec2[][], tol: number): Vec2[][] {
  const usable = paths.filter((p) => p.length >= 2).map((p) => p.map((q) => ({ ...q })))
  if (usable.length <= 1 || !(tol > 0)) return usable

  const out: Vec2[][] = []
  let chain = usable[0]!
  for (let i = 1; i < usable.length; i++) {
    const next = usable[i]!
    const end = chain[chain.length - 1]!
    const a = next[0]!
    const b = next[next.length - 1]!
    const d0 = Math.hypot(end.x - a.x, end.y - a.y)
    const d1 = Math.hypot(end.x - b.x, end.y - b.y)
    if (d0 <= tol || d1 <= tol) {
      const oriented = d1 + 1e-12 < d0 ? next.slice().reverse() : next
      const join = Math.hypot(end.x - oriented[0]!.x, end.y - oriented[0]!.y)
      chain = join < 1e-9 ? chain.concat(oriented.slice(1)) : chain.concat(oriented)
    } else {
      out.push(chain)
      chain = next
    }
  }
  out.push(chain)
  return out
}

/**
 * Greedily merge paths when the end of A is within `tol` of an endpoint of B.
 * Turns alternating hatch rows into long serpentine polylines.
 */
export function chainNearbyPaths(paths: readonly Vec2[][], tol: number): Vec2[][] {
  if (paths.length <= 1 || !(tol > 0)) {
    return paths.map((p) => p.map((q) => ({ ...q })))
  }
  const remaining = paths.map((p) => p.map((q) => ({ ...q })))
  const out: Vec2[][] = []

  while (remaining.length) {
    let chain = remaining.shift()!
    let grew = true
    while (grew) {
      grew = false
      const end = chain[chain.length - 1]!
      let best = -1
      let bestDist = tol
      let reverse = false
      for (let i = 0; i < remaining.length; i++) {
        const pts = remaining[i]!
        const a = pts[0]!
        const b = pts[pts.length - 1]!
        const d0 = Math.hypot(end.x - a.x, end.y - a.y)
        const d1 = Math.hypot(end.x - b.x, end.y - b.y)
        if (d0 <= bestDist) {
          bestDist = d0
          best = i
          reverse = false
        }
        if (d1 < bestDist) {
          bestDist = d1
          best = i
          reverse = true
        }
      }
      if (best < 0) break
      const pick = remaining.splice(best, 1)[0]!
      const next = reverse ? pick.slice().reverse() : pick
      const join = Math.hypot(end.x - next[0]!.x, end.y - next[0]!.y)
      // Coincident join → drop duplicate vertex; otherwise keep the short
      // bridge (typical hatch serpentine step) as part of the continuous cut.
      chain = join < 1e-9 ? chain.concat(next.slice(1)) : chain.concat(next)
      grew = true
    }
    out.push(chain)
  }
  return out
}

function nearestNeighborTour(paths: readonly Vec2[][], start: Vec2): Vec2[][] {
  const remaining = paths.map((p) => p.map((q) => ({ ...q })))
  const out: Vec2[][] = []
  let cursor = start
  while (remaining.length) {
    let best = 0
    let bestPath: Vec2[] | null = null
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const oriented = bestOrientation(remaining[i]!, cursor)
      const d = Math.hypot(cursor.x - oriented[0]!.x, cursor.y - oriented[0]!.y)
      if (d < bestDist) {
        bestDist = d
        best = i
        bestPath = oriented
      }
    }
    remaining.splice(best, 1)
    const path = bestPath!
    out.push(path)
    cursor = path[path.length - 1]!
  }
  return out
}

/**
 * 2-opt on the path tour using endpoint travel cost. After search, one
 * reorient pass recovers closed-loop entry points.
 */
function twoOptImprove(paths: Vec2[][], start: Vec2, maxPasses: number): Vec2[][] {
  if (paths.length < 3 || maxPasses <= 0) return reorientTour(paths, start)

  let tour = paths.map((p) => p.map((q) => ({ ...q })))
  let bestCost = endpointTravel(tour, start)
  let improved = true
  let pass = 0

  while (improved && pass < maxPasses) {
    improved = false
    pass++
    for (let i = 0; i < tour.length - 1; i++) {
      for (let k = i + 1; k < tour.length; k++) {
        const delta = twoOptDelta(tour, start, i, k)
        if (delta < -1e-9) {
          reverseTourSlice(tour, i, k)
          bestCost += delta
          improved = true
        }
      }
    }
  }
  return reorientTour(tour, start)
}

/** Cheap travel using current path endpoints only (no re-entry search). */
function endpointTravel(paths: readonly Vec2[][], start: Vec2): number {
  let cursor = start
  let travel = 0
  for (const pts of paths) {
    const a = pts[0]!
    travel += Math.hypot(cursor.x - a.x, cursor.y - a.y)
    cursor = pts[pts.length - 1]!
  }
  return travel
}

/**
 * Cost change from reversing tour slice [i..k] (paths and their point order).
 * Internal junctions keep the same length (distance is symmetric); only the
 * two outer junctions at i and k+1 change.
 */
function twoOptDelta(tour: readonly Vec2[][], start: Vec2, i: number, k: number): number {
  const prevEnd = i === 0 ? start : tour[i - 1]![tour[i - 1]!.length - 1]!
  const aStart = tour[i]![0]!
  const bEnd = tour[k]![tour[k]!.length - 1]!
  const nextStart = k + 1 < tour.length ? tour[k + 1]![0]! : null

  // Before: prev → start(i) … end(k) → next
  // After:  prev → end(k) … start(i) → next
  const before =
    Math.hypot(prevEnd.x - aStart.x, prevEnd.y - aStart.y) +
    (nextStart ? Math.hypot(bEnd.x - nextStart.x, bEnd.y - nextStart.y) : 0)
  const after =
    Math.hypot(prevEnd.x - bEnd.x, prevEnd.y - bEnd.y) +
    (nextStart ? Math.hypot(aStart.x - nextStart.x, aStart.y - nextStart.y) : 0)
  return after - before
}

function reverseTourSlice(tour: Vec2[][], i: number, k: number): void {
  const slice = tour.slice(i, k + 1).reverse().map((p) => p.slice().reverse())
  for (let t = 0; t < slice.length; t++) tour[i + t] = slice[t]!
}

/** Walk the tour and flip/rotate each path for the cheapest entry from cursor. */
function reorientTour(paths: readonly Vec2[][], start: Vec2): Vec2[][] {
  const out: Vec2[][] = []
  let cursor = start
  for (const pts of paths) {
    const oriented = bestOrientation(pts, cursor)
    out.push(oriented)
    cursor = oriented[oriented.length - 1]!
  }
  return out
}

/**
 * Choose reverse and/or closed-loop entry so the path starts nearest `cursor`.
 */
export function bestOrientation(points: readonly Vec2[], cursor: Vec2): Vec2[] {
  const pts = points.map((p) => ({ ...p }))
  if (pts.length < 2) return pts

  if (isClosed(pts)) {
    const body = pts.slice(0, -1)
    if (body.length < 2) return pts

    let best: Vec2[] | null = null
    let bestDist = Infinity
    for (let dir = 0; dir < 2; dir++) {
      const seq = dir === 0 ? body : body.slice().reverse()
      for (let i = 0; i < seq.length; i++) {
        const startPt = seq[i]!
        const d = Math.hypot(cursor.x - startPt.x, cursor.y - startPt.y)
        if (d < bestDist) {
          bestDist = d
          const rotated = seq.slice(i).concat(seq.slice(0, i))
          best = [...rotated, { ...rotated[0]! }]
        }
      }
    }
    return best ?? pts
  }

  const a = pts[0]!
  const b = pts[pts.length - 1]!
  const d0 = Math.hypot(cursor.x - a.x, cursor.y - a.y)
  const d1 = Math.hypot(cursor.x - b.x, cursor.y - b.y)
  return d1 + 1e-12 < d0 ? pts.slice().reverse() : pts
}

export function isClosed(points: readonly Vec2[], eps = 1e-6): boolean {
  if (points.length < 3) return false
  const a = points[0]!
  const b = points[points.length - 1]!
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps
}
