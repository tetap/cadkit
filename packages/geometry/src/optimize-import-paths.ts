/**
 * Post-process imported linework (xTool-style):
 * 1. Endpoint merge — weld open paths whose endpoints fall within a tolerance
 * 2. Self-close — close a path when its own endpoints are near
 * 3. Collinear simplify — drop intermediate points that lie on a straight run
 *
 * Only LINE / open POLYLINE are rewritten; other entity types pass through.
 */
import {
  type Entity,
  type LineEntity,
  type PolylineEntity,
  type Vec2,
  createEntityId,
  IDENTITY_TRANSFORM,
} from '@cadkit/types'

export interface OptimizeImportPathsOptions {
  /** Absolute join / close tolerance in document units. Auto if omitted. */
  joinTolerance?: number
  /** Angular tolerance (radians) for collinear collapse. Default ~0.5°. */
  collinearAngle?: number
  /** Drop segments shorter than this (document units). Default = joinTolerance. */
  minSegmentLength?: number
}

export interface OptimizeImportPathsStats {
  before: number
  after: number
  mergedGroups: number
  closed: number
}

export type OptimizeImportPathsResult = {
  entities: Entity[]
  stats: OptimizeImportPathsStats
}

type OpenPath = {
  points: Vec2[]
  layerId: LineEntity['layerId']
  style: LineEntity['style']
}

/**
 * Optimize fragmented LINE / open POLYLINE entities into longer polylines.
 */
export function optimizeImportPaths(
  entities: Entity[],
  options: OptimizeImportPathsOptions = {},
): { entities: Entity[]; stats: OptimizeImportPathsStats } {
  const passthrough: Entity[] = []
  const buckets = new Map<string, OpenPath[]>()

  for (const e of entities) {
    if (e.type === 'line') {
      const pts = dedupeAdjacent([{ ...e.start }, { ...e.end }])
      if (pts.length < 2) continue
      pushBucket(buckets, e, pts)
    } else if (e.type === 'polyline') {
      const pts = dedupeAdjacent(e.points.map((p) => ({ ...p })))
      if (pts.length < 2) continue
      if (e.closed) {
        passthrough.push({
          ...e,
          points: simplifyCollinear(pts, true, options.collinearAngle ?? DEFAULT_ANGLE),
        })
        continue
      }
      pushBucket(buckets, e, pts)
    } else {
      passthrough.push(e)
    }
  }

  const openCount = [...buckets.values()].reduce((n, a) => n + a.length, 0)
  let mergedGroups = 0
  let closed = 0
  const optimized: Entity[] = []

  for (const paths of buckets.values()) {
    const tol = options.joinTolerance ?? estimateJoinTolerance(paths)
    const minLen = options.minSegmentLength ?? tol
    const angle = options.collinearAngle ?? DEFAULT_ANGLE
    const cleaned = paths
      .map((p) => ({ ...p, points: dropShortSegments(p.points, minLen) }))
      .filter((p) => p.points.length >= 2)

    const { chains, closedCount, groupCount } = mergeOpenPaths(cleaned, tol)
    mergedGroups += groupCount
    closed += closedCount

    for (const chain of chains) {
      const pts = simplifyCollinear(chain.points, chain.closed, angle)
      if (pts.length < 2) continue
      optimized.push(toEntity(chain.layerId, chain.style, pts, chain.closed))
    }
  }

  return {
    entities: [...passthrough, ...optimized],
    stats: { before: openCount, after: optimized.length, mergedGroups, closed },
  }
}

const DEFAULT_ANGLE = (0.5 * Math.PI) / 180 // 0.5°

function pushBucket(buckets: Map<string, OpenPath[]>, e: LineEntity | PolylineEntity, points: Vec2[]) {
  const key = `${e.layerId}\0${e.style.stroke ?? ''}\0${e.style.strokeWidth ?? ''}`
  let list = buckets.get(key)
  if (!list) {
    list = []
    buckets.set(key, list)
  }
  list.push({ points, layerId: e.layerId, style: e.style })
}

function estimateJoinTolerance(paths: OpenPath[]): number {
  let minSeg = Infinity
  let maxCoord = 0
  for (const p of paths) {
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1]!
      const b = p.points[i]!
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len > 1e-12) minSeg = Math.min(minSeg, len)
      maxCoord = Math.max(maxCoord, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y))
    }
  }
  const scaleTol = Math.max(1e-6, maxCoord * 1e-6)
  if (!Number.isFinite(minSeg)) return scaleTol
  return Math.min(Math.max(scaleTol, minSeg * 0.02), minSeg * 0.25, 0.1)
}

function mergeOpenPaths(
  paths: OpenPath[],
  tol: number,
): { chains: Array<OpenPath & { closed: boolean }>; closedCount: number; groupCount: number } {
  const n = paths.length
  if (n === 0) return { chains: [], closedCount: 0, groupCount: 0 }

  type Edge = { a: number; b: number; dist: number; colinear: number }
  const edges: Edge[] = []
  const cell = Math.max(tol, 1e-9)
  const grid = new Map<string, number[]>()

  const endpointAt = (slot: number): Vec2 => {
    const path = paths[(slot / 2) | 0]!
    return slot & 1 ? path.points[path.points.length - 1]! : path.points[0]!
  }

  /** Unit direction leaving the path through this endpoint (into the join). */
  const endpointOutDir = (slot: number): Vec2 => {
    const path = paths[(slot / 2) | 0]!
    const pts = path.points
    let dx: number
    let dy: number
    if (slot & 1) {
      const a = pts[pts.length - 2]!
      const b = pts[pts.length - 1]!
      dx = b.x - a.x
      dy = b.y - a.y
    } else {
      const a = pts[0]!
      const b = pts[1]!
      dx = a.x - b.x
      dy = a.y - b.y
    }
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len }
  }

  for (let i = 0; i < n; i++) {
    for (const end of [0, 1] as const) {
      const slot = i * 2 + end
      const p = endpointAt(slot)
      const kx = Math.floor(p.x / cell)
      const ky = Math.floor(p.y / cell)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = grid.get(`${kx + dx},${ky + dy}`)
          if (!list) continue
          for (const other of list) {
            if (((other / 2) | 0) === i) continue
            const q = endpointAt(other)
            const dist = Math.hypot(p.x - q.x, p.y - q.y)
            if (dist > tol) continue
            const a = Math.min(slot, other)
            const b = Math.max(slot, other)
            // Outward dirs into the join: collinear continuation ⇒ opposite dirs (dot ≈ -1).
            const da = endpointOutDir(a)
            const db = endpointOutDir(b)
            const colinear = -(da.x * db.x + da.y * db.y) // 1 = perfect continuation
            edges.push({ a, b, dist, colinear })
          }
        }
      }
      const k = `${kx},${ky}`
      let bucket = grid.get(k)
      if (!bucket) {
        bucket = []
        grid.set(k, bucket)
      }
      bucket.push(slot)
    }
  }

  // Prefer closer joins; at equal distance prefer collinear bar continuations over T-stems.
  edges.sort((a, b) => a.dist - b.dist || b.colinear - a.colinear)

  const used = new Uint8Array(n * 2)
  const adj = new Map<number, number>()
  const uf = new UnionFind(n)

  for (const e of edges) {
    if (used[e.a] || used[e.b]) continue
    const p1 = (e.a / 2) | 0
    const p2 = (e.b / 2) | 0
    if (p1 === p2) continue
    if (uf.find(p1) === uf.find(p2)) continue
    used[e.a] = 1
    used[e.b] = 1
    adj.set(e.a, e.b)
    adj.set(e.b, e.a)
    uf.union(p1, p2)
  }

  const chains: Array<OpenPath & { closed: boolean }> = []
  let closedCount = 0
  let groupCount = 0

  for (const members of uf.getGroups().values()) {
    if (members.length === 1) {
      const path = paths[members[0]!]!
      const start = path.points[0]!
      const end = path.points[path.points.length - 1]!
      if (Math.hypot(start.x - end.x, start.y - end.y) <= tol && path.points.length > 2) {
        chains.push({ ...path, points: weldSelfClose(path.points), closed: true })
        closedCount++
      } else {
        chains.push({ ...path, closed: false })
      }
      continue
    }

    groupCount++
    const ordered = orderChain(members, adj)
    const template = paths[ordered[0]!.pathIndex]!
    let points = stitchOrdered(ordered, paths)
    const start = points[0]!
    const end = points[points.length - 1]!
    if (Math.hypot(start.x - end.x, start.y - end.y) <= tol && points.length > 2) {
      points = weldSelfClose(points)
      chains.push({ layerId: template.layerId, style: template.style, points, closed: true })
      closedCount++
    } else {
      chains.push({ layerId: template.layerId, style: template.style, points, closed: false })
    }
  }

  return { chains, closedCount, groupCount }
}

function stitchOrdered(
  ordered: Array<{ pathIndex: number; reverse: boolean }>,
  paths: OpenPath[],
): Vec2[] {
  let points: Vec2[] = []
  for (let i = 0; i < ordered.length; i++) {
    const step = ordered[i]!
    let pts = paths[step.pathIndex]!.points.map((p) => ({ x: p.x, y: p.y }))
    if (step.reverse) pts.reverse()
    if (i === 0) {
      points = pts
      continue
    }
    const prev = points[points.length - 1]!
    const cur = pts[0]!
    points[points.length - 1] = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 }
    for (let j = 1; j < pts.length; j++) points.push(pts[j]!)
  }
  return dedupeAdjacent(points)
}

/**
 * Walk a degree-≤2 path graph into a linear sequence with orientation.
 */
function orderChain(
  members: number[],
  adj: Map<number, number>,
): Array<{ pathIndex: number; reverse: boolean }> {
  const memberSet = new Set(members)

  // Path-graph degree via joined endpoints
  const degree = (m: number) => (adj.has(m * 2) ? 1 : 0) + (adj.has(m * 2 + 1) ? 1 : 0)

  let start = members[0]!
  for (const m of members) {
    if (degree(m) <= 1) {
      start = m
      break
    }
  }

  // Leave via the joined end if only one join; else prefer end slot
  const startReverse = adj.has(start * 2) && !adj.has(start * 2 + 1)
  const result: Array<{ pathIndex: number; reverse: boolean }> = [{ pathIndex: start, reverse: startReverse }]
  const visited = new Set<number>([start])

  let exitSlot = startReverse ? start * 2 : start * 2 + 1
  while (adj.has(exitSlot)) {
    const enterSlot = adj.get(exitSlot)!
    const next = (enterSlot / 2) | 0
    if (!memberSet.has(next) || visited.has(next)) break
    const reverse = (enterSlot & 1) === 1
    result.push({ pathIndex: next, reverse })
    visited.add(next)
    exitSlot = reverse ? next * 2 : next * 2 + 1
  }

  // Closed loops / mid starts: cover remaining by walking the other way from start
  if (visited.size < members.length) {
    const otherExit = startReverse ? start * 2 + 1 : start * 2
    const prepend: Array<{ pathIndex: number; reverse: boolean }> = []
    let slot = otherExit
    while (adj.has(slot)) {
      const enterSlot = adj.get(slot)!
      const next = (enterSlot / 2) | 0
      if (!memberSet.has(next) || visited.has(next)) break
      const reverse = (enterSlot & 1) === 1
      prepend.push({ pathIndex: next, reverse })
      visited.add(next)
      slot = reverse ? next * 2 : next * 2 + 1
    }
    // prepend walked away from start; reverse list and flip orientations for forward stitch
    prepend.reverse()
    for (const step of prepend) step.reverse = !step.reverse
    return [...prepend, ...result]
  }

  return result
}

function weldSelfClose(points: Vec2[]): Vec2[] {
  if (points.length < 2) return points
  const a = points[0]!
  const b = points[points.length - 1]!
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const out = points.slice(0, -1).map((p) => ({ ...p }))
  out[0] = mid
  return dedupeAdjacent(out)
}

function dropShortSegments(points: Vec2[], minLen: number): Vec2[] {
  if (points.length < 2 || minLen <= 0) return points
  const out: Vec2[] = [{ ...points[0]! }]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const prev = out[out.length - 1]!
    const d = Math.hypot(p.x - prev.x, p.y - prev.y)
    if (d >= minLen) {
      out.push({ ...p })
    } else if (i === points.length - 1) {
      // Keep the true endpoint; collapse the previous stub if needed.
      if (out.length === 1) out.push({ ...p })
      else out[out.length - 1] = { ...p }
    }
  }
  return out.length >= 2 ? out : points
}

function dedupeAdjacent(points: Vec2[], eps = 1e-12): Vec2[] {
  if (points.length === 0) return points
  const out: Vec2[] = [{ ...points[0]! }]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const prev = out[out.length - 1]!
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push({ ...p })
  }
  return out
}

/** Remove intermediate vertices that are nearly collinear. */
export function simplifyCollinear(points: Vec2[], closed: boolean, angleTol = DEFAULT_ANGLE): Vec2[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }))
  const pts = points.map((p) => ({ ...p }))

  if (!closed) {
    const out: Vec2[] = [pts[0]!]
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1]!
      const b = pts[i]!
      const c = pts[i + 1]!
      if (!isCollinear(a, b, c, angleTol)) out.push(b)
    }
    out.push(pts[pts.length - 1]!)
    return dedupeAdjacent(out)
  }

  const out: Vec2[] = []
  const at = (i: number) => pts[((i % pts.length) + pts.length) % pts.length]!
  for (let i = 0; i < pts.length; i++) {
    if (!isCollinear(at(i - 1), at(i), at(i + 1), angleTol)) out.push({ ...at(i) })
  }
  return out.length >= 3 ? dedupeAdjacent(out) : dedupeAdjacent(pts)
}

function isCollinear(a: Vec2, b: Vec2, c: Vec2, angleTol: number): boolean {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const bcx = c.x - b.x
  const bcy = c.y - b.y
  const abLen = Math.hypot(abx, aby)
  const bcLen = Math.hypot(bcx, bcy)
  if (abLen < 1e-12 || bcLen < 1e-12) return true
  const acx = c.x - a.x
  const acy = c.y - a.y
  const acLen = Math.hypot(acx, acy)
  if (acLen < 1e-12) return true
  const distB = Math.abs((b.x - a.x) * acy - (b.y - a.y) * acx) / acLen
  const maxLen = Math.max(abLen, bcLen, acLen)
  return distB <= Math.max(1e-9, maxLen * Math.sin(angleTol))
}

function toEntity(
  layerId: LineEntity['layerId'],
  style: LineEntity['style'],
  points: Vec2[],
  closed: boolean,
): Entity {
  if (!closed && points.length === 2) {
    const line: LineEntity = {
      id: createEntityId('line'),
      type: 'line',
      layerId,
      style,
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: points[0]!,
      end: points[1]!,
    }
    return line
  }
  const poly: PolylineEntity = {
    id: createEntityId('polyline'),
    type: 'polyline',
    layerId,
    style,
    transform: IDENTITY_TRANSFORM,
    version: 1,
    points,
    closed,
  }
  return poly
}

class UnionFind {
  parent: number[]
  rank: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.rank = Array(n).fill(0)
  }
  find(i: number): number {
    const p = this.parent[i]!
    if (p !== i) this.parent[i] = this.find(p)
    return this.parent[i]!
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return false
    if (this.rank[ra]! < this.rank[rb]!) this.parent[ra] = rb
    else if (this.rank[ra]! > this.rank[rb]!) this.parent[rb] = ra
    else {
      this.parent[rb] = ra
      this.rank[ra]!++
    }
    return true
  }
  getGroups(): Map<number, number[]> {
    const map = new Map<number, number[]>()
    for (let i = 0; i < this.parent.length; i++) {
      const r = this.find(i)
      let g = map.get(r)
      if (!g) {
        g = []
        map.set(r, g)
      }
      g.push(i)
    }
    return map
  }
}
