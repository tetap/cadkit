/**
 * GRBL / laser G-code import.
 * Parses G0/G1/G2/G3 (+ modal G20/G21/G90/G91, M3/M4/M5) into CADKit
 * line / polyline / arc entities, then welds fragmented cuts via
 * {@link optimizeImportPaths}.
 */
import {
  optimizeImportPaths,
  type OptimizeImportPathsOptions,
} from '@cadkit/geometry'
import {
  IDENTITY_TRANSFORM,
  createEntityId,
  createLayerId,
  type ArcEntity,
  type Entity,
  type LayerId,
  type LineEntity,
  type PolylineEntity,
  type Vec2,
} from '@cadkit/types'

export interface GcodeWarning {
  code: string
  message: string
}

export interface GcodeImportOptions {
  /** Document layer for imported entities. */
  layerId?: LayerId
  /** Flip Y (machine bottom-left → CAD Y-down). Default true (matches export). */
  flipY?: boolean
  /** Weld fragmented LINE / open POLYLINE after parse. Default true. */
  optimize?: boolean
  optimizeOptions?: OptimizeImportPathsOptions
  /** Default stroke color. */
  stroke?: string
  signal?: AbortSignal
}

export interface GcodeImportResult {
  entities: Entity[]
  warnings: GcodeWarning[]
  stats?: { before: number; after: number; mergedGroups: number; closed: number }
}

const TWO_PI = Math.PI * 2

/**
 * Parse a GRBL-style `.nc` / `.gcode` string into document entities.
 */
export function importGcode(source: string, options: GcodeImportOptions = {}): GcodeImportResult {
  const warnings: GcodeWarning[] = []
  const layerId = options.layerId ?? createLayerId('gcode')
  const flipY = options.flipY !== false
  const stroke = options.stroke ?? '#32cd79'
  const style = { stroke, strokeWidth: 1 }

  const raw = parseToEntities(source, layerId, style, flipY, warnings, options.signal)
  if (options.optimize === false) {
    return { entities: raw, warnings }
  }
  const { entities, stats } = optimizeImportPaths(raw, options.optimizeOptions)
  if (stats.before !== stats.after) {
    warnings.push({
      code: 'GCODE_OPTIMIZE',
      message: `Merged ${stats.before} → ${stats.after} paths (${stats.mergedGroups} groups, ${stats.closed} closed)`,
    })
  }
  return { entities, warnings, stats }
}

function parseToEntities(
  source: string,
  layerId: LayerId,
  style: LineEntity['style'],
  flipY: boolean,
  warnings: GcodeWarning[],
  signal?: AbortSignal,
): Entity[] {
  let x = 0
  let y = 0
  let absolute = true
  let inches = false
  let motion: 0 | 1 | 2 | 3 = 0
  let laserOn = false
  /** When true, treat G1 as cut even without M3 (some files omit laser words). */
  let sawLaserWord = false

  const entities: Entity[] = []
  let poly: Vec2[] = []

  const unitScale = () => (inches ? 25.4 : 1)
  const mapY = (yy: number) => (flipY ? -yy : yy)

  const flushPoly = () => {
    const pts = dedupe(poly)
    poly = []
    if (pts.length < 2) return
    if (pts.length === 2) {
      entities.push(makeLine(layerId, style, pts[0]!, pts[1]!))
    } else {
      entities.push(makePolyline(layerId, style, pts, false))
    }
  }

  const pushCutPoint = (nx: number, ny: number) => {
    const p = { x: nx * unitScale(), y: mapY(ny * unitScale()) }
    if (!poly.length) poly.push(p)
    else {
      const last = poly[poly.length - 1]!
      if (Math.hypot(last.x - p.x, last.y - p.y) > 1e-9) poly.push(p)
    }
  }

  const lines = source.split(/\r?\n/)
  for (let li = 0; li < lines.length; li++) {
    signal?.throwIfAborted()
    const rawLine = lines[li]!
    const line = stripComments(rawLine).trim()
    if (!line) continue

    const words = tokenize(line)
    if (!words.length) continue

    // Modal word scan (order-independent within block, GRBL-style).
    let hasX = false
    let hasY = false
    let hasI = false
    let hasJ = false
    let hasR = false
    let X = x
    let Y = y
    let I = 0
    let J = 0
    let R = 0
    let motionOverride: 0 | 1 | 2 | 3 | null = null

    for (const w of words) {
      const letter = w[0]!
      const num = Number(w.slice(1))
      if (!Number.isFinite(num) && letter !== 'M' && letter !== 'G') continue
      switch (letter) {
        case 'G': {
          const g = Math.trunc(num)
          if (g === 0 || g === 1 || g === 2 || g === 3) motionOverride = g as 0 | 1 | 2 | 3
          else if (g === 20) inches = true
          else if (g === 21) inches = false
          else if (g === 90) absolute = true
          else if (g === 91) absolute = false
          else if (g === 17) {
            /* XY plane — only plane we support */
          } else if (g === 18 || g === 19) {
            warnings.push({
              code: 'GCODE_PARTIAL',
              message: `Unsupported plane G${g} on line ${li + 1}; treating as XY`,
            })
          }
          break
        }
        case 'M': {
          const m = Math.trunc(num)
          if (m === 3 || m === 4) {
            sawLaserWord = true
            if (!laserOn) {
              flushPoly()
              laserOn = true
            }
          } else if (m === 5) {
            sawLaserWord = true
            flushPoly()
            laserOn = false
          } else if (m === 2 || m === 30) {
            flushPoly()
            laserOn = false
          }
          break
        }
        case 'X':
          hasX = true
          X = absolute ? num : x + num
          break
        case 'Y':
          hasY = true
          Y = absolute ? num : y + num
          break
        case 'I':
          hasI = true
          I = num
          break
        case 'J':
          hasJ = true
          J = num
          break
        case 'R':
          hasR = true
          R = num
          break
        default:
          break
      }
    }

    if (motionOverride != null) motion = motionOverride

    const moves = hasX || hasY || hasI || hasJ || hasR
    if (!moves) continue

    // Cutting = laser on, or (no laser words in file) any G1/G2/G3.
    const isCut =
      motion !== 0 && (laserOn || (!sawLaserWord && (motion === 1 || motion === 2 || motion === 3)))

    if (motion === 0 || !isCut) {
      flushPoly()
      x = hasX ? X : x
      y = hasY ? Y : y
      continue
    }

    if (motion === 1) {
      // Ensure we start a poly at current position when beginning a cut.
      if (!poly.length) pushCutPoint(x, y)
      x = hasX ? X : x
      y = hasY ? Y : y
      pushCutPoint(x, y)
      continue
    }

    // G2 / G3 arcs
    const x0 = x
    const y0 = y
    const x1 = hasX ? X : x
    const y1 = hasY ? Y : y
    flushPoly()

    const arc = ijOrRToArc(x0, y0, x1, y1, I, J, R, hasI || hasJ, hasR, motion === 2, unitScale(), flipY)
    if (arc) {
      entities.push({
        id: createEntityId('arc'),
        type: 'arc',
        layerId,
        style,
        transform: IDENTITY_TRANSFORM,
        version: 1,
        center: arc.center,
        radius: arc.radius,
        startAngle: arc.startAngle,
        endAngle: arc.endAngle,
      } satisfies ArcEntity)
    } else {
      // Fallback: chord
      entities.push(
        makeLine(
          layerId,
          style,
          { x: x0 * unitScale(), y: mapY(y0 * unitScale()) },
          { x: x1 * unitScale(), y: mapY(y1 * unitScale()) },
        ),
      )
      warnings.push({
        code: 'GCODE_ARC_FALLBACK',
        message: `Could not resolve arc on line ${li + 1}; imported as line`,
      })
    }
    x = x1
    y = y1
  }

  flushPoly()
  return entities
}

/**
 * Convert G2/G3 I/J or R form into a CADKit arc (CCW tessellation from start→end).
 * With flipY (machine Y-up → CAD Y-down), machine CW/CCW swap.
 */
function ijOrRToArc(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  I: number,
  J: number,
  R: number,
  hasIJ: boolean,
  hasR: boolean,
  machineCw: boolean,
  scale: number,
  flipY: boolean,
): { center: Vec2; radius: number; startAngle: number; endAngle: number } | null {
  let cx: number
  let cy: number
  if (hasIJ) {
    cx = x0 + I
    cy = y0 + J
  } else if (hasR) {
    const resolved = centerFromR(x0, y0, x1, y1, R, machineCw)
    if (!resolved) return null
    cx = resolved.x
    cy = resolved.y
  } else {
    return null
  }

  const r0 = Math.hypot(x0 - cx, y0 - cy)
  const r1 = Math.hypot(x1 - cx, y1 - cy)
  const radius = ((r0 + r1) / 2) * scale
  if (!(radius > 1e-9)) return null

  const mapY = (yy: number) => (flipY ? -yy : yy) * scale
  const center = { x: cx * scale, y: mapY(cy) }
  const sx = x0 * scale
  const sy = mapY(y0)
  const ex = x1 * scale
  const ey = mapY(y1)
  const a0 = Math.atan2(sy - center.y, sx - center.x)
  const a1 = Math.atan2(ey - center.y, ex - center.x)

  // flipY mirrors handedness: machine CW → CAD CCW.
  const cadCw = flipY ? !machineCw : machineCw
  const full = Math.hypot(x1 - x0, y1 - y0) < 1e-9

  if (full) {
    return {
      center,
      radius,
      startAngle: a0,
      endAngle: a0 + TWO_PI - 1e-9,
    }
  }

  // tessellateArc sweeps CCW from start→end. For a CAD CW motion, swap endpoints.
  if (cadCw) {
    return { center, radius, startAngle: a1, endAngle: a0 }
  }
  if (Math.abs(a1 - a0) < 1e-12) {
    return { center, radius, startAngle: a0, endAngle: a0 + TWO_PI - 1e-9 }
  }
  return { center, radius, startAngle: a0, endAngle: a1 }
}

function centerFromR(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  R: number,
  clockwise: boolean,
): Vec2 | null {
  const dx = x1 - x0
  const dy = y1 - y0
  const chord = Math.hypot(dx, dy)
  if (chord < 1e-12) return null
  const r = Math.abs(R)
  if (r < chord / 2 - 1e-9) return null
  const h = Math.sqrt(Math.max(0, r * r - (chord * 0.5) ** 2))
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  const ux = -dy / chord
  const uy = dx / chord
  // Positive R = shorter arc; sign of offset depends on CW/CCW.
  const shorter = R >= 0
  // For CCW shorter: center is to the left of directed chord.
  let side = shorter ? 1 : -1
  if (clockwise) side = -side
  return { x: mx + ux * h * side, y: my + uy * h * side }
}

function stripComments(line: string): string {
  // `; comment` or `(comment)`
  let s = line.replace(/;.*$/, '')
  s = s.replace(/\([^)]*\)/g, ' ')
  return s
}

function tokenize(line: string): string[] {
  // Words like G0, G90.1, X10.5, M3, F1000 — case-insensitive.
  const out: string[] = []
  const re = /([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    out.push(m[1]!.toUpperCase() + m[2]!)
  }
  return out
}

function dedupe(points: readonly Vec2[], eps = 1e-9): Vec2[] {
  if (!points.length) return []
  const out: Vec2[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const q = out[out.length - 1]!
    if (Math.hypot(p.x - q.x, p.y - q.y) > eps) out.push(p)
  }
  return out
}

function makeLine(layerId: LayerId, style: LineEntity['style'], a: Vec2, b: Vec2): LineEntity {
  return {
    id: createEntityId('line'),
    type: 'line',
    layerId,
    style,
    transform: IDENTITY_TRANSFORM,
    version: 1,
    start: a,
    end: b,
  }
}

function makePolyline(
  layerId: LayerId,
  style: LineEntity['style'],
  points: Vec2[],
  closed: boolean,
): PolylineEntity {
  return {
    id: createEntityId('polyline'),
    type: 'polyline',
    layerId,
    style,
    transform: IDENTITY_TRANSFORM,
    version: 1,
    points,
    closed,
  }
}
