/**
 * Photoshop-style text envelope warp in world space (Y-down).
 *
 * Warps use the ink AABB and keep aspect: a wide line of text gets a gentle
 * arc, not a square-normalized 180° fan that flattens glyphs.
 */
import type { TextWarp, TextWarpStyle, Vec2 } from '@cadkit/types'

export const TEXT_WARP_STYLES: readonly TextWarpStyle[] = [
  'arc',
  'arcLower',
  'arcUpper',
  'arch',
  'bulge',
  'shell',
  'flag',
  'wave',
] as const

export interface WarpBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const EPS = 1e-4
const MIN_SCALE = 0.08

export function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(-1, Math.min(1, n))
}

export function normalizeTextWarp(warp: TextWarp): TextWarp {
  return {
    style: warp.style,
    direction: warp.direction === 'vertical' ? 'vertical' : 'horizontal',
    bend: clampUnit(warp.bend),
    distortH: clampUnit(warp.distortH ?? 0),
    distortV: clampUnit(warp.distortV ?? 0),
  }
}

export function defaultTextWarp(style: TextWarpStyle = 'arc'): TextWarp {
  return {
    style,
    direction: 'horizontal',
    bend: 0.5,
    distortH: 0,
    distortV: 0,
  }
}

export function isIdentityWarp(warp: TextWarp | undefined | null): boolean {
  if (!warp) return true
  const w = normalizeTextWarp(warp)
  return Math.abs(w.bend) < EPS && Math.abs(w.distortH ?? 0) < EPS && Math.abs(w.distortV ?? 0) < EPS
}

export function warpBoxFromPoints(points: readonly Vec2[]): WarpBox | null {
  if (!points.length) return null
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
  if (!Number.isFinite(minX)) return null
  if (maxX - minX < 1e-6) {
    minX -= 0.5
    maxX += 0.5
  }
  if (maxY - minY < 1e-6) {
    minY -= 0.5
    maxY += 0.5
  }
  return { minX, minY, maxX, maxY }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Map a point through the envelope.
 * Local frame: origin at box center, Y-up (`ly`), X right (`lx`).
 */
function styleWarp(
  style: TextWarpStyle,
  lx: number,
  ly: number,
  bend: number,
  halfW: number,
  halfH: number,
): [number, number] {
  if (Math.abs(bend) < EPS) return [lx, ly]
  const u = halfW > 1e-9 ? lx / halfW : 0
  const v = halfH > 1e-9 ? ly / halfH : 0
  switch (style) {
    case 'arc':
      return warpArc(lx, ly, bend, halfW, halfH)
    case 'arcLower':
      return warpArcEdge(lx, ly, bend, halfW, halfH, 'lower')
    case 'arcUpper':
      return warpArcEdge(lx, ly, bend, halfW, halfH, 'upper')
    case 'arch': {
      const sag = bend * Math.max(halfH, halfW * 0.18)
      return [lx, ly + sag * Math.cos(u * (Math.PI / 2))]
    }
    case 'bulge': {
      const s = Math.max(MIN_SCALE, 1 + bend * Math.cos(u * (Math.PI / 2)))
      return [lx, ly * s]
    }
    case 'shell': {
      const t = (v + 1) / 2
      const pinch = 1 - Math.abs(bend) * 0.28 * (1 - t)
      const lift = bend * halfH * (1 - u * u) * (1 - t)
      return [lx * pinch, ly + lift]
    }
    case 'flag': {
      const sag = bend * Math.max(halfH, halfW * 0.16)
      return [lx, ly + sag * Math.sin((u + 1) * (Math.PI / 2))]
    }
    case 'wave': {
      const amp = bend * halfH * 0.7
      return [lx, ly + amp * Math.sin((u + 1) * Math.PI * 2)]
    }
    default:
      return [lx, ly]
  }
}

/**
 * Annular-sector mapping that preserves chord width and glyph height.
 * Positive bend arches toward +Y (visual up after Y-down conversion).
 */
function warpArc(
  lx: number,
  ly: number,
  bend: number,
  halfW: number,
  halfH: number,
): [number, number] {
  const sag = bend * Math.max(halfH * 1.15, halfW * 0.22)
  if (Math.abs(sag) < 1e-6 || halfW < 1e-6) return [lx, ly]
  const R = (halfW * halfW + sag * sag) / (2 * Math.abs(sag))
  const sign = Math.sign(sag)
  const cy = sag - sign * R
  const ux = Math.max(-1, Math.min(1, lx / halfW))
  const thetaMax = Math.atan2(halfW, R - Math.abs(sag))
  const theta = ux * thetaMax
  const r = Math.max(halfH * 0.15, sign * R + ly)
  return [r * Math.sin(theta), cy + r * Math.cos(theta)]
}

function warpArcEdge(
  lx: number,
  ly: number,
  bend: number,
  halfW: number,
  halfH: number,
  edge: 'lower' | 'upper',
): [number, number] {
  const top = edge === 'upper' ? warpArc(lx, halfH, bend, halfW, halfH) : ([lx, halfH] as [number, number])
  const bot = edge === 'lower' ? warpArc(lx, -halfH, bend, halfW, halfH) : ([lx, -halfH] as [number, number])
  const t = halfH > 1e-9 ? (ly + halfH) / (2 * halfH) : 0.5
  return [lerp(bot[0], top[0], t), lerp(bot[1], top[1], t)]
}

export function warpPoint(point: Vec2, box: WarpBox, warp: TextWarp): Vec2 {
  const w = normalizeTextWarp(warp)
  const halfW = (box.maxX - box.minX) / 2
  const halfH = (box.maxY - box.minY) / 2
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2

  let lx = point.x - cx
  let ly = -(point.y - cy)
  if (w.direction === 'vertical') {
    const t = lx
    lx = ly
    ly = t
  }

  const spanX = w.direction === 'vertical' ? halfH : halfW
  const spanY = w.direction === 'vertical' ? halfW : halfH

  const hd = w.distortH ?? 0
  const vd = w.distortV ?? 0
  if (Math.abs(hd) >= EPS || Math.abs(vd) >= EPS) {
    const u = spanX > 1e-9 ? lx / spanX : 0
    const v = spanY > 1e-9 ? ly / spanY : 0
    const sx = 1 + vd * v
    const sy = 1 + hd * u
    lx *= sx < 0 ? -Math.max(MIN_SCALE, Math.abs(sx)) : Math.max(MIN_SCALE, sx)
    ly *= sy < 0 ? -Math.max(MIN_SCALE, Math.abs(sy)) : Math.max(MIN_SCALE, sy)
  }

  const [wx, wy] = styleWarp(w.style, lx, ly, w.bend, spanX, spanY)
  let ox = wx
  let oy = wy
  if (w.direction === 'vertical') {
    ox = wy
    oy = wx
  }
  return { x: cx + ox, y: cy - oy }
}

function densifyClosed(points: readonly Vec2[], maxSeg: number): Vec2[] {
  if (points.length < 2) return points.map((p) => ({ ...p }))
  const out: Vec2[] = []
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    out.push({ x: a.x, y: a.y })
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.min(20, Math.floor(d / Math.max(1e-6, maxSeg)))
    for (let k = 1; k < steps; k++) {
      const t = k / steps
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

export function warpContours<T extends { points: Vec2[]; closed?: boolean }>(
  contours: readonly T[],
  box: WarpBox,
  warp: TextWarp,
): T[] {
  if (isIdentityWarp(warp) || contours.length === 0) {
    return contours.map((c) => ({ ...c, points: c.points.map((p) => ({ ...p })) }))
  }
  const maxSeg = Math.max(0.35, Math.min(box.maxX - box.minX, box.maxY - box.minY) / 28)
  return contours.map((c) => {
    const src = c.closed === false ? c.points.map((p) => ({ ...p })) : densifyClosed(c.points, maxSeg)
    return {
      ...c,
      points: src.map((p) => warpPoint(p, box, warp)),
    }
  })
}
