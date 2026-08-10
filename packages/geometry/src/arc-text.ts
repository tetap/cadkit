import type { AABB, TextArcPath, Vec2 } from '@cadkit/types'
import { createAABB, emptyAABB, expandAABB, isValidAABB } from '@cadkit/types'
import { measureCharAdvance, measureTextLine } from './text-metrics.js'

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

/** Axis-aligned bounds from rotated glyph quads (uses ink metrics when available). */
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
  for (const g of poses) {
    const m = measureTextLine(g.char, fontSize, fontFamily)
    const hw = Math.max(g.advance, (m.inkRight - m.inkLeft) * widthFactor) / 2
    const ascent = m.ascent
    const descent = m.descent
    // Local quad relative to baseline center.
    const corners: Vec2[] = [
      { x: -hw, y: -ascent },
      { x: hw, y: -ascent },
      { x: hw, y: descent },
      { x: -hw, y: descent },
    ]
    const c = Math.cos(g.rotation)
    const s = Math.sin(g.rotation)
    for (const p of corners) {
      expandAABB(out, g.x + p.x * c - p.y * s, g.y + p.x * s + p.y * c)
    }
  }
  return isValidAABB(out) ? out : createAABB(center.x, center.y, center.x, center.y)
}
