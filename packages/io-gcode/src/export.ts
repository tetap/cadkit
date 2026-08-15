import type { AABB, Entity } from '@cadkit/types'
import { emptyAABB, expandAABB, isValidAABB } from '@cadkit/types'
import { entityWorldBounds } from '@cadkit/geometry'
import { fitPolylineArcs } from './arc-fit.js'
import {
  buildToolpaths,
  type GcodeExportInput,
  type GcodeExportOptions,
  type GcodeToolpathPlan,
} from './toolpaths.js'

export type { GcodeExportInput, GcodeExportOptions, GcodeToolpathPlan }
export {
  buildToolpaths,
  samplePlanProgress,
  type GcodeCutPath,
  type GcodeMotion,
  type GcodeTravel,
} from './toolpaths.js'

/**
 * Export document geometry as GRBL laser G-code.
 * Uses per-layer `LayerGcodeParams` (mode / spacing / power / speed / passes).
 * Compact raster style: modal G0/G1/G2/G3, omit unchanged XY, M3 S on power change.
 */
export function exportGcode(input: GcodeExportInput, options: GcodeExportOptions = {}): string {
  const plan = buildToolpaths(input, options)
  return emitGrbl(plan)
}

/** Serialize a toolpath plan to GRBL (G21/G90/G94, M3/M5, G0/G1/G2/G3). */
export function emitGrbl(plan: GcodeToolpathPlan): string {
  const fmt = (n: number) => n.toFixed(plan.decimals)
  const mapY = (y: number) => (plan.flipY ? plan.yBase - y : y)
  const arcTol = Math.max(0.02, 2 * 10 ** -plan.decimals)
  const lines: string[] = []
  lines.push(`; CADKit G-code export${plan.title ? ` — ${plan.title}` : ''}`)
  lines.push('; Units: mm (G21), absolute (G90), units/min (G94)')
  lines.push('; Compatible with GRBL 1.1 laser mode ($32=1)')
  lines.push('G21')
  lines.push('G90')
  lines.push('G94')
  lines.push(plan.laserOff)

  let lastFeed: number | null = null
  let lastPower: number | null = null
  let laserOn = false
  let lastLayer = ''
  /** Modal motion word: once set, bare `X…` / `Y…` continues that mode. */
  let lastMotion: 'G0' | 'G1' | 'G2' | 'G3' | null = null
  let lastXStr: string | null = null
  let lastYStr: string | null = null

  const atFmt = (xStr: string, yStr: string) => lastXStr === xStr && lastYStr === yStr

  /**
   * Emit a linear move. Repeats G0/G1 only when the motion mode changes;
   * omits X/Y/F words that match the last emitted value.
   */
  const axisMove = (
    code: 'G0' | 'G1',
    x: number,
    y: number,
    opts?: { feed?: number },
  ) => {
    const xStr = fmt(x)
    const yStr = fmt(y)
    const parts: string[] = []
    if (lastMotion !== code) parts.push(code)
    if (lastXStr !== xStr) parts.push(`X${xStr}`)
    if (lastYStr !== yStr) parts.push(`Y${yStr}`)
    if (opts?.feed != null && opts.feed !== lastFeed) {
      parts.push(`F${fmt(opts.feed)}`)
      lastFeed = opts.feed
    }
    if (!parts.length) return
    lines.push(parts.join(' '))
    lastMotion = code
    lastXStr = xStr
    lastYStr = yStr
  }

  /** I/J are incremental from the current point and must be spelled every time. */
  const axisArc = (
    code: 'G2' | 'G3',
    x: number,
    y: number,
    i: number,
    j: number,
    feed?: number,
  ) => {
    const xStr = fmt(x)
    const yStr = fmt(y)
    const parts: string[] = []
    if (lastMotion !== code) parts.push(code)
    if (lastXStr !== xStr) parts.push(`X${xStr}`)
    if (lastYStr !== yStr) parts.push(`Y${yStr}`)
    parts.push(`I${fmt(i)}`)
    parts.push(`J${fmt(j)}`)
    if (feed != null && feed !== lastFeed) {
      parts.push(`F${fmt(feed)}`)
      lastFeed = feed
    }
    lines.push(parts.join(' '))
    lastMotion = code
    lastXStr = xStr
    lastYStr = yStr
  }

  const emitArc = (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    cx: number,
    cy: number,
    viaX: number,
    viaY: number,
    feed: number,
  ) => {
    const cw = isClockwise(fromX, fromY, viaX, viaY, toX, toY, cx, cy)
    emitArcDir(fromX, fromY, toX, toY, cx, cy, cw, feed)
  }

  const emitArcDir = (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    cx: number,
    cy: number,
    cw: boolean,
    feed: number,
  ) => {
    const r = Math.hypot(fromX - cx, fromY - cy)
    const chord = Math.hypot(toX - fromX, toY - fromY)
    const sweep = chord < 1e-7 ? Math.PI * 2 : directedSweep(fromX, fromY, toX, toY, cx, cy, cw)
    // Split full / >180° arcs — some senders reject start==end or long sweeps.
    if (sweep > Math.PI + 1e-6) {
      const mid = arcMidpoint(fromX, fromY, cx, cy, r, cw, sweep)
      emitArcDir(fromX, fromY, mid.x, mid.y, cx, cy, cw, feed)
      emitArcDir(mid.x, mid.y, toX, toY, cx, cy, cw, feed)
      return
    }
    axisArc(cw ? 'G2' : 'G3', toX, toY, cx - fromX, cy - fromY, feed)
  }

  const setPower = (power: number) => {
    const s = Math.round(power)
    if (laserOn && lastPower === s) return
    lines.push(`${plan.laserOn} S${s}`)
    laserOn = true
    lastPower = s
    // M3 does not cancel motion mode on GRBL, but be explicit next move if needed.
  }

  for (const m of plan.motions) {
    if (m.kind === 'travel') {
      if (laserOn) {
        lines.push(plan.laserOff)
        laserOn = false
        lastPower = null
      }
      const mx = m.travel.to.x
      const my = mapY(m.travel.to.y)
      const xStr = fmt(mx)
      const yStr = fmt(my)
      if (!atFmt(xStr, yStr)) axisMove('G0', mx, my, { feed: m.travel.feed })
      continue
    }

    const { path } = m
    if (path.layerName !== lastLayer) {
      lastLayer = path.layerName
      lines.push(`; Layer ${path.layerName} S=${path.power} F=${path.feed}`)
    }
    const first = path.points[0]!
    const fx = first.x
    const fy = mapY(first.y)
    const fxStr = fmt(fx)
    const fyStr = fmt(fy)
    if (!atFmt(fxStr, fyStr)) {
      if (laserOn) {
        lines.push(plan.laserOff)
        laserOn = false
        lastPower = null
      }
      axisMove('G0', fx, fy, { feed: plan.travelSpeed })
    }

    setPower(path.power)

    const segs = fitPolylineArcs(path.points, arcTol)
    let curX = fx
    let curY = fy
    for (const seg of segs) {
      if (seg.kind === 'line') {
        const x = seg.to.x
        const y = mapY(seg.to.y)
        axisMove('G1', x, y, { feed: path.feed })
        curX = x
        curY = y
        continue
      }
      const x = seg.to.x
      const y = mapY(seg.to.y)
      emitArc(
        curX,
        curY,
        x,
        y,
        seg.center.x,
        mapY(seg.center.y),
        seg.via.x,
        mapY(seg.via.y),
        path.feed,
      )
      curX = x
      curY = y
    }
  }

  if (laserOn) lines.push(plan.laserOff)
  // Home: always spell G0 + both axes (clear modal state for controllers).
  lines.push('G0 X0 Y0')
  lines.push('M2')
  return `${lines.join('\n')}\n`
}

/** Convenience: bounds of exported CAD space (pre flip). */
export function exportBounds(entities: readonly Entity[]): AABB {
  const box = emptyAABB()
  for (const e of entities) {
    if (e.type === 'group') continue
    const b = entityWorldBounds(e)
    if (isValidAABB(b)) {
      expandAABB(box, b.minX, b.minY)
      expandAABB(box, b.maxX, b.maxY)
    }
  }
  return box
}

function atan2pt(x: number, y: number, cx: number, cy: number): number {
  return Math.atan2(y - cy, x - cx)
}

/** Signed shortest delta in (-π, π]. */
function wrapPi(d: number): number {
  let a = d
  while (a > Math.PI) a -= Math.PI * 2
  while (a <= -Math.PI) a += Math.PI * 2
  return a
}

function isClockwise(
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
): boolean {
  const a0 = atan2pt(x0, y0, cx, cy)
  const am = atan2pt(vx, vy, cx, cy)
  const a1 = atan2pt(x1, y1, cx, cy)
  return wrapPi(am - a0) + wrapPi(a1 - am) < 0
}

/** Sweep in the travel direction, in (0, 2π]. */
function directedSweep(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  cw: boolean,
): number {
  const a0 = atan2pt(x0, y0, cx, cy)
  const a1 = atan2pt(x1, y1, cx, cy)
  let d = cw ? a0 - a1 : a1 - a0
  while (d <= 0) d += Math.PI * 2
  while (d > Math.PI * 2) d -= Math.PI * 2
  return d
}

function arcMidpoint(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  r: number,
  cw: boolean,
  sweep: number,
): { x: number; y: number } {
  const a0 = atan2pt(x0, y0, cx, cy)
  const amid = cw ? a0 - sweep * 0.5 : a0 + sweep * 0.5
  return { x: cx + r * Math.cos(amid), y: cy + r * Math.sin(amid) }
}
