import type { RenderItem } from '@cadkit/scene'
import { isPaintVisible, parseColor } from './color.js'

/** True when polyline/circle coords form a closed ring (last ≈ first). */
export function isClosedRing(kind: RenderItem['kind'], coords: ArrayLike<number>): boolean {
  if (kind === 'circle') return true
  if (kind === 'line' || kind === 'arc' || kind === 'image' || kind === 'text' || kind === 'fill') {
    return false
  }
  if (coords.length < 6) return false
  const n = coords.length
  const dx = coords[0]! - coords[n - 2]!
  const dy = coords[1]! - coords[n - 1]!
  return dx * dx + dy * dy < 1e-12
}

/**
 * Fan-triangulate a closed ring into colored triangle-list vertices (x,y,r,g,b,a).
 * Suitable for convex shapes (rect / ellipse / circle). Concave polygons may show artifacts.
 */
export function packEntityFillVertices(items: readonly RenderItem[]): {
  vertexData: Float32Array
  vertexCount: number
  uploadBytes: number
} {
  let tris = 0
  for (const item of items) {
    if (!isPaintVisible(item.fill)) continue
    if (!isClosedRing(item.kind, item.coords)) continue
    const n = uniqueRingCount(item.coords)
    if (n >= 3) tris += n - 2
  }
  const floats = Math.max(tris * 3 * 6, 6)
  const data = new Float32Array(floats)
  let o = 0
  for (const item of items) {
    if (!isPaintVisible(item.fill)) continue
    if (!isClosedRing(item.kind, item.coords)) continue
    const [r, g, b, a] = parseColor(item.fill!)
    const c = item.coords
    const n = uniqueRingCount(c)
    if (n < 3) continue
    const x0 = c[0]!
    const y0 = c[1]!
    for (let i = 1; i + 1 < n; i++) {
      const x1 = c[i * 2]!
      const y1 = c[i * 2 + 1]!
      const x2 = c[(i + 1) * 2]!
      const y2 = c[(i + 1) * 2 + 1]!
      data[o++] = x0
      data[o++] = y0
      data[o++] = r
      data[o++] = g
      data[o++] = b
      data[o++] = a
      data[o++] = x1
      data[o++] = y1
      data[o++] = r
      data[o++] = g
      data[o++] = b
      data[o++] = a
      data[o++] = x2
      data[o++] = y2
      data[o++] = r
      data[o++] = g
      data[o++] = b
      data[o++] = a
    }
  }
  return { vertexData: data.subarray(0, o), vertexCount: o / 6, uploadBytes: o * 4 }
}

function uniqueRingCount(coords: ArrayLike<number>): number {
  let n = Math.floor(coords.length / 2)
  if (n >= 2) {
    const dx = coords[0]! - coords[(n - 1) * 2]!
    const dy = coords[1]! - coords[(n - 1) * 2 + 1]!
    if (dx * dx + dy * dy < 1e-12) n -= 1
  }
  return n
}
