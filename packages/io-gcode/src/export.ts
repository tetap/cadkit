import type { AABB, Entity } from '@cadkit/types'
import { emptyAABB, expandAABB, isValidAABB } from '@cadkit/types'
import { entityWorldBounds } from '@cadkit/geometry'
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
 * Compact raster style: modal G0/G1, omit unchanged XY, M3 S on power change.
 */
export function exportGcode(input: GcodeExportInput, options: GcodeExportOptions = {}): string {
  const plan = buildToolpaths(input, options)
  return emitGrbl(plan)
}

/** Serialize a toolpath plan to GRBL (G21/G90/G94, M3/M5, G0/G1). */
export function emitGrbl(plan: GcodeToolpathPlan): string {
  const fmt = (n: number) => n.toFixed(plan.decimals)
  const mapY = (y: number) => (plan.flipY ? plan.yBase - y : y)
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
  let lastMotion: 'G0' | 'G1' | null = null
  let lastXStr: string | null = null
  let lastYStr: string | null = null

  const atFmt = (xStr: string, yStr: string) => lastXStr === xStr && lastYStr === yStr

  /**
   * Emit a move. Repeats G0/G1 only when the motion mode changes;
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

    for (let i = 1; i < path.points.length; i++) {
      const p = path.points[i]!
      axisMove('G1', p.x, mapY(p.y), { feed: path.feed })
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
