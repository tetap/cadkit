/**
 * Extract closed glyph outlines from a TextEntity via canvas rasterization
 * + Moore-neighbor contour tracing.
 *
 * Coordinate space matches the editor (Y increases downward, same as canvas /
 * Camera2D). Glyph anchors match TextOverlay:
 * - straight: em-box bottom at baseline (CSS top = baseline - fontSize)
 * - arc: em-box bottom-center at layout pose (CSS translate(-50%, -100%))
 */
import type { TextEntity, Vec2 } from '@cadkit/types'
import { layoutArcText } from './arc-text.js'
import { measureTextLine } from './text-metrics.js'

export interface TextOutlineContour {
  points: Vec2[]
  closed: true
}

const MAX_CANVAS = 2048
const TARGET_EM_PX = 96

/**
 * Cache glyph rings relative to `entity.position` so translating text during a
 * live offset preview only needs a cheap translate (no re-rasterize).
 */
const outlineCache = new Map<
  string,
  { sig: string; relative: TextOutlineContour[] }
>()

function outlineSignature(entity: TextEntity): string {
  return JSON.stringify({
    c: entity.content,
    ff: entity.fontFamily || 'sans-serif',
    fs: entity.fontSize,
    wf: entity.widthFactor ?? 1,
    al: entity.align ?? 'left',
    rot: entity.rotation ?? 0,
    path: entity.path ?? null,
  })
}

function shiftContours(
  contours: readonly TextOutlineContour[],
  dx: number,
  dy: number,
): TextOutlineContour[] {
  if (dx === 0 && dy === 0) return contours.map((c) => ({ ...c, points: c.points.map((p) => ({ ...p })) }))
  return contours.map((c) => ({
    closed: true as const,
    points: c.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  }))
}

function getCanvas(): HTMLCanvasElement | OffscreenCanvas | null {
  // Prefer a document canvas so font matching matches TextOverlay (OffscreenCanvas
  // often falls back to a different face → systematic outline drift).
  if (typeof document !== 'undefined') {
    return document.createElement('canvas')
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(8, 8)
    } catch {
      /* fall through */
    }
  }
  return null
}

function fontCss(fontSize: number, fontFamily: string): string {
  return `${Math.max(1e-6, fontSize)}px ${fontFamily || 'sans-serif'}`
}

/** True when the browser reports the face ready for this CSS font string. */
function isFontReady(css: string): boolean {
  if (typeof document === 'undefined' || !document.fonts) return true
  try {
    return document.fonts.check(css)
  } catch {
    return true
  }
}

/**
 * Kick off font load when needed. Callers should avoid caching outlines until
 * {@link isFontReady} is true — otherwise a fallback face gets sticky.
 */
function ensureFontLoaded(css: string): void {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    if (!document.fonts.check(css)) void document.fonts.load(css)
  } catch {
    /* ignore */
  }
}

function get2d(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  return canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
}

/**
 * Local-space glyph contours for straight or arc text. Empty when canvas
 * is unavailable or content is blank.
 */
export function textEntityToLocalOutlines(
  entity: TextEntity,
  opts?: { pixelsPerEm?: number },
): TextOutlineContour[] {
  if (!entity.content) return []

  const sig = outlineSignature(entity)
  const cacheKey = String(entity.id)
  const hit = outlineCache.get(cacheKey)
  if (hit && hit.sig === sig && !opts?.pixelsPerEm) {
    return shiftContours(hit.relative, entity.position.x, entity.position.y)
  }

  const canvas = getCanvas()
  if (!canvas) return []
  const ctx = get2d(canvas)
  if (!ctx) return []

  const css = fontCss(entity.fontSize, entity.fontFamily || 'sans-serif')
  ensureFontLoaded(css)

  const absolute =
    entity.path?.kind === 'arc'
      ? outlineArcText(entity, canvas, ctx, opts)
      : outlineStraightText(entity, canvas, ctx, opts)

  // Only cache default-resolution outlines once the face is ready. Caching a
  // fallback raster permanently desyncs preview from the DOM TextOverlay.
  if (!opts?.pixelsPerEm && absolute.length && isFontReady(css)) {
    outlineCache.set(cacheKey, {
      sig,
      relative: shiftContours(absolute, -entity.position.x, -entity.position.y),
    })
  }
  return absolute
}

/** Drop cached outlines (tests / document reload). */
export function clearTextOutlineCache(): void {
  outlineCache.clear()
}

function outlineStraightText(
  entity: TextEntity,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  opts?: { pixelsPerEm?: number },
): TextOutlineContour[] {
  const fontSize = Math.max(1e-6, entity.fontSize)
  const fontFamily = entity.fontFamily || 'sans-serif'
  const wf = entity.widthFactor ?? 1
  const absWf = Math.abs(wf) || 1
  const align = entity.align ?? 'left'
  const rot = entity.rotation ?? 0
  const lines = entity.content.split(/\r?\n/u)
  const lineCount = Math.max(1, lines.length)

  // Layout in unrotated local space (baseline at y=0 for first line), then
  // rotate + scaleX(wf) around the entity anchor — same as TextOverlay.
  // Use |wf| for advances; negative wf only flips via ctx.scale (CSS scaleX).
  let localMinX = Infinity
  let localMaxX = -Infinity
  let localMinY = Infinity
  let localMaxY = -Infinity
  const lineLayouts: Array<{ text: string; x: number; baseline: number }> = []

  for (let i = 0; i < lineCount; i++) {
    const text = lines[i] ?? ''
    const m = measureTextLine(text, fontSize, fontFamily)
    const advance = m.advance * absWf
    const baseline = i * fontSize
    let lineLeft = 0
    if (align === 'center') lineLeft = -advance / 2
    else if (align === 'right') lineLeft = -advance
    // Unscaled x for fillText (ctx.scale applies |wf| and sign).
    lineLayouts.push({ text, x: lineLeft / absWf, baseline })
    // Mirrored em-box about local Y when wf < 0 (matches bounds.ts).
    const x0 = wf < 0 ? -lineLeft - advance : lineLeft
    const x1 = x0 + advance
    localMinX = Math.min(localMinX, x0, x1)
    localMaxX = Math.max(localMaxX, x0, x1)
    localMinY = Math.min(localMinY, baseline - fontSize)
    localMaxY = Math.max(localMaxY, baseline)
  }
  if (!Number.isFinite(localMinX)) return []

  // Expand by ink overhang / rotation by taking corners of local ink AABB.
  const corners: Vec2[] = [
    { x: localMinX, y: localMinY },
    { x: localMaxX, y: localMinY },
    { x: localMaxX, y: localMaxY },
    { x: localMinX, y: localMaxY },
  ]
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  let worldMinX = Infinity
  let worldMinY = Infinity
  let worldMaxX = -Infinity
  let worldMaxY = -Infinity
  for (const p of corners) {
    const wx = entity.position.x + p.x * cos - p.y * sin
    const wy = entity.position.y + p.x * sin + p.y * cos
    worldMinX = Math.min(worldMinX, wx)
    worldMinY = Math.min(worldMinY, wy)
    worldMaxX = Math.max(worldMaxX, wx)
    worldMaxY = Math.max(worldMaxY, wy)
  }

  return rasterizeContours({
    canvas,
    ctx,
    fontSize,
    inkMinX: worldMinX,
    inkMinY: worldMinY,
    inkMaxX: worldMaxX,
    inkMaxY: worldMaxY,
    pixelsPerEm: opts?.pixelsPerEm,
    draw: (scale, originX, originY) => {
      // Y-down world → pixel (no flip): px = scale*(x-originX), py = scale*(y-originY)
      ctx.setTransform(scale, 0, 0, scale, -originX * scale, -originY * scale)
      ctx.translate(entity.position.x, entity.position.y)
      if (rot) ctx.rotate(rot)
      if (wf !== 1) ctx.scale(wf, 1)
      ctx.font = `${fontSize}px ${fontFamily}`
      ctx.textAlign = 'left'
      // Match TextOverlay: em-box bottom on the baseline anchor.
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = '#000'
      for (const line of lineLayouts) {
        if (!line.text) continue
        ctx.fillText(line.text, line.x, line.baseline)
      }
    },
  })
}

/**
 * Per-glyph outlines placed with the same pose transform as TextOverlay:
 * `translate(pose) rotate translate(-50%, -100%)` with transform-origin 0 0
 * (em-box bottom-center on the layout pose).
 */
function outlineArcText(
  entity: TextEntity,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  opts?: { pixelsPerEm?: number },
): TextOutlineContour[] {
  const path = entity.path
  if (!path || path.kind !== 'arc') return []

  const fontSize = Math.max(1e-6, entity.fontSize)
  const fontFamily = entity.fontFamily || 'sans-serif'
  const wf = Math.max(1e-6, entity.widthFactor ?? 1)
  const poses = layoutArcText(
    entity.content,
    fontSize,
    entity.position,
    path,
    wf,
    fontFamily,
  ).filter((g) => g.char.trim().length > 0)

  if (!poses.length) return []

  // Cache by char + visual advance (advance/wf); widthFactor only spaces the arc.
  const glyphCache = new Map<string, TextOutlineContour[]>()
  const out: TextOutlineContour[] = []

  for (const g of poses) {
    const visualAdvance = Math.max(fontSize * 0.2, g.advance / wf)
    const cacheKey = `${g.char}\0${visualAdvance.toFixed(3)}`
    let local = glyphCache.get(cacheKey)
    if (!local) {
      local = rasterizeGlyphLocal(
        canvas,
        ctx,
        g.char,
        fontSize,
        fontFamily,
        visualAdvance,
        opts?.pixelsPerEm,
      )
      glyphCache.set(cacheKey, local)
    }
    const cos = Math.cos(g.rotation)
    const sin = Math.sin(g.rotation)
    for (const c of local) {
      out.push({
        closed: true,
        points: c.points.map((p) => ({
          x: g.x + p.x * cos - p.y * sin,
          y: g.y + p.x * sin + p.y * cos,
        })),
      })
    }
  }
  return out
}

/**
 * Rasterize one glyph in local space with em-box bottom-center at (0,0).
 * `advance` is the CSS/layout box width (matches TextOverlay span width).
 */
function rasterizeGlyphLocal(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  char: string,
  fontSize: number,
  fontFamily: string,
  advance: number,
  pixelsPerEm?: number,
): TextOutlineContour[] {
  const pad = fontSize * 0.35
  const hw = Math.max(advance, fontSize * 0.5) / 2
  // Local em-box matching TextOverlay: x ∈ [-hw, hw], y ∈ [-em, 0], plus ink pad.
  const inkMinX = -hw - pad
  const inkMaxX = hw + pad
  const inkMinY = -fontSize - pad
  const inkMaxY = fontSize * 0.35 + pad

  return rasterizeContours({
    canvas,
    ctx,
    fontSize,
    inkMinX,
    inkMinY,
    inkMaxX,
    inkMaxY,
    pixelsPerEm,
    draw: (scale, originX, originY) => {
      ctx.setTransform(scale, 0, 0, scale, -originX * scale, -originY * scale)
      ctx.font = fontCss(fontSize, fontFamily)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = '#000'
      ctx.fillText(char, 0, 0)
    },
  })
}

function rasterizeContours(args: {
  canvas: HTMLCanvasElement | OffscreenCanvas
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  fontSize: number
  inkMinX: number
  inkMinY: number
  inkMaxX: number
  inkMaxY: number
  pixelsPerEm?: number
  draw: (scale: number, originX: number, originY: number) => void
}): TextOutlineContour[] {
  const { canvas, ctx, fontSize, inkMinX, inkMinY, inkMaxX, inkMaxY } = args
  let scale = args.pixelsPerEm ?? TARGET_EM_PX / fontSize
  const padWorld = fontSize * 0.25
  const worldW = Math.max(fontSize * 0.25, inkMaxX - inkMinX) + padWorld * 2
  const worldH = Math.max(fontSize * 0.25, inkMaxY - inkMinY) + padWorld * 2
  scale = Math.min(scale, MAX_CANVAS / worldW, MAX_CANVAS / worldH)
  scale = Math.max(scale, 1e-3)

  const w = Math.max(2, Math.ceil(worldW * scale))
  const h = Math.max(2, Math.ceil(worldH * scale))
  canvas.width = w
  canvas.height = h

  // Top-left of bitmap in Y-down world space.
  const originX = inkMinX - padWorld
  const originY = inkMinY - padWorld

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  try {
    args.draw(scale, originX, originY)
  } catch {
    return []
  }

  let img: ImageData
  try {
    img = ctx.getImageData(0, 0, w, h)
  } catch {
    return []
  }

  const mask = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    mask[i] = img.data[p + 3]! > 40 ? 1 : 0
  }

  const rings = traceBinaryContours(mask, w, h)
  const contours: TextOutlineContour[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    const pts: Vec2[] = []
    for (const [px, py] of ring) {
      // Moore trace yields integer pixel indices; sample at pixel centers.
      pts.push({
        x: originX + (px + 0.5) / scale,
        y: originY + (py + 0.5) / scale,
      })
    }
    const simplified = simplifyRdp(dedupe(pts), Math.max(1 / scale, fontSize * 0.012))
    if (simplified.length >= 3) contours.push({ points: simplified, closed: true })
  }

  return orientContours(contours)
}

/** Ensure outer rings are CCW (positive area) and holes CW (negative). */
function orientContours(contours: TextOutlineContour[]): TextOutlineContour[] {
  if (contours.length <= 1) {
    return contours.map((c) => {
      const a = signedArea(c.points)
      return a >= 0 ? c : { ...c, points: c.points.slice().reverse() }
    })
  }

  const areas = contours.map((c) => ({
    c,
    area: signedArea(c.points),
    abs: Math.abs(signedArea(c.points)),
    sample: c.points[0]!,
  }))
  areas.sort((a, b) => b.abs - a.abs)

  const out: TextOutlineContour[] = []
  for (const item of areas) {
    let depth = 0
    for (const other of areas) {
      if (other === item) continue
      if (other.abs <= item.abs) continue
      if (pointInPoly(item.sample, other.c.points)) depth++
    }
    const wantPositive = depth % 2 === 0
    const positive = item.area >= 0
    const points = wantPositive === positive ? item.c.points : item.c.points.slice().reverse()
    out.push({ points, closed: true })
  }
  return out
}

function signedArea(pts: Vec2[]): number {
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % n]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function pointInPoly(p: Vec2, ring: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x
    const yi = ring[i]!.y
    const xj = ring[j]!.x
    const yj = ring[j]!.y
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-30) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Moore-neighbor contour trace on a binary mask (1 = filled).
 * Returns rings in pixel coordinates (pixel centers), Y-down.
 */
export function traceBinaryContours(mask: Uint8Array, w: number, h: number): Array<Array<[number, number]>> {
  const started = new Uint8Array(w * h)
  const rings: Array<Array<[number, number]>> = []
  const DX = [-1, -1, 0, 1, 1, 1, 0, -1]
  const DY = [0, -1, -1, -1, 0, 1, 1, 1]

  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x]! : 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i] || started[i]) continue
      if (at(x - 1, y)) continue

      const ring: Array<[number, number]> = []
      let cx = x
      let cy = y
      let bx = x - 1
      let by = y
      const startX = x
      const startY = y
      let guard = w * h * 8
      let closed = false

      while (guard-- > 0) {
        ring.push([cx, cy])
        let backDir = 0
        for (let d = 0; d < 8; d++) {
          if (cx + DX[d]! === bx && cy + DY[d]! === by) {
            backDir = d
            break
          }
        }
        let found = false
        for (let k = 1; k <= 8; k++) {
          const nd = (backDir + k) % 8
          const nx = cx + DX[nd]!
          const ny = cy + DY[nd]!
          if (at(nx, ny)) {
            bx = cx
            by = cy
            cx = nx
            cy = ny
            found = true
            break
          }
        }
        if (!found) break
        if (cx === startX && cy === startY) {
          closed = true
          break
        }
      }

      if (closed && ring.length >= 3) {
        for (const [px, py] of ring) started[py * w + px] = 1
        rings.push(ring)
      } else {
        started[i] = 1
      }
    }
  }
  return rings
}

function dedupe(points: Vec2[], eps = 1e-9): Vec2[] {
  if (!points.length) return points
  const out: Vec2[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const prev = out[out.length - 1]!
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p)
  }
  if (out.length > 2) {
    const a = out[0]!
    const b = out[out.length - 1]!
    if (Math.hypot(a.x - b.x, a.y - b.y) <= eps) out.pop()
  }
  return out
}

function simplifyRdp(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 3) return points
  const closed = points
  const keep = new Uint8Array(closed.length)
  keep[0] = 1
  keep[closed.length - 1] = 1

  const stack: Array<[number, number]> = [[0, closed.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    const a = closed[start]!
    const b = closed[end]!
    let maxDist = 0
    let maxIdx = -1
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    for (let i = start + 1; i < end; i++) {
      const p = closed[i]!
      const dist = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len
      if (dist > maxDist) {
        maxDist = dist
        maxIdx = i
      }
    }
    if (maxDist > epsilon && maxIdx >= 0) {
      keep[maxIdx] = 1
      stack.push([start, maxIdx], [maxIdx, end])
    }
  }

  const out: Vec2[] = []
  for (let i = 0; i < closed.length; i++) if (keep[i]) out.push(closed[i]!)
  return out.length >= 3 ? out : points
}
