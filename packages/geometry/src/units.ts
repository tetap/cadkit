/** Supported linear units for document storage and ruler display. */
export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'px' | 'pt'

/**
 * Raster / CSS screen pixels per inch.
 * Bitmap import maps pixel size → physical size at this DPI.
 */
export const RASTER_DPI = 96

/**
 * SVG user units per inch when width/height are unitless (1 uu ≈ 1pt).
 * @see https://www.w3.org/TR/SVG11/coords.html#Units
 */
export const SVG_DPI = 72

/** Millimeters per one unit. */
export const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  /** 96 CSS px / inch */
  px: 25.4 / RASTER_DPI,
  /** PostScript / SVG point = 1/72 in */
  pt: 25.4 / SVG_DPI,
}

export const UNIT_LABEL: Record<LengthUnit, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  in: 'in',
  ft: 'ft',
  px: 'px',
  pt: 'pt',
}

/** DXF $INSUNITS → millimeters factor (Autodesk encoding). */
export const DXF_INSUNITS_TO_MM: Record<number, number> = {
  0: 0, // unitless
  1: 25.4, // inches
  2: 304.8, // feet
  3: 1609344, // miles
  4: 1, // millimeters
  5: 10, // centimeters
  6: 1000, // meters
  7: 1_000_000_000, // kilometers
  8: 0.0254 / 1000, // microinches → mm (approx via inches)
  9: 0.0254, // mils
  10: 914.4, // yards
  11: 1e-7, // angstroms
  12: 1e-6, // nanometers
  13: 0.001, // microns
  14: 10, // decimeters
  15: 100_000, // decameters
  16: 100_000_000, // hectometers
  17: 1_609_344_000, // gigameters (unused practically)
  18: 149597870700000, // astronomical
  19: 9.4607304725808e18, // light years
  20: 3.08567758149137e19, // parsecs
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  if (from === to) return value
  return (value * MM_PER_UNIT[from]) / MM_PER_UNIT[to]
}

/**
 * Convert raster pixel length to document world units at {@link RASTER_DPI} (96).
 * Example: 96 px → 1 in → 25.4 mm when `worldUnit` is `'mm'`.
 */
export function rasterPixelsToWorld(
  px: number,
  worldUnit: LengthUnit,
  dpi: number = RASTER_DPI,
): number {
  if (!(px > 0) || !(dpi > 0)) return 0
  const mm = (px / dpi) * 25.4
  return convertLength(mm, 'mm', worldUnit)
}

/**
 * Convert SVG user units (unitless) to document world units at {@link SVG_DPI} (72).
 * Example: 72 uu → 1 in → 25.4 mm when `worldUnit` is `'mm'`.
 */
export function svgUserUnitsToWorld(
  userUnits: number,
  worldUnit: LengthUnit,
  dpi: number = SVG_DPI,
): number {
  if (!(Number.isFinite(userUnits)) || !(dpi > 0)) return 0
  const mm = (userUnits / dpi) * 25.4
  return convertLength(mm, 'mm', worldUnit)
}

export function worldToDisplay(world: number, worldUnit: LengthUnit, displayUnit: LengthUnit): number {
  return convertLength(world, worldUnit, displayUnit)
}

export function displayToWorld(display: number, worldUnit: LengthUnit, displayUnit: LengthUnit): number {
  return convertLength(display, displayUnit, worldUnit)
}

/** Pick a 1/2/5 × 10^n step near `raw`. */
export function niceNumber(raw: number, round = false): number {
  const abs = Math.abs(raw)
  if (!Number.isFinite(abs) || abs <= 0) return 1
  const exp = Math.floor(Math.log10(abs))
  const fraction = abs / 10 ** exp
  let nice: number
  if (round) {
    if (fraction < 1.5) nice = 1
    else if (fraction < 3) nice = 2
    else if (fraction < 7) nice = 5
    else nice = 10
  } else {
    if (fraction <= 1) nice = 1
    else if (fraction <= 2) nice = 2
    else if (fraction <= 5) nice = 5
    else nice = 10
  }
  return nice * 10 ** exp * Math.sign(raw || 1)
}

export interface TickScale {
  /** Major step in display units */
  major: number
  /** Minor step in display units (typically major/5 or major/10) */
  minor: number
  /** Mid step between major and minor (major/2) when useful */
  mid: number
}

/**
 * Compute Figma-like ruler/grid scale from zoom.
 * @param zoom screenPixels / worldUnit
 * @param targetMajorPx desired screen distance between major ticks
 */
export function computeTickScale(
  zoom: number,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  targetMajorPx = 80,
): TickScale {
  const worldPerPx = 1 / Math.max(zoom, 1e-12)
  const displayPerPx = worldToDisplay(worldPerPx, worldUnit, displayUnit)
  const major = niceNumber(displayPerPx * targetMajorPx)
  const mid = major / 2
  const minor = major / 10
  return { major, mid, minor }
}

export function formatTickLabel(value: number, step: number): string {
  const abs = Math.abs(value)
  if (abs < 1e-9) return '0'
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  if (decimals === 0) return String(Math.round(value))
  // Strip trailing zeros after the decimal only (do not strip "100" → "1")
  return value.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

export function dxfInsUnitsToLengthUnit(code: number | undefined): LengthUnit {
  switch (code) {
    case 1:
      return 'in'
    case 2:
      return 'ft'
    case 4:
      return 'mm'
    case 5:
      return 'cm'
    case 6:
      return 'm'
    default:
      return 'mm'
  }
}
