import type { Vec2 } from '@cadkit/types'
import { tessellateArc, tessellateCubicBezier, distancePointToSegment } from '@cadkit/geometry'

/**
 * Batch ABI intended for Rust/WASM. JS fallback keeps playground/tests working
 * until the native crate is wired. Call signatures are frozen by the spike.
 */
export interface WasmModule {
  tessellateArcs(
    centers: Float64Array,
    radii: Float64Array,
    startAngles: Float64Array,
    endAngles: Float64Array,
    pixelError: number,
    worldPerPixel: number,
  ): Float64Array
  distanceToSegments(points: Float64Array, segments: Float64Array): Float64Array
}

export const jsWasmFallback: WasmModule = {
  tessellateArcs(centers, radii, startAngles, endAngles, pixelError, worldPerPixel) {
    const out: number[] = []
    const n = radii.length
    for (let i = 0; i < n; i++) {
      const pts = tessellateArc(
        { x: centers[i * 2]!, y: centers[i * 2 + 1]! },
        radii[i]!,
        startAngles[i]!,
        endAngles[i]!,
        pixelError,
        worldPerPixel,
      )
      out.push(pts.length)
      for (const p of pts) out.push(p.x, p.y)
    }
    return new Float64Array(out)
  },
  distanceToSegments(points, segments) {
    const count = points.length / 2
    const out = new Float64Array(count)
    for (let i = 0; i < count; i++) {
      const p = { x: points[i * 2]!, y: points[i * 2 + 1]! }
      let best = Infinity
      for (let s = 0; s + 3 < segments.length; s += 4) {
        const d = distancePointToSegment(
          p,
          { x: segments[s]!, y: segments[s + 1]! },
          { x: segments[s + 2]!, y: segments[s + 3]! },
        )
        if (d < best) best = d
      }
      out[i] = best
    }
    return out
  },
}

let active: WasmModule = jsWasmFallback

export function getWasm(): WasmModule {
  return active
}

export function setWasmModule(mod: WasmModule): void {
  active = mod
}

export function tessellateCubicFallback(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, pixelError: number, worldPerPixel: number) {
  return tessellateCubicBezier(p0, p1, p2, p3, pixelError, worldPerPixel)
}
