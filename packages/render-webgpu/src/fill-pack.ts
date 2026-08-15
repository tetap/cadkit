import type { RenderItem } from '@cadkit/scene'
import { isPaintVisible, parseColor } from './color.js'
import { estimateTriangleCount, triangulateRing, uniqueRingCount } from './triangulate.js'

export { uniqueRingCount }

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
 * Triangulate closed rings into colored triangle-list vertices (x,y,r,g,b,a).
 * Uses ear clipping so concave glyphs / stars fill correctly; holes are honored.
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
    tris += estimateTriangleCount(item.coords, item.holes)
  }
  const floats = Math.max(tris * 3 * 6, 6)
  const data = new Float32Array(floats)
  let o = 0
  for (const item of items) {
    if (!isPaintVisible(item.fill)) continue
    if (!isClosedRing(item.kind, item.coords)) continue
    o = appendTriangulatedFill(data, o, item)
  }
  return { vertexData: data.subarray(0, o), vertexCount: o / 6, uploadBytes: o * 4 }
}

/** Append earcut triangles for one filled item; grows nothing (caller sizes buffer). */
export function appendTriangulatedFill(
  data: Float32Array,
  o: number,
  item: RenderItem,
): number {
  const [r, g, b, a] = parseColor(item.fill!)
  const { vertices, indices } = triangulateRing(item.coords, item.holes)
  if (indices.length < 3) return o
  for (let i = 0; i < indices.length; i++) {
    const vi = indices[i]! * 2
    data[o++] = vertices[vi]!
    data[o++] = vertices[vi + 1]!
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
  }
  return o
}
