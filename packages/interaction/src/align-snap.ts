import type { AABB, Entity, EntityId, WorldPoint } from '@cadkit/types'
import { worldPoint } from '@cadkit/types'
import { entityWorldBounds, type Matrix3 } from '@cadkit/geometry'
import type { SnapOptions } from './snap.js'

export interface AlignGuide {
  axis: 'x' | 'y'
  /** World position of the guide line */
  position: number
  /** Span of the guide in the orthogonal axis [min, max] */
  spanMin: number
  spanMax: number
  /** Distance label in world units (optional) */
  distance?: number
  /** Midpoint for placing the distance label */
  labelAt?: WorldPoint
}

export interface AlignSnapResult {
  dx: number
  dy: number
  guides: AlignGuide[]
}

export interface AlignSnapOptions extends SnapOptions {
  alignEnabled?: boolean
  showDistances?: boolean
  angleStepDeg?: number
}

function aabbEdges(box: AABB): { x: number[]; y: number[] } {
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  return {
    x: [box.minX, cx, box.maxX],
    y: [box.minY, cy, box.maxY],
  }
}

/** Snap rotation delta (radians) to nearest angle step. */
export function snapAngleDelta(deltaRad: number, stepDeg: number): number {
  if (!(stepDeg > 0)) return deltaRad
  const step = (stepDeg * Math.PI) / 180
  return Math.round(deltaRad / step) * step
}

/**
 * Snap a selection AABB translation against other entities + optional grid.
 * `proposed` is the selection bounds after applying raw (dx,dy).
 */
export function snapSelectionTranslation(
  proposed: AABB,
  rawDx: number,
  rawDy: number,
  others: readonly Entity[],
  options: AlignSnapOptions,
  worldMatrixOf?: (e: Entity) => Matrix3,
): AlignSnapResult {
  if (!options.enabled && !options.alignEnabled) {
    return { dx: rawDx, dy: rawDy, guides: [] }
  }
  const tol = options.pixelTolerance * options.worldPerPixel
  let bestDx = rawDx
  let bestDy = rawDy
  let bestAbsX = Infinity
  let bestAbsY = Infinity
  const guides: AlignGuide[] = []

  const src = aabbEdges(proposed)

  if (options.alignEnabled !== false) {
    for (const e of others) {
      if (e.style.visible === false) continue
      const box = worldMatrixOf ? entityWorldBounds(e, worldMatrixOf(e)) : entityWorldBounds(e)
      if (!Number.isFinite(box.minX) || box.minX > box.maxX) continue
      const tgt = aabbEdges(box)

      for (const sx of src.x) {
        for (const tx of tgt.x) {
          const err = tx - sx
          if (Math.abs(err) <= tol && Math.abs(err) < bestAbsX) {
            bestAbsX = Math.abs(err)
            bestDx = rawDx + err
            guides.length = 0
            // rebuild guides after both axes settled — stored tentatively
          }
        }
      }
      for (const sy of src.y) {
        for (const ty of tgt.y) {
          const err = ty - sy
          if (Math.abs(err) <= tol && Math.abs(err) < bestAbsY) {
            bestAbsY = Math.abs(err)
            bestDy = rawDy + err
          }
        }
      }
    }
  }

  // Grid snap on selection center (optional)
  if (options.gridSize && options.gridSize > 0 && options.enabled) {
    const g = options.gridSize
    const cx = (proposed.minX + proposed.maxX) / 2 + (bestDx - rawDx)
    const cy = (proposed.minY + proposed.maxY) / 2 + (bestDy - rawDy)
    // proposed already includes raw; adjust best so center lands on grid
    const adjCx = (proposed.minX + proposed.maxX) / 2 + (bestDx - rawDx)
    const adjCy = (proposed.minY + proposed.maxY) / 2 + (bestDy - rawDy)
    void cx
    void cy
    const gx = Math.round(adjCx / g) * g
    const gy = Math.round(adjCy / g) * g
    if (Math.abs(gx - adjCx) <= tol) bestDx += gx - adjCx
    if (Math.abs(gy - adjCy) <= tol) bestDy += gy - adjCy
  }

  // Build guides from final snapped AABB vs targets
  const finalBox: AABB = {
    minX: proposed.minX + (bestDx - rawDx),
    minY: proposed.minY + (bestDy - rawDy),
    maxX: proposed.maxX + (bestDx - rawDx),
    maxY: proposed.maxY + (bestDy - rawDy),
  }
  const finalEdges = aabbEdges(finalBox)
  const showDist = options.showDistances !== false

  if (options.alignEnabled !== false) {
    for (const e of others) {
      if (e.style.visible === false) continue
      const box = worldMatrixOf ? entityWorldBounds(e, worldMatrixOf(e)) : entityWorldBounds(e)
      if (!Number.isFinite(box.minX) || box.minX > box.maxX) continue
      const tgt = aabbEdges(box)
      for (const sx of finalEdges.x) {
        for (const tx of tgt.x) {
          if (Math.abs(sx - tx) <= 1e-6) {
            const spanMin = Math.min(finalBox.minY, box.minY)
            const spanMax = Math.max(finalBox.maxY, box.maxY)
            const gap =
              finalBox.minY > box.maxY
                ? finalBox.minY - box.maxY
                : box.minY > finalBox.maxY
                  ? box.minY - finalBox.maxY
                  : 0
            guides.push({
              axis: 'x',
              position: sx,
              spanMin,
              spanMax,
              distance: showDist && gap > 1e-6 ? gap : undefined,
              labelAt:
                showDist && gap > 1e-6
                  ? worldPoint(sx, (Math.min(finalBox.maxY, box.maxY) + Math.max(finalBox.minY, box.minY)) / 2)
                  : undefined,
            })
          }
        }
      }
      for (const sy of finalEdges.y) {
        for (const ty of tgt.y) {
          if (Math.abs(sy - ty) <= 1e-6) {
            const spanMin = Math.min(finalBox.minX, box.minX)
            const spanMax = Math.max(finalBox.maxX, box.maxX)
            const gap =
              finalBox.minX > box.maxX
                ? finalBox.minX - box.maxX
                : box.minX > finalBox.maxX
                  ? box.minX - finalBox.maxX
                  : 0
            guides.push({
              axis: 'y',
              position: sy,
              spanMin,
              spanMax,
              distance: showDist && gap > 1e-6 ? gap : undefined,
              labelAt:
                showDist && gap > 1e-6
                  ? worldPoint((Math.min(finalBox.maxX, box.maxX) + Math.max(finalBox.minX, box.minX)) / 2, sy)
                  : undefined,
            })
          }
        }
      }
    }
  }

  return { dx: bestDx, dy: bestDy, guides: dedupeAlignGuides(guides) }
}

/**
 * Keep one guide per unique (axis, position) so X and Y can show together
 * when both axes snap, without stacking duplicates from many neighbors.
 * Spans are merged; distance labels prefer the smallest positive gap.
 */
function dedupeAlignGuides(guides: readonly AlignGuide[]): AlignGuide[] {
  if (guides.length === 0) return []
  const buckets = new Map<string, AlignGuide>()
  for (const g of guides) {
    const key = `${g.axis}:${g.position.toFixed(6)}`
    const prev = buckets.get(key)
    if (!prev) {
      buckets.set(key, { ...g })
      continue
    }
    prev.spanMin = Math.min(prev.spanMin, g.spanMin)
    prev.spanMax = Math.max(prev.spanMax, g.spanMax)
    const prevDist = prev.distance != null && prev.distance > 1e-6 ? prev.distance : Infinity
    const nextDist = g.distance != null && g.distance > 1e-6 ? g.distance : Infinity
    if (nextDist < prevDist) {
      prev.distance = g.distance
      prev.labelAt = g.labelAt
    }
  }
  const picked = [...buckets.values()]
  // Stable draw order: vertical (x) then horizontal (y), left→right / top→bottom.
  picked.sort((a, b) => {
    if (a.axis !== b.axis) return a.axis === 'x' ? -1 : 1
    return a.position - b.position
  })
  return picked
}

export function excludeIds(entities: readonly Entity[], ids: ReadonlySet<EntityId>): Entity[] {
  return entities.filter((e) => !ids.has(e.id) && e.type !== 'group')
}
