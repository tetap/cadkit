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
 * Motion is travel-optimized (chain + NN + 2-opt); F/S words are deduped.
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
  let lastX: number | null = null
  let lastY: number | null = null

  const at = (x: number, y: number) =>
    lastX != null &&
    lastY != null &&
    Math.hypot(lastX - x, lastY - y) < 1e-6

  for (const m of plan.motions) {
    if (m.kind === 'travel') {
      if (laserOn) {
        lines.push(plan.laserOff)
        laserOn = false
      }
      const { to, feed } = m.travel
      const mx = to.x
      const my = mapY(to.y)
      if (!at(mx, my)) {
        const fWord = feed !== lastFeed ? ` F${fmt(feed)}` : ''
        lastFeed = feed
        lines.push(`G0 X${fmt(mx)} Y${fmt(my)}${fWord}`)
        lastX = mx
        lastY = my
      }
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
    if (!at(fx, fy)) {
      if (laserOn) {
        lines.push(plan.laserOff)
        laserOn = false
      }
      const fTravel = plan.travelSpeed !== lastFeed ? ` F${fmt(plan.travelSpeed)}` : ''
      lastFeed = plan.travelSpeed
      lines.push(`G0 X${fmt(fx)} Y${fmt(fy)}${fTravel}`)
      lastX = fx
      lastY = fy
    }
    if (!laserOn || lastPower !== path.power) {
      lines.push(`${plan.laserOn} S${Math.round(path.power)}`)
      laserOn = true
      lastPower = path.power
    }
    for (let i = 1; i < path.points.length; i++) {
      const p = path.points[i]!
      const x = p.x
      const y = mapY(p.y)
      const fWord = path.feed !== lastFeed ? ` F${fmt(path.feed)}` : ''
      lastFeed = path.feed
      lines.push(`G1 X${fmt(x)} Y${fmt(y)}${fWord}`)
      lastX = x
      lastY = y
    }
  }

  if (laserOn) lines.push(plan.laserOff)
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
