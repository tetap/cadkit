import type { Vec2 } from '@cadkit/types'

/**
 * Pre-sampled image for raster engraving (prepared by the editor / host).
 * `luma` is row-major 0–255; dark pixels (≤ burnMax) are burned.
 */
export interface ImageRasterSample {
  /** Local image rect (same space as entity.origin / width / height). */
  origin: Vec2
  width: number
  height: number
  cols: number
  rows: number
  luma: Uint8Array
  /** Burn when luma ≤ this. Default 127 (after Floyd binary dither). */
  burnMax?: number
  /**
   * Map local image point → document / CAD world.
   * Defaults to identity (local == world).
   */
  localToWorld?: (p: Vec2) => Vec2
}

/**
 * Convert a dithered / thresholded image sample into serpentine scanline cuts.
 * Each path is a horizontal (in image-local space) burn run; rows alternate direction.
 */
export function rasterToCutPaths(sample: ImageRasterSample): Vec2[][] {
  const { cols, rows, luma, origin, width, height } = sample
  if (cols < 1 || rows < 1 || width <= 0 || height <= 0) return []
  if (luma.length < cols * rows) return []
  const burnMax = sample.burnMax ?? 127
  const toWorld = sample.localToWorld ?? ((p: Vec2) => p)
  const paths: Vec2[][] = []

  const atLocal = (c: number, r: number): Vec2 => ({
    x: origin.x + ((c + 0.5) / cols) * width,
    y: origin.y + ((r + 0.5) / rows) * height,
  })

  for (let r = 0; r < rows; r++) {
    const runs: Array<{ c0: number; c1: number }> = []
    let runStart = -1
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && luma[r * cols + c]! <= burnMax
      if (on && runStart < 0) runStart = c
      if (!on && runStart >= 0) {
        runs.push({ c0: runStart, c1: c })
        runStart = -1
      }
    }
    if (!runs.length) continue
    const ordered = r % 2 === 0 ? runs : runs.slice().reverse()
    for (const run of ordered) {
      const left = toWorld(atLocal(run.c0, r))
      const right = toWorld(atLocal(run.c1 - 1, r))
      // Odd rows already reversed run list; keep geometric L→R / R→L serpentine.
      if (r % 2 === 0) paths.push([left, right])
      else paths.push([right, left])
    }
  }
  return paths
}
