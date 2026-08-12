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
 * Triangulate a closed ring into colored triangle-list vertices (x,y,r,g,b,a).
 * Uses a centroid fan so star-shaped concave polygons (stars / hearts) fill correctly.
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
    if (n >= 3) tris += n
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
    let cx = 0
    let cy = 0
    for (let i = 0; i < n; i++) {
      cx += c[i * 2]!
      cy += c[i * 2 + 1]!
    }
    cx /= n
    cy /= n
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      data[o++] = cx
      data[o++] = cy
      data[o++] = r
      data[o++] = g
      data[o++] = b
      data[o++] = a
      data[o++] = c[i * 2]!
      data[o++] = c[i * 2 + 1]!
      data[o++] = r
      data[o++] = g
      data[o++] = b
      data[o++] = a
      data[o++] = c[j * 2]!
      data[o++] = c[j * 2 + 1]!
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
