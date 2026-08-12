import type { Vec2 } from '@cadkit/types'

/** How to turn a luma grid into laser cuts. */
export type RasterEngraveMode = 'grayscale' | 'dither'

/**
 * Pre-sampled image for raster engraving (prepared by the editor / host).
 * `luma` is row-major 0–255 (0 = black / burn more, 255 = white / burn less).
 */
export interface ImageRasterSample {
  /** Local image rect (same space as entity.origin / width / height). */
  origin: Vec2
  width: number
  height: number
  cols: number
  rows: number
  luma: Uint8Array
  /**
   * `grayscale` (default): PWM scanlines with variable S per tone.
   * `dither`: binary burn runs (Floyd / threshold already applied in luma).
   */
  engraveMode?: RasterEngraveMode
  /** Burn when luma ≤ this (dither mode only). Default 127. */
  burnMax?: number
  /**
   * Map local image point → document / CAD world.
   * Defaults to identity (local == world).
   */
  localToWorld?: (p: Vec2) => Vec2
}

/** One laser-on segment with constant power. */
export interface RasterPowerCut {
  points: Vec2[]
  /** GRBL S-word for this segment. */
  power: number
}

export interface RasterPowerOptions {
  /** Layer max power (maps black → this). */
  maxPower: number
  /**
   * Tone curve: power ∝ darkness^gamma.
   * <1 boosts midtones (typical laser photo). Default 0.75.
   */
  gamma?: number
  /** Skip almost-white pixels below this power. Default max(1, 2% of max). */
  minPower?: number
  /** Quantize S to this many levels to merge runs / shrink files. Default 64. */
  powerLevels?: number
}

/**
 * Photo-style grayscale engraving: serpentine scanlines with variable power.
 * Adjacent equal-S pixels merge into one G1; near-white is skipped (travel gap).
 */
export function rasterToPowerCuts(
  sample: ImageRasterSample,
  options: RasterPowerOptions,
): RasterPowerCut[] {
  const { cols, rows, luma, origin, width, height } = sample
  if (cols < 1 || rows < 1 || width <= 0 || height <= 0) return []
  if (luma.length < cols * rows) return []

  const maxPower = Math.max(1, options.maxPower)
  const gamma = options.gamma ?? 0.75
  const minPower = options.minPower ?? Math.max(1, Math.round(maxPower * 0.02))
  const levels = Math.max(2, Math.min(256, Math.round(options.powerLevels ?? 64)))
  const toWorld = sample.localToWorld ?? ((p: Vec2) => p)
  const out: RasterPowerCut[] = []

  const xAt = (c: number) => origin.x + (c / cols) * width
  const yAt = (r: number) => origin.y + ((r + 0.5) / rows) * height

  const powerOf = (lumaValue: number): number => {
    const darkness = 1 - Math.min(255, Math.max(0, lumaValue)) / 255
    if (darkness <= 1e-6) return 0
    const shaped = Math.pow(darkness, gamma)
    const raw = maxPower * shaped
    // Quantize so nearby tones share an S-word and merge into longer G1s.
    const step = maxPower / (levels - 1)
    const q = Math.round(raw / step) * step
    return q < minPower ? 0 : Math.min(maxPower, Math.round(q))
  }

  for (let r = 0; r < rows; r++) {
    const rtl = r % 2 === 1
    let runPower = -1
    let runC0 = -1
    let runC1 = -1

    const flush = () => {
      if (runPower <= 0 || runC0 < 0 || runC1 <= runC0) {
        runPower = -1
        runC0 = -1
        runC1 = -1
        return
      }
      const y = yAt(r)
      const left = toWorld({ x: xAt(runC0), y })
      const right = toWorld({ x: xAt(runC1), y })
      out.push({
        points: rtl ? [right, left] : [left, right],
        power: runPower,
      })
      runPower = -1
      runC0 = -1
      runC1 = -1
    }

    for (let i = 0; i < cols; i++) {
      const c = rtl ? cols - 1 - i : i
      const pwr = powerOf(luma[r * cols + c]!)
      if (pwr <= 0) {
        flush()
        continue
      }
      if (runPower === pwr && runC0 >= 0) {
        // Extend toward the direction of travel.
        if (rtl) runC0 = c
        else runC1 = c + 1
        continue
      }
      flush()
      runPower = pwr
      runC0 = c
      runC1 = c + 1
    }
    flush()
  }
  return out
}

/**
 * Binary dither / threshold burns (constant power). Kept for line-art style.
 * Prefer {@link rasterToPowerCuts} for photos.
 */
export function rasterToCutPaths(sample: ImageRasterSample): Vec2[][] {
  const { cols, rows, luma, origin, width, height } = sample
  if (cols < 1 || rows < 1 || width <= 0 || height <= 0) return []
  if (luma.length < cols * rows) return []
  const burnMax = sample.burnMax ?? 127
  const toWorld = sample.localToWorld ?? ((p: Vec2) => p)
  const paths: Vec2[][] = []

  const xAt = (c: number) => origin.x + (c / cols) * width
  const yAt = (r: number) => origin.y + ((r + 0.5) / rows) * height

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
    const rtl = r % 2 === 1
    const ordered = rtl ? runs.slice().reverse() : runs
    for (const run of ordered) {
      const y = yAt(r)
      const left = toWorld({ x: xAt(run.c0), y })
      const right = toWorld({ x: xAt(run.c1), y })
      paths.push(rtl ? [right, left] : [left, right])
    }
  }
  return paths
}
