/**
 * Canvas-backed text metrics for bounds / layout.
 * Falls back to heuristic advances when DOM/canvas is unavailable (Node, workers).
 */

export interface TextLineMetrics {
  /** Layout advance width (em-box run width), unscaled by widthFactor. */
  advance: number
  /** Ink min-x relative to left-aligned origin (≤ 0 when glyphs overhang). */
  inkLeft: number
  /** Ink max-x relative to left-aligned origin. */
  inkRight: number
  /** Distance from baseline up to ink top. */
  ascent: number
  /** Distance from baseline down to ink bottom. */
  descent: number
}

let measureCtx: CanvasRenderingContext2D | null | undefined

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx
  if (typeof document === 'undefined') {
    measureCtx = null
    return null
  }
  const canvas = document.createElement('canvas')
  measureCtx = canvas.getContext('2d')
  return measureCtx
}

/** Heuristic advance used when canvas metrics are unavailable. */
export function estimateTextAdvance(text: string, fontSize: number, widthFactor = 1): number {
  let maxEm = 0
  for (const line of text.split(/\r?\n/u)) {
    let em = 0
    for (const ch of line) {
      const code = ch.codePointAt(0) ?? 0
      em += /\s/u.test(ch) ? 0.33 : code >= 0x3000 ? 1 : 0.55
    }
    maxEm = Math.max(maxEm, em)
  }
  return maxEm * fontSize * widthFactor
}

export function estimateTextLineCount(text: string): number {
  return Math.max(1, text.split(/\r?\n/u).length)
}

function estimateLineMetrics(text: string, fontSize: number): TextLineMetrics {
  const advance = estimateTextAdvance(text, fontSize, 1)
  // Slight pad so fallback AABB is less likely to clip real CJK ink.
  const pad = fontSize * 0.06
  return {
    advance,
    inkLeft: -pad,
    inkRight: advance + pad,
    ascent: fontSize * 0.92,
    descent: fontSize * 0.22,
  }
}

/**
 * Measure a single line (no newlines) in world/font units.
 * `fontSize` is the CSS px-equivalent size used for shaping.
 */
export function measureTextLine(
  text: string,
  fontSize: number,
  fontFamily = 'sans-serif',
): TextLineMetrics {
  if (!text) {
    return {
      advance: 0,
      inkLeft: 0,
      inkRight: 0,
      ascent: fontSize * 0.92,
      descent: fontSize * 0.22,
    }
  }
  const ctx = getMeasureCtx()
  if (!ctx) return estimateLineMetrics(text, fontSize)

  const size = Math.max(1e-6, fontSize)
  ctx.font = `${size}px ${fontFamily || 'sans-serif'}`
  const m = ctx.measureText(text)
  const advance = Number.isFinite(m.width) ? m.width : estimateTextAdvance(text, size, 1)

  const hasInk =
    typeof m.actualBoundingBoxAscent === 'number' &&
    typeof m.actualBoundingBoxDescent === 'number' &&
    (m.actualBoundingBoxAscent > 0 || m.actualBoundingBoxDescent > 0)

  const inkLeft =
    typeof m.actualBoundingBoxLeft === 'number' ? -m.actualBoundingBoxLeft : 0
  const inkRight =
    typeof m.actualBoundingBoxRight === 'number' ? m.actualBoundingBoxRight : advance

  // Hinting / synthetic bold can differ slightly from the live DOM label — small pad.
  const pad = size * 0.04
  return {
    advance,
    inkLeft: (hasInk ? inkLeft : 0) - pad,
    inkRight: (hasInk ? Math.max(inkRight, advance) : advance) + pad,
    ascent: hasInk ? Math.max(m.actualBoundingBoxAscent, size * 0.7) : size * 0.92,
    descent: hasInk ? Math.max(m.actualBoundingBoxDescent, size * 0.05) : size * 0.22,
  }
}

/** Max line advance (with widthFactor). */
export function measureTextAdvance(
  text: string,
  fontSize: number,
  fontFamily = 'sans-serif',
  widthFactor = 1,
): number {
  if (!text) return 0
  let max = 0
  for (const line of text.split(/\r?\n/u)) {
    max = Math.max(max, measureTextLine(line, fontSize, fontFamily).advance)
  }
  return max * widthFactor
}

/** Per-character advance for arc layout. */
export function measureCharAdvance(
  ch: string,
  fontSize: number,
  fontFamily = 'sans-serif',
  widthFactor = 1,
): number {
  if (!ch) return 0
  return measureTextLine(ch, fontSize, fontFamily).advance * widthFactor
}
