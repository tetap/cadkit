import type { PolylineShapeMeta, Vec2 } from '@cadkit/types'

/** Axis-aligned box from two corners. */
export function boxFromCorners(a: Vec2, b: Vec2): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  cx: number
  cy: number
  w: number
  h: number
} {
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x, b.x)
  const maxY = Math.max(a.y, b.y)
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  }
}

function normalizeRadii(
  radii: PolylineShapeMeta['cornerRadii'],
): [number, number, number, number] {
  if (radii == null) return [0, 0, 0, 0]
  if (typeof radii === 'number') {
    const r = Math.max(0, radii)
    return [r, r, r, r]
  }
  return [
    Math.max(0, radii[0] ?? 0),
    Math.max(0, radii[1] ?? 0),
    Math.max(0, radii[2] ?? 0),
    Math.max(0, radii[3] ?? 0),
  ]
}

export type RectCornerId = 'tl' | 'tr' | 'br' | 'bl'

export function pointsAABB(points: readonly Vec2[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  w: number
  h: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

export function rectCornerPoint(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  id: RectCornerId,
): Vec2 {
  switch (id) {
    case 'tl':
      return { x: box.minX, y: box.minY }
    case 'tr':
      return { x: box.maxX, y: box.minY }
    case 'br':
      return { x: box.maxX, y: box.maxY }
    case 'bl':
      return { x: box.minX, y: box.maxY }
  }
}

/** Inward unit diagonal from a rect corner (Y-down). */
export function rectCornerInwardUnit(id: RectCornerId): Vec2 {
  const s = Math.SQRT1_2
  switch (id) {
    case 'tl':
      return { x: s, y: s }
    case 'tr':
      return { x: -s, y: s }
    case 'br':
      return { x: -s, y: -s }
    case 'bl':
      return { x: s, y: -s }
  }
}

/**
 * Corner-radius handle position along the inward diagonal.
 * Distance from corner is `radius + minPad` so a zero radius still clears
 * the object-mode scale corner, while staying invertible with
 * {@link rectCornerRadiusFromLocal}.
 */
export function rectCornerHandleLocal(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  id: RectCornerId,
  radius: number,
  minPad = 0,
): Vec2 {
  const corner = rectCornerPoint(box, id)
  const u = rectCornerInwardUnit(id)
  const d = Math.max(0, radius) + Math.max(0, minPad)
  return { x: corner.x + u.x * d, y: corner.y + u.y * d }
}

/** Inverse of {@link rectCornerHandleLocal}: `radius = dist(corner) - minPad`. */
export function rectCornerRadiusFromLocal(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  id: RectCornerId,
  local: Vec2,
  minPad = 0,
): number {
  const corner = rectCornerPoint(box, id)
  const dist = Math.hypot(local.x - corner.x, local.y - corner.y)
  const maxR = Math.min(box.maxX - box.minX, box.maxY - box.minY) / 2
  const r = Math.max(0, Math.min(maxR, dist - Math.max(0, minPad)))
  return r < 1e-9 ? 0 : r
}

export function parseRectCornerId(handleId: string): RectCornerId | null {
  const m = /:corner:(tl|tr|br|bl)$/.exec(handleId)
  return m ? (m[1] as RectCornerId) : null
}

/** Clamp rect corner radii so adjacent corners don't overlap. */
export function clampRectCornerRadii(
  w: number,
  h: number,
  radii: PolylineShapeMeta['cornerRadii'],
): [number, number, number, number] {
  let [tl, tr, br, bl] = normalizeRadii(radii)
  const maxW = Math.max(0, w / 2)
  const maxH = Math.max(0, h / 2)
  const lim = Math.min(maxW, maxH)
  tl = Math.min(tl, lim)
  tr = Math.min(tr, lim)
  br = Math.min(br, lim)
  bl = Math.min(bl, lim)
  // Adjacent pairs along each edge.
  const scaleTop = tl + tr > w && w > 0 ? w / (tl + tr) : 1
  const scaleBot = bl + br > w && w > 0 ? w / (bl + br) : 1
  const scaleLeft = tl + bl > h && h > 0 ? h / (tl + bl) : 1
  const scaleRight = tr + br > h && h > 0 ? h / (tr + br) : 1
  const s = Math.min(scaleTop, scaleBot, scaleLeft, scaleRight, 1)
  return [tl * s, tr * s, br * s, bl * s]
}

/**
 * Tessellate a rounded axis-aligned rect (TL→TR→BR→BL, Y-down).
 * `cornerRadii` are TL, TR, BR, BL.
 */
export function tessellateRoundedRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  cornerRadii: PolylineShapeMeta['cornerRadii'] = 0,
  segmentsPerCorner = 8,
): Vec2[] {
  const w = maxX - minX
  const h = maxY - minY
  if (w < 1e-9 || h < 1e-9) return []
  const [tl, tr, br, bl] = clampRectCornerRadii(w, h, cornerRadii)
  if (tl + tr + br + bl < 1e-9) {
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ]
  }
  const segs = Math.max(2, Math.round(segmentsPerCorner))
  const out: Vec2[] = []

  const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const a = a0 + (a1 - a0) * t
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
  }

  // Top edge left → right, then clockwise corners (Y-down: π/2 is down).
  out.push({ x: minX + tl, y: minY })
  out.push({ x: maxX - tr, y: minY })
  if (tr > 1e-9) arc(maxX - tr, minY + tr, tr, -Math.PI / 2, 0)
  out.push({ x: maxX, y: maxY - br })
  if (br > 1e-9) arc(maxX - br, maxY - br, br, 0, Math.PI / 2)
  out.push({ x: minX + bl, y: maxY })
  if (bl > 1e-9) arc(minX + bl, maxY - bl, bl, Math.PI / 2, Math.PI)
  out.push({ x: minX, y: minY + tl })
  if (tl > 1e-9) arc(minX + tl, minY + tl, tl, Math.PI, (Math.PI * 3) / 2)

  return dedupePoints(out)
}

/**
 * Heart from a classic SVG (two cubic lobes + a V), tessellated to a polyline
 * and fitted into the given AABB. Design space matches:
 *   M cleft  c…  c…  L tip  L  c…  C cleft z
 */
export function buildHeartPath(minX: number, minY: number, maxX: number, maxY: number, samples = 8): Vec2[] {
  const w = maxX - minX
  const h = maxY - minY
  if (w < 1e-9 || h < 1e-9) return []
  const steps = Math.max(4, Math.round(samples))
  // Source path units (Y-down). R = lobe span; k = cubic handle inset.
  const R = 80.176
  const k = 22.14
  const cx = 276.337
  const cy = 277.638
  const cleft = { x: cx, y: cy }
  const left = { x: cx - R, y: cy }
  const leftLow = { x: cx - R, y: cy + R }
  const tip = { x: cx, y: cy + 2 * R }
  const rightLow = { x: cx + R, y: cy + R }
  const right = { x: cx + R, y: cy }

  const raw: Vec2[] = []
  const append = (pts: Vec2[], skipFirst: boolean) => {
    for (let i = skipFirst ? 1 : 0; i < pts.length; i++) raw.push(pts[i]!)
  }
  append(
    sampleCubic(cleft, { x: cx - k, y: cy - k }, { x: cx - (R - k), y: cy - k }, left, steps),
    false,
  )
  append(
    sampleCubic(left, { x: cx - R - k, y: cy + k }, { x: cx - R - k, y: cy + R - k }, leftLow, steps),
    true,
  )
  raw.push(tip, rightLow)
  append(
    sampleCubic(
      rightLow,
      { x: cx + R + k, y: cy + R - k },
      { x: cx + R + k, y: cy + k },
      right,
      steps,
    ),
    true,
  )
  append(
    sampleCubic(right, { x: cx + R - k, y: cy - k }, { x: cx + k, y: cy - k }, cleft, steps),
    true,
  )

  let rMinX = Infinity
  let rMinY = Infinity
  let rMaxX = -Infinity
  let rMaxY = -Infinity
  for (const p of raw) {
    rMinX = Math.min(rMinX, p.x)
    rMinY = Math.min(rMinY, p.y)
    rMaxX = Math.max(rMaxX, p.x)
    rMaxY = Math.max(rMaxY, p.y)
  }
  const rw = Math.max(1e-9, rMaxX - rMinX)
  const rh = Math.max(1e-9, rMaxY - rMinY)
  return raw.map((p) => ({
    x: minX + ((p.x - rMinX) / rw) * w,
    y: minY + ((p.y - rMinY) / rh) * h,
  }))
}

function sampleCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, steps: number): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const uu = u * u
    const tt = t * t
    const a = uu * u
    const b = 3 * uu * t
    const c = 3 * u * tt
    const d = tt * t
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    })
  }
  return out
}

/** Vertex centroid — more stable than AABB center for point-up stars. */
export function starCenter(points: readonly Vec2[]): { cx: number; cy: number } {
  if (!points.length) return { cx: 0, cy: 0 }
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  const n = points.length
  return { cx: sx / n, cy: sy / n }
}

/** Recover construction outer radius from tessellated (possibly filleted) points. */
export function starConstructionRadius(
  points: readonly Vec2[],
  cx: number,
  cy: number,
  tips: number,
  corner: number,
): number {
  let maxD = 0
  for (const p of points) {
    maxD = Math.max(maxD, Math.hypot(p.x - cx, p.y - cy))
  }
  if (maxD < 1e-9) return 0
  if (corner < 1e-6) return maxD
  // Fillet pulls tip vertices inward — invert by matching radial extent.
  let R = maxD
  for (let i = 0; i < 4; i++) {
    const filleted = buildStarPath(cx, cy, R, tips, 0.4, corner)
    let md = 0
    for (const p of filleted) md = Math.max(md, Math.hypot(p.x - cx, p.y - cy))
    if (md < 1e-9) break
    R *= maxD / md
  }
  return R
}

/** World units per tip step when dragging the tips handle (Y-down: up → more tips). */
export function starTipsDragStep(outerR: number): number {
  return Math.max(outerR * 0.15, 1e-3)
}

/**
 * Tips handle stays on the construction midline to the right of the star.
 * Tip count is no longer encoded in Y (that made the handle fly away as tips grew).
 */
export function starTipsHandleLocal(
  cx: number,
  cy: number,
  outerR: number,
  pad: number,
): Vec2 {
  return { x: cx + Math.max(1e-6, outerR) + Math.max(0, pad), y: cy }
}

/** @deprecated Prefer {@link starTipsHandleLocal}; Y is always the construction centerline. */
export function starTipsHandleY(cy: number, _outerR?: number, _tips?: number): number {
  return cy
}

/** Map vertical drag delta from press → tip count. */
export function starTipsFromDelta(startTips: number, outerR: number, dy: number): number {
  return Math.max(3, Math.min(24, Math.round(startTips - dy / starTipsDragStep(outerR))))
}

/** Absolute fallback when no drag-start is available (tests / one-shot edits). */
export function starTipsFromHandleY(cy: number, outerR: number, localY: number): number {
  return starTipsFromDelta(5, outerR, localY - cy)
}

/** Corner handle X (local): drag toward center → larger fillet. */
export function starCornerHandleX(cx: number, outerR: number, corner: number): number {
  const maxCorner = outerR * 0.35
  // Keep the zero-radius rest pose just inside the outer tip ring so it stays
  // on the silhouette instead of drifting with AABB maxX after fillets.
  const x0 = cx + outerR * 0.62
  return x0 - Math.max(0, Math.min(maxCorner, corner))
}

export function starCornerFromHandleX(cx: number, outerR: number, localX: number): number {
  const maxCorner = outerR * 0.35
  const x0 = cx + outerR * 0.62
  return Math.max(0, Math.min(maxCorner, x0 - localX))
}

/** Regular star (or polygon when innerR ≈ outerR). */
export function buildStarPath(
  cx: number,
  cy: number,
  outerR: number,
  tips: number,
  innerRatio = 0.4,
  cornerR = 0,
): Vec2[] {
  const n = Math.max(3, Math.min(24, Math.round(tips)))
  const R = Math.max(1e-6, outerR)
  const r = Math.max(1e-6, R * Math.min(0.95, Math.max(0.05, innerRatio)))
  const pts: Vec2[] = []
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? R : r
    // Point-up: start at -π/2.
    const a = -Math.PI / 2 + (i * Math.PI) / n
    pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) })
  }
  if (cornerR > 1e-6) return filletClosedPolyline(pts, Math.min(cornerR, R * 0.35))
  return pts
}

/** Simple chamfer-style fillet at each vertex of a closed polyline. */
export function filletClosedPolyline(points: Vec2[], radius: number): Vec2[] {
  if (points.length < 3 || radius < 1e-9) return points
  const out: Vec2[] = []
  const n = points.length
  const segs = 4
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!
    const cur = points[i]!
    const next = points[(i + 1) % n]!
    const v1x = cur.x - prev.x
    const v1y = cur.y - prev.y
    const v2x = next.x - cur.x
    const v2y = next.y - cur.y
    const len1 = Math.hypot(v1x, v1y) || 1
    const len2 = Math.hypot(v2x, v2y) || 1
    const trim = Math.min(radius, len1 * 0.45, len2 * 0.45)
    const a = { x: cur.x - (v1x / len1) * trim, y: cur.y - (v1y / len1) * trim }
    const b = { x: cur.x + (v2x / len2) * trim, y: cur.y + (v2y / len2) * trim }
    out.push(a)
    for (let s = 1; s < segs; s++) {
      const t = s / segs
      // Quadratic Bezier through corner.
      const ox = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cur.x + t * t * b.x
      const oy = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cur.y + t * t * b.y
      out.push({ x: ox, y: oy })
    }
    out.push(b)
  }
  return dedupePoints(out)
}

/** Rebuild tessellated points from shape meta + current AABB of points. */
export function rebuildShapePoints(
  points: readonly Vec2[],
  shape: PolylineShapeMeta,
): Vec2[] {
  if (!points.length) return []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  // Sharp rect stores exactly 4 corners; rounded tessellation must use full AABB.
  if (shape.kind === 'rect' && points.length === 4) {
    minX = Math.min(points[0]!.x, points[1]!.x, points[2]!.x, points[3]!.x)
    minY = Math.min(points[0]!.y, points[1]!.y, points[2]!.y, points[3]!.y)
    maxX = Math.max(points[0]!.x, points[1]!.x, points[2]!.x, points[3]!.x)
    maxY = Math.max(points[0]!.y, points[1]!.y, points[2]!.y, points[3]!.y)
  }
  const box = boxFromCorners({ x: minX, y: minY }, { x: maxX, y: maxY })
  if (shape.kind === 'rect') {
    const r = shape.cornerRadii ?? 0
    const uniform = typeof r === 'number' ? r : Math.min(...normalizeRadii(r))
    if (uniform < 1e-9 && typeof r === 'number') {
      return [
        { x: box.minX, y: box.minY },
        { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY },
        { x: box.minX, y: box.maxY },
      ]
    }
    return tessellateRoundedRect(box.minX, box.minY, box.maxX, box.maxY, r)
  }
  if (shape.kind === 'heart') {
    return buildHeartPath(box.minX, box.minY, box.maxX, box.maxY)
  }
  // star — AABB seed (≤4 pts) uses box fit; tessellated rings recover tip radius
  // so corner fillets don't shrink the construction size on subsequent rebuilds.
  const tips = shape.points ?? 5
  const corner =
    typeof shape.cornerRadii === 'number' ? shape.cornerRadii : (shape.cornerRadii?.[0] ?? 0)
  const aabbR = Math.min(box.w, box.h) / 2
  if (points.length <= 4) {
    return buildStarPath(box.cx, box.cy, aabbR, tips, 0.4, corner)
  }
  const { cx, cy } = starCenter(points)
  const outerR = starConstructionRadius(points, cx, cy, tips, corner) || aabbR
  return buildStarPath(cx, cy, outerR, tips, 0.4, corner)
}

function dedupePoints(pts: Vec2[]): Vec2[] {
  if (pts.length < 2) return pts
  const out: Vec2[] = [pts[0]!]
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!
    const q = out[out.length - 1]!
    if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) out.push(p)
  }
  return out
}
