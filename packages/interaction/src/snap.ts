import type { Entity, Vec2, WorldPoint } from '@cadkit/types'
import { worldPoint } from '@cadkit/types'
import { closestPointOnSegment, distancePointToPoint } from '@cadkit/geometry'

export type SnapType =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'quadrant'
  | 'nearest'
  | 'intersection'
  | 'tangent'
  | 'perpendicular'
  | 'grid'

export interface SnapCandidate {
  type: SnapType
  point: WorldPoint
  distance: number
  priority: number
  entityId?: string
}

const PRIORITY: Record<SnapType, number> = {
  endpoint: 100,
  intersection: 95,
  midpoint: 80,
  center: 75,
  quadrant: 70,
  perpendicular: 60,
  tangent: 55,
  nearest: 40,
  grid: 20,
}

export interface SnapOptions {
  enabled: boolean
  pixelTolerance: number
  worldPerPixel: number
  gridSize?: number
  ortho?: boolean
  /** Element AABB alignment while dragging selection */
  alignEnabled?: boolean
  /** Show spacing labels on align guides */
  showDistances?: boolean
  /** Rotate snap step in degrees (0 = off) */
  angleStepDeg?: number
  /** Pan inertia damping coefficient (1/s) */
  panDamping?: number
}

export function collectSnaps(entities: Entity[], cursor: WorldPoint, options: SnapOptions): SnapCandidate[] {
  if (!options.enabled) return []
  const tol = options.pixelTolerance * options.worldPerPixel
  const out: SnapCandidate[] = []

  for (const entity of entities) {
    if (entity.type === 'line') {
      push(out, 'endpoint', entity.start, cursor, tol, entity.id)
      push(out, 'endpoint', entity.end, cursor, tol, entity.id)
      push(
        out,
        'midpoint',
        { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 },
        cursor,
        tol,
        entity.id,
      )
      const nearest = closestPointOnSegment(cursor, entity.start, entity.end)
      push(out, 'nearest', nearest, cursor, tol, entity.id)
    } else if (entity.type === 'circle' || entity.type === 'arc') {
      push(out, 'center', entity.center, cursor, tol, entity.id)
      for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        push(
          out,
          'quadrant',
          {
            x: entity.center.x + entity.radius * Math.cos(a),
            y: entity.center.y + entity.radius * Math.sin(a),
          },
          cursor,
          tol,
          entity.id,
        )
      }
    }
  }

  if (options.gridSize && options.gridSize > 0) {
    const g = options.gridSize
    const gx = Math.round(cursor.x / g) * g
    const gy = Math.round(cursor.y / g) * g
    push(out, 'grid', { x: gx, y: gy }, cursor, tol)
  }

  out.sort((a, b) => b.priority - a.priority || a.distance - b.distance)
  return out
}

export function bestSnap(candidates: SnapCandidate[]): SnapCandidate | null {
  return candidates[0] ?? null
}

export function applyOrtho(origin: Vec2, target: Vec2): Vec2 {
  const dx = Math.abs(target.x - origin.x)
  const dy = Math.abs(target.y - origin.y)
  if (dx > dy) return { x: target.x, y: origin.y }
  return { x: origin.x, y: target.y }
}

function push(
  out: SnapCandidate[],
  type: SnapType,
  point: Vec2,
  cursor: WorldPoint,
  tol: number,
  entityId?: string,
): void {
  const distance = distancePointToPoint(point, cursor)
  if (distance <= tol) {
    out.push({
      type,
      point: worldPoint(point.x, point.y),
      distance,
      priority: PRIORITY[type],
      entityId,
    })
  }
}
