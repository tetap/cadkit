import type { AABB, TextArcPath, TextEntity, Vec2 } from '@cadkit/types'
import { createAABB, emptyAABB, expandAABB, isValidAABB } from '@cadkit/types'
import { measureCharAdvance, measureTextAdvance, measureTextLine } from './text-metrics.js'

export interface ArcGlyphPose {
  char: string
  codePoint: number
  /** World position of the glyph baseline center. */
  x: number
  y: number
  /** Radians; rotate glyph so its baseline follows the arc tangent. */
  rotation: number
  advance: number
}

/**
 * Lay out characters along a circular arc.
 * `center` is the circle center (TextEntity.position when path.kind === 'arc').
 * Newlines are treated as spaces so the string stays on one arc.
 */
export function layoutArcText(
  content: string,
  fontSize: number,
  center: Vec2,
  path: TextArcPath,
  widthFactor = 1,
  fontFamily = 'sans-serif',
): ArcGlyphPose[] {
  const radius = Math.max(1e-3, path.radius)
  const dir = path.sweep < 0 ? -1 : 1
  const baseline = path.baseline ?? 'outer'
  // Inner baseline sits toward the center by roughly one em.
  const r = baseline === 'inner' ? Math.max(1e-3, radius - fontSize) : radius
  const flat = content.replace(/\r?\n/gu, ' ')
  const poses: ArcGlyphPose[] = []
  let traveled = 0
  for (const ch of flat) {
    if (!ch) continue
    const advance = measureCharAdvance(ch, fontSize, fontFamily, widthFactor)
    const mid = traveled + advance / 2
    const angle = path.startAngle + dir * (mid / r)
    // Tangent-aligned upright: CCW reads left→right with top pointing outward.
    const rotation = baseline === 'inner' ? angle - dir * (Math.PI / 2) : angle + dir * (Math.PI / 2)
    poses.push({
      char: ch,
      codePoint: ch.codePointAt(0) ?? 0,
      x: center.x + r * Math.cos(angle),
      y: center.y + r * Math.sin(angle),
      rotation,
      advance,
    })
    traveled += advance
  }
  return poses
}

export interface ArcTextPlacement {
  /** Circle center (written to TextEntity.position). */
  position: Vec2
  path: TextArcPath
}

type TextLayoutInput = Pick<
  TextEntity,
  'content' | 'position' | 'fontSize' | 'fontFamily' | 'widthFactor' | 'align' | 'path'
>

/**
 * Visual center of straight text (em-box), matching TextOverlay placement.
 * For already-arced text, uses glyph AABB center.
 */
export function textVisualCenter(entity: TextLayoutInput): Vec2 {
  const fontSize = Math.max(1e-6, entity.fontSize)
  const fontFamily = entity.fontFamily || 'sans-serif'
  const wf = entity.widthFactor ?? 1

  if (entity.path?.kind === 'arc') {
    const box = arcTextLocalBounds(
      entity.content,
      fontSize,
      entity.position,
      entity.path,
      wf,
      fontFamily,
    )
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
  }

  const lines = entity.content.split(/\r?\n/u)
  const lineCount = Math.max(1, lines.length)
  let maxAdvance = 0
  for (const line of lines) {
    maxAdvance = Math.max(maxAdvance, measureTextLine(line, fontSize, fontFamily).advance * wf)
  }
  const align = entity.align ?? 'left'
  let left = entity.position.x
  if (align === 'center') left = entity.position.x - maxAdvance / 2
  else if (align === 'right') left = entity.position.x - maxAdvance
  // Em-box: top at first baseline - fontSize, bottom at last baseline.
  const top = entity.position.y - fontSize
  const bottom = entity.position.y + (lineCount - 1) * fontSize
  return { x: left + maxAdvance / 2, y: (top + bottom) / 2 }
}

/**
 * Place arc text so the string midpoint sits at the current visual center
 * (top of the circle). Default radius fits the run on ~180° of arc.
 */
export function placeArcTextCentered(
  entity: TextLayoutInput,
  opts?: { radius?: number; sweep?: number; baseline?: 'outer' | 'inner' },
): ArcTextPlacement {
  const fontSize = Math.max(1e-6, entity.fontSize)
  const fontFamily = entity.fontFamily || 'sans-serif'
  const wf = entity.widthFactor ?? 1
  const sweep = opts?.sweep ?? Math.PI
  const baseline = opts?.baseline ?? 'outer'
  const absSweep = Math.max(1e-3, Math.abs(sweep))
  const textWidth = Math.max(
    fontSize * 0.5,
    measureTextAdvance(entity.content.replace(/\r?\n/gu, ' '), fontSize, fontFamily, wf),
  )

  // Prefer a radius that fits the string on the chosen sweep, with a floor.
  const radius =
    opts?.radius ??
    Math.max(fontSize * 2.5, textWidth / absSweep, textWidth / Math.PI)

  const center = textVisualCenter(entity)
  const dir = sweep < 0 ? -1 : 1
  // Middle of the string lands at the top of the circle (-π/2).
  const startAngle = -Math.PI / 2 - dir * (textWidth / (2 * radius))

  // Point at angle -π/2 is (center.x, center.y - radius); put that on the text center.
  const position = { x: center.x, y: center.y + radius }

  return {
    position,
    path: {
      kind: 'arc',
      radius,
      startAngle,
      sweep,
      baseline,
    },
  }
}

function arcLayoutRadius(
  path: TextArcPath,
  fontSize: number,
): { radius: number; layoutR: number; dir: number; baseline: 'outer' | 'inner' } {
  const radius = Math.max(1e-3, path.radius)
  const baseline = path.baseline ?? 'outer'
  const layoutR = baseline === 'inner' ? Math.max(1e-3, radius - fontSize) : radius
  const dir = path.sweep < 0 ? -1 : 1
  return { radius, layoutR, dir, baseline }
}

function measureArcTextWidth(entity: TextLayoutInput): number {
  const fontSize = Math.max(1e-6, entity.fontSize)
  const fontFamily = entity.fontFamily || 'sans-serif'
  const wf = entity.widthFactor ?? 1
  return Math.max(
    fontSize * 0.5,
    measureTextAdvance(entity.content.replace(/\r?\n/gu, ' '), fontSize, fontFamily, wf),
  )
}

/**
 * World-space string midpoint on the arc baseline (the "text calculation center"
 * used as the pivot when editing radius / angles).
 */
export function arcTextStringMidpoint(entity: TextLayoutInput): Vec2 | null {
  if (entity.path?.kind !== 'arc') return null
  const fontSize = Math.max(1e-6, entity.fontSize)
  const { layoutR, dir } = arcLayoutRadius(entity.path, fontSize)
  const textWidth = measureArcTextWidth(entity)
  const midAngle = entity.path.startAngle + dir * (textWidth / (2 * layoutR))
  return {
    x: entity.position.x + layoutR * Math.cos(midAngle),
    y: entity.position.y + layoutR * Math.sin(midAngle),
  }
}

/**
 * Slide text around a fixed circle center so the string midpoint faces `midAngle`.
 * Keeps radius / sweep / baseline and `entity.position` unchanged.
 */
export function slideArcTextOnCircle(
  entity: TextLayoutInput,
  midAngle: number,
): ArcTextPlacement {
  if (entity.path?.kind !== 'arc') {
    return placeArcTextCentered(entity)
  }
  const fontSize = Math.max(1e-6, entity.fontSize)
  const { radius, layoutR, dir, baseline } = arcLayoutRadius(entity.path, fontSize)
  const textWidth = measureArcTextWidth(entity)
  const startAngle = midAngle - dir * (textWidth / (2 * layoutR))
  return {
    position: { x: entity.position.x, y: entity.position.y },
    path: {
      kind: 'arc',
      radius,
      startAngle,
      sweep: entity.path.sweep,
      baseline,
    },
  }
}

/**
 * Update arc path parameters while keeping the string-midpoint world position fixed.
 * When `startAngle` is omitted, the midpoint polar angle is preserved and startAngle
 * is recomputed from text width / radius (so radius edits do not make glyphs "run").
 */
export function updateArcTextPath(
  entity: TextLayoutInput,
  next: {
    radius?: number
    sweep?: number
    baseline?: 'outer' | 'inner'
    /** When set, rotate around the apex so this becomes the new startAngle. */
    startAngle?: number
  },
): ArcTextPlacement {
  if (entity.path?.kind !== 'arc') {
    return placeArcTextCentered(entity, next)
  }

  const fontSize = Math.max(1e-6, entity.fontSize)
  const textWidth = measureArcTextWidth(entity)
  const old = arcLayoutRadius(entity.path, fontSize)
  const oldMidAngle = entity.path.startAngle + old.dir * (textWidth / (2 * old.layoutR))
  const apex = {
    x: entity.position.x + old.layoutR * Math.cos(oldMidAngle),
    y: entity.position.y + old.layoutR * Math.sin(oldMidAngle),
  }

  const radius = Math.max(1e-3, next.radius ?? entity.path.radius)
  const sweep = next.sweep ?? entity.path.sweep
  const baseline = next.baseline ?? old.baseline
  const dir = sweep < 0 ? -1 : 1
  const layoutR = baseline === 'inner' ? Math.max(1e-3, radius - fontSize) : radius

  let startAngle: number
  let midAngle: number
  if (next.startAngle != null && Number.isFinite(next.startAngle)) {
    startAngle = next.startAngle
    midAngle = startAngle + dir * (textWidth / (2 * layoutR))
  } else {
    midAngle = oldMidAngle
    startAngle = midAngle - dir * (textWidth / (2 * layoutR))
  }

  return {
    position: {
      x: apex.x - layoutR * Math.cos(midAngle),
      y: apex.y - layoutR * Math.sin(midAngle),
    },
    path: {
      kind: 'arc',
      radius,
      startAngle,
      sweep,
      baseline,
    },
  }
}

/** Flatten arc text back to straight: baseline at the arc visual center. */
export function placeStraightTextFromArc(entity: TextLayoutInput): { position: Vec2; path: undefined } {
  const center = textVisualCenter(entity)
  const fontSize = Math.max(1e-6, entity.fontSize)
  const fontFamily = entity.fontFamily || 'sans-serif'
  const wf = entity.widthFactor ?? 1
  const advance = measureTextAdvance(entity.content, fontSize, fontFamily, wf)
  const align = entity.align ?? 'left'
  let x = center.x
  if (align === 'left') x = center.x - advance / 2
  else if (align === 'right') x = center.x + advance / 2
  // Em-box middle → baseline
  const y = center.y + fontSize / 2
  return { position: { x, y }, path: undefined }
}

/**
 * Axis-aligned bounds from rotated glyph quads.
 * Matches TextOverlay arc anchors with transform-origin 0 0:
 * `translate(pose) rotate translate(-50%, -100%)` → em-box bottom-center on pose,
 * local y ∈ [-fontSize, 0] (Y-down).
 */
export function arcTextLocalBounds(
  content: string,
  fontSize: number,
  center: Vec2,
  path: TextArcPath,
  widthFactor = 1,
  fontFamily = 'sans-serif',
): AABB {
  const poses = layoutArcText(content, fontSize, center, path, widthFactor, fontFamily)
  if (poses.length === 0) {
    const r = Math.max(path.radius, fontSize)
    return createAABB(center.x - r, center.y - r, center.x + r, center.y + r)
  }
  const out = emptyAABB()
  const em = Math.max(1e-6, fontSize)
  // Overlay does not scaleX glyphs; widthFactor only stretches arc spacing.
  const wf = Math.max(1e-6, widthFactor)
  for (const g of poses) {
    if (!g.char.trim()) continue
    const visualAdvance = g.advance / wf
    const hw = Math.max(visualAdvance, em * 0.5) / 2
    // Local quad relative to em-box bottom-center (pose).
    const corners: Vec2[] = [
      { x: -hw, y: -em },
      { x: hw, y: -em },
      { x: hw, y: 0 },
      { x: -hw, y: 0 },
    ]
    const c = Math.cos(g.rotation)
    const s = Math.sin(g.rotation)
    for (const p of corners) {
      expandAABB(out, g.x + p.x * c - p.y * s, g.y + p.x * s + p.y * c)
    }
  }
  return isValidAABB(out) ? out : createAABB(center.x, center.y, center.x, center.y)
}
