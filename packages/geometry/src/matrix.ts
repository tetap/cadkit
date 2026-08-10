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
