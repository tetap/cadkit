/**
 * Envelope text warp (Photoshop Warp Text / 花冠·扇形 presets).
 *
 * Points are editor-space (Y-down). Style envelopes run in a centered
 * Y-up frame; horizontal / vertical perspective is applied afterwards so
 * Flag + 水平透视 matches the tall right-hand peak in reference shots.
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

/** Crown / flag wave: 0 at both ends, 1 in the middle. */
function crownWave(u: number): number {
  return Math.cos(u * (Math.PI / 2))
}

/**
 * Map (u,v) ∈ [-1,1]² through a style envelope.
 * Returns local Y-up coordinates in world units.
 *
 * `hd` / `vd` are consumed by Flag / Wave so 水平透视 boosts the crown
 * (peak shifts right and grows from the baseline) instead of scaling the
 * whole Y coordinate — that old path crushed wide CJK into a mountain.
 */
function styleEnvelope(
  style: TextWarpStyle,
  u: number,
  v: number,
  bend: number,
  halfW: number,
  halfH: number,
  hd = 0,
  vd = 0,
): [number, number] {
  const uu = Math.max(-1, Math.min(1, u))
  const vv = Math.max(-1, Math.min(1, v))

  if (Math.abs(bend) < EPS && Math.abs(hd) < EPS && Math.abs(vd) < EPS) {
    return [uu * halfW, vv * halfH]
  }

  switch (style) {
    case 'arc':
      return warpArc(uu * halfW, vv * halfH, bend, halfW, halfH)
    case 'arcLower':
      return warpArcEdge(uu * halfW, vv * halfH, bend, halfW, halfH, 'lower')
    case 'arcUpper':
      return warpArcEdge(uu * halfW, vv * halfH, bend, halfW, halfH, 'upper')
    case 'arch': {
      const sag = bend * Math.max(1.15 * halfH, 0.28 * halfW)
      return [uu * halfW, vv * halfH + sag * crownWave(uu)]
    }
    case 'bulge': {
      const s = Math.max(MIN_SCALE, 1 + bend * crownWave(uu))
      return [uu * halfW, vv * halfH * s]
    }
    case 'shell': {
      const t = (vv + 1) / 2
      const pinch = 1 - Math.abs(bend) * 0.32 * (1 - t)
      const lift = bend * Math.max(halfH, 0.2 * halfW) * (1 - uu * uu) * (1 - t)
      return [uu * halfW * pinch, vv * halfH + lift]
    }
    case 'flag':
      return warpFlag(uu, vv, bend, halfW, halfH, hd, vd)
    case 'wave':
      return warpWave(uu, vv, bend, halfW, halfH, hd, vd)
    default:
      return [uu * halfW, vv * halfH]
  }
}

/**
 * Cap width so a long line of digits still flows, but amplitude stays
 * tied to glyph height (Photoshop / xTool Flag). Uncapped `k * halfW`
 * is what turned 花冠 100% + 水平透视 into a single mountain.
 */
function heightAmp(bend: number, halfH: number, halfW: number, hK: number, wK: number): number {
  // Width helps a long line flow, but is capped so 100% + 水平透视
  // cannot turn the envelope into a single mountain.
  return bend * (hK * halfH + wK * Math.min(halfW, 5.5 * halfH))
}

/**
 * 花冠 (Flag): top and bottom ride the same crown, top more so mid glyphs
 * grow; verticals shear with the slope. 水平透视 scales height from the
 * column baseline and boosts the right-hand wave — matching the tall
 * mid-right 1's and the flat right-hand tail in the reference shots.
 */
function warpFlag(
  u: number,
  v: number,
  bend: number,
  halfW: number,
  halfH: number,
  hd = 0,
  vd = 0,
): [number, number] {
  const wave = crownWave(u)
  // 50% matches the reference flag; above that, ease so 100% does not
  // double the slope and smear neighbouring glyphs into a triangle.
  const bAbs = Math.abs(bend)
  const bShaped = Math.sign(bend) * (bAbs <= 0.5 ? bAbs : 0.5 + 0.42 * (bAbs - 0.5))
  // H-distort strengthens the crown on +u (peak slides right) without
  // making the far-right end tall — wave is still 0 at the ends.
  const waveH = wave * (1 + hd * u * 0.45)
  const amp = heightAmp(bShaped, halfH, halfW, 1.85, 0.4)
  const bot = -halfH + amp * 0.42 * waveH
  const rawTop = halfH + amp * 1.38 * waveH
  // Grow from the baseline so letters shoot up. Floor keeps the left
  // side readable (the 0.42 floor + 0.82 slope crushed it into a spike).
  const hScale = Math.max(0.62, 1 + hd * u * 0.7)
  const top = bot + (rawTop - bot) * hScale
  const t = (v + 1) / 2
  const ly = lerp(bot, top, t)
  const slope = -Math.sin(u * (Math.PI / 2))
  const shear = bShaped * 0.38 * halfH * slope * v
  // V-distort: negative pinches the top (pointy 1's) and lets the
  // bottom-right spill into the long tail of the last glyph.
  const xScale = Math.max(0.35, 1 + vd * v * 1.6)
  let lx = u * halfW * xScale + shear
  if (vd < 0 && v < 0 && u > 0) {
    lx += -vd * -v * u * 0.45 * halfW
  }
  return [lx, ly]
}

/** 波浪形: two periods, same envelope idea as flag but smaller. */
function warpWave(
  u: number,
  v: number,
  bend: number,
  halfW: number,
  halfH: number,
  hd = 0,
  vd = 0,
): [number, number] {
  const wave = Math.sin((u + 1) * Math.PI)
  const waveH = wave * (1 + hd * u * 0.4)
  const amp = heightAmp(bend, halfH, halfW, 1.05, 0.08)
  const bot = -halfH + amp * 0.4 * waveH
  const rawTop = halfH + amp * 1.15 * waveH
  const hScale = Math.max(0.42, 1 + hd * u * 0.7)
  const top = bot + (rawTop - bot) * hScale
  const slope = Math.cos((u + 1) * Math.PI) * Math.PI
  const shear = bend * 0.28 * halfH * slope * v
  const xScale = Math.max(0.22, 1 + vd * v * 1.4)
  return [u * halfW * xScale + shear, lerp(bot, top, (v + 1) / 2)]
}

function warpArc(
  lx: number,
  ly: number,
  bend: number,
  halfW: number,
  halfH: number,
): [number, number] {
  const sag = bend * Math.max(1.2 * halfH, 0.26 * halfW)
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

function scaleKeepSign(value: number, factor: number): number {
  if (factor >= 0) return value * Math.max(MIN_SCALE, factor)
  return value * -Math.max(MIN_SCALE, Math.abs(factor))
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
  const u = spanX > 1e-9 ? lx / spanX : 0
  const v = spanY > 1e-9 ? ly / spanY : 0

  const hd = w.distortH ?? 0
  const vd = w.distortV ?? 0
  let [ox, oy] = styleEnvelope(w.style, u, v, w.bend, spanX, spanY, hd, vd)

  // Flag / Wave already fold perspective into the envelope. Other styles
  // get a baseline-anchored trapezoid so 水平透视 cannot zero the left side.
  if (w.style !== 'flag' && w.style !== 'wave' && (Math.abs(hd) >= EPS || Math.abs(vd) >= EPS)) {
    const [, botY] = styleEnvelope(w.style, u, -1, w.bend, spanX, spanY, 0, 0)
    oy = botY + (oy - botY) * Math.max(0.42, 1 + hd * u * 0.82)
    ox = scaleKeepSign(ox, 1 + vd * v)
  }

  if (w.direction === 'vertical') {
    const t = ox
    ox = oy
    oy = t
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
    const steps = Math.min(32, Math.floor(d / Math.max(1e-6, maxSeg)))
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
  const maxSeg = Math.max(0.25, Math.min(box.maxX - box.minX, box.maxY - box.minY) / 36)
  return contours.map((c) => {
    const src = c.closed === false ? c.points.map((p) => ({ ...p })) : densifyClosed(c.points, maxSeg)
    return {
      ...c,
      points: src.map((p) => warpPoint(p, box, warp)),
    }
  })
}
