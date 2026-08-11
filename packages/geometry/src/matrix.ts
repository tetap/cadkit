import type { Vec2 } from '@cadkit/types'

/** Affine 2D matrix stored as [a, b, c, d, e, f] for x' = ax + cy + e, y' = bx + dy + f */
export type Matrix3 = [number, number, number, number, number, number]

export const IDENTITY: Matrix3 = [1, 0, 0, 1, 0, 0]

export function createMatrix(
  a = 1,
  b = 0,
  c = 0,
  d = 1,
  e = 0,
  f = 0,
): Matrix3 {
  return [a, b, c, d, e, f]
}

export function cloneMatrix(m: Matrix3): Matrix3 {
  return [m[0], m[1], m[2], m[3], m[4], m[5]]
}

export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

export function invert(m: Matrix3): Matrix3 | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-15) return null
  const invDet = 1 / det
  return [
    m[3] * invDet,
    -m[1] * invDet,
    -m[2] * invDet,
    m[0] * invDet,
    (m[2] * m[5] - m[3] * m[4]) * invDet,
    (m[1] * m[4] - m[0] * m[5]) * invDet,
  ]
}

export function transformPoint(m: Matrix3, p: Vec2): Vec2 {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  }
}

export function translate(tx: number, ty: number): Matrix3 {
  return [1, 0, 0, 1, tx, ty]
}

export function scale(sx: number, sy: number = sx): Matrix3 {
  return [sx, 0, 0, sy, 0, 0]
}

export function rotate(angleRad: number): Matrix3 {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  return [cos, sin, -sin, cos, 0, 0]
}

export function compose(translateXY: Vec2, scaleXY: Vec2, rotation: number): Matrix3 {
  return multiply(
    translate(translateXY.x, translateXY.y),
    multiply(rotate(rotation), scale(scaleXY.x, scaleXY.y)),
  )
}

export function determinant(m: Matrix3): number {
  return m[0] * m[3] - m[1] * m[2]
}

/**
 * Decompose the linear part of an affine matrix for baking into text entities.
 *
 * Reflections (det < 0) are encoded as a negative `scaleX` plus an adjusted
 * rotation — same convention as CSS 2D matrix decomposition — so a horizontal
 * flip becomes `widthFactor *= -1` rather than a bogus `rotation += π` that
 * leaves glyphs upside-down relative to the selection AABB.
 */
export function decomposeTextLinear(m: Matrix3): {
  /** Uniform magnitude applied to fontSize / arc radius (always > 0). */
  scale: number
  /** Delta rotation in radians. */
  rotation: number
  /** Sign for widthFactor (±1). Negative means mirror about the local Y axis. */
  widthSign: number
} {
  const a = m[0]
  const b = m[1]
  const c = m[2]
  const d = m[3]
  let scaleX = Math.hypot(a, b)
  const scaleY = Math.hypot(c, d)
  let row0x = a
  let row0y = b
  // det < 0 ⇒ reflection: fold into negative scaleX and unflip the first column
  // before taking atan2 (CSS Transforms Level 1 decomposition).
  if (a * d - b * c < 0) {
    scaleX = -scaleX
    row0x = -row0x
    row0y = -row0y
  }
  const absX = Math.abs(scaleX)
  const absY = Math.abs(scaleY)
  const scale =
    absX > 1e-8 && absY > 1e-8 ? Math.sqrt(absX * absY) : Math.max(absX, absY, 1e-8)
  const rotation = absX > 1e-8 || Math.abs(row0y) > 1e-8 || Math.abs(row0x) > 1e-8
    ? Math.atan2(row0y, row0x)
    : 0
  return {
    scale,
    rotation,
    widthSign: scaleX < 0 ? -1 : 1,
  }
}
