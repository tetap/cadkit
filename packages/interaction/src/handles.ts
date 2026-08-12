import type { Entity, EntityId, ScreenPoint, Vec2, WorldPoint } from '@cadkit/types'
import {
  IDENTITY,
  arcTextLocalBounds,
  arcTextStringMidpoint,
  invert,
  resolveWorldMatrix,
  pointsAABB,
  rectCornerHandleLocal,
  starCenter,
  starConstructionRadius,
  starCornerHandleX,
  starTipsHandleLocal,
  transformPoint,
  type RectCornerId,
  type Camera2D,
  type EntityLookup,
  type Matrix3,
} from '@cadkit/geometry'

export type ScaleCorner = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface ControlHandle {
  id: string
  entityId: EntityId
  kind: 'endpoint' | 'center' | 'radius' | 'scale' | 'rotate' | 'dimension-text' | 'angle'
  world: WorldPoint
  cursor: string
  /** Present when kind === 'scale' */
  scaleCorner?: ScaleCorner
  /** Optional visual variant for the DOM handle overlay. */
  appearance?:
    | 'default'
    | 'arc-radius'
    | 'arc-center'
    | 'arc-angle'
    | 'corner-radius'
    | 'star-tips'
    | 'shape-param'
  /** Companion path-circle guide for arc / circle (world space). */
  arcGuide?: { center: WorldPoint; rim: WorldPoint }
  /** Path-edit: vertex is in the active point selection. */
  selected?: boolean
  /** Figma-style badge next to the handle (e.g. "Arc", "Sweep 75%"). */
  label?: string
}

/** Absolute CCW sweep from start→end in (0, 2π]. */
export function absoluteSweep(start: number, end: number): number {
  let s = end - start
  while (s <= 0) s += Math.PI * 2
  while (s > Math.PI * 2) s -= Math.PI * 2
  return s
}

export function isFullEllipseSweep(start: number, end: number): boolean {
  return absoluteSweep(start, end) >= Math.PI * 2 - 1e-3
}

function formatSweepLabel(start: number, end: number): string {
  const pct = (absoluteSweep(start, end) / (Math.PI * 2)) * 100
  const rounded = Math.round(pct * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `Sweep ${text}%`
}

function formatStartLabel(start: number): string {
  let deg = (start * 180) / Math.PI
  // Keep label in (-180, 180] for readability.
  while (deg <= -180) deg += 360
  while (deg > 180) deg -= 360
  const rounded = Math.round(deg * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `Start ${text}°`
}

function ellipseRim(cx: number, cy: number, rx: number, ry: number, rot: number, a: number): Vec2 {
  const lx = rx * Math.cos(a)
  const ly = ry * Math.sin(a)
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c }
}

export type HandleActionHandler = (
  handle: ControlHandle,
  world: WorldPoint,
  phase: 'start' | 'move' | 'end',
) => void

function toWorldPoint(m: Matrix3, p: Vec2): WorldPoint {
  const w = transformPoint(m, p)
  return { x: w.x, y: w.y, __space: 'world' }
}

/** Map a world point into the entity's local geometry space (inverse of resolveWorldMatrix). */
export function worldToEntityLocal(
  entity: Entity,
  world: Vec2,
  lookup?: EntityLookup,
): Vec2 {
  if (!lookup) return { x: world.x, y: world.y }
  const m = resolveWorldMatrix(entity, lookup)
  const inv = invert(m)
  if (!inv) return { x: world.x, y: world.y }
  return transformPoint(inv, world)
}

function rimPoint(center: Vec2, radius: number, angle: number): Vec2 {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  }
}

/**
 * Build edit handles for an entity.
 * When `lookup` is provided, handle positions are transformed through the parent
 * group chain so nested children appear at their on-canvas world locations.
 */
export function buildsHandlesForEntity(
  entity: Entity,
  camera: Camera2D,
  lookup?: EntityLookup,
): ControlHandle[] {
  const m = lookup ? resolveWorldMatrix(entity, lookup) : IDENTITY
  const handles: ControlHandle[] = []
  if (entity.type === 'line') {
    handles.push(
      {
        id: `${entity.id}:start`,
        entityId: entity.id,
        kind: 'endpoint',
        world: toWorldPoint(m, entity.start),
        cursor: 'move',
      },
      {
        id: `${entity.id}:end`,
        entityId: entity.id,
        kind: 'endpoint',
        world: toWorldPoint(m, entity.end),
        cursor: 'move',
      },
    )
  } else if (entity.type === 'circle') {
    // Figma-like: full circle exposes a single Arc opener on the east rim.
    const arcGuide = {
      center: toWorldPoint(m, entity.center),
      rim: toWorldPoint(m, rimPoint(entity.center, entity.radius, 0)),
    }
    handles.push({
      id: `${entity.id}:arc-open`,
      entityId: entity.id,
      kind: 'angle',
      world: toWorldPoint(m, rimPoint(entity.center, entity.radius, 0)),
      cursor: 'crosshair',
      appearance: 'shape-param',
      label: 'Arc',
      arcGuide,
    })
  } else if (entity.type === 'arc') {
    const arcGuide = {
      center: toWorldPoint(m, entity.center),
      rim: toWorldPoint(m, rimPoint(entity.center, entity.radius, entity.startAngle)),
    }
    handles.push({
      id: `${entity.id}:center`,
      entityId: entity.id,
      kind: 'center',
      world: toWorldPoint(m, entity.center),
      cursor: 'move',
      appearance: 'shape-param',
      arcGuide,
    })
    handles.push({
      id: `${entity.id}:arc-start`,
      entityId: entity.id,
      kind: 'angle',
      world: toWorldPoint(m, rimPoint(entity.center, entity.radius, entity.startAngle)),
      cursor: 'crosshair',
      appearance: 'shape-param',
      label: formatStartLabel(entity.startAngle),
      arcGuide,
    })
    handles.push({
      id: `${entity.id}:arc-sweep`,
      entityId: entity.id,
      kind: 'angle',
      world: toWorldPoint(m, rimPoint(entity.center, entity.radius, entity.endAngle)),
      cursor: 'crosshair',
      appearance: 'shape-param',
      label: formatSweepLabel(entity.startAngle, entity.endAngle),
      arcGuide,
    })
  } else if (entity.type === 'ellipse') {
    const full = isFullEllipseSweep(entity.startAngle, entity.endAngle)
    if (full) {
      handles.push({
        id: `${entity.id}:arc-open`,
        entityId: entity.id,
        kind: 'angle',
        world: toWorldPoint(
          m,
          ellipseRim(
            entity.center.x,
            entity.center.y,
            entity.radiusX,
            entity.radiusY,
            entity.rotation,
            0,
          ),
        ),
        cursor: 'crosshair',
        appearance: 'shape-param',
        label: 'Arc',
      })
    } else {
      handles.push({
        id: `${entity.id}:center`,
        entityId: entity.id,
        kind: 'center',
        world: toWorldPoint(m, entity.center),
        cursor: 'move',
        appearance: 'shape-param',
      })
      handles.push({
        id: `${entity.id}:arc-start`,
        entityId: entity.id,
        kind: 'angle',
        world: toWorldPoint(
          m,
          ellipseRim(
            entity.center.x,
            entity.center.y,
            entity.radiusX,
            entity.radiusY,
            entity.rotation,
            entity.startAngle,
          ),
        ),
        cursor: 'crosshair',
        appearance: 'shape-param',
        label: formatStartLabel(entity.startAngle),
      })
      handles.push({
        id: `${entity.id}:arc-sweep`,
        entityId: entity.id,
        kind: 'angle',
        world: toWorldPoint(
          m,
          ellipseRim(
            entity.center.x,
            entity.center.y,
            entity.radiusX,
            entity.radiusY,
            entity.rotation,
            entity.endAngle,
          ),
        ),
        cursor: 'crosshair',
        appearance: 'shape-param',
        label: formatSweepLabel(entity.startAngle, entity.endAngle),
      })
    }
  } else if (entity.type === 'polyline') {
    const shape = entity.shape
    if (shape?.kind === 'rect' && entity.closed) {
      const box = pointsAABB(entity.points)
      const radii = shape.cornerRadii
      const perCorner: Record<RectCornerId, number> =
        typeof radii === 'number' || radii == null
          ? {
              tl: Math.max(0, typeof radii === 'number' ? radii : 0),
              tr: Math.max(0, typeof radii === 'number' ? radii : 0),
              br: Math.max(0, typeof radii === 'number' ? radii : 0),
              bl: Math.max(0, typeof radii === 'number' ? radii : 0),
            }
          : {
              tl: Math.max(0, radii[0] ?? 0),
              tr: Math.max(0, radii[1] ?? 0),
              br: Math.max(0, radii[2] ?? 0),
              bl: Math.max(0, radii[3] ?? 0),
            }
      // Keep a visible pad when radius is 0 so the control clears scale corners.
      const minPad = 10 / Math.max(camera.getState().zoom, 1e-9)
      const ids: RectCornerId[] = ['tl', 'tr', 'br', 'bl']
      for (const id of ids) {
        handles.push({
          id: `${entity.id}:corner:${id}`,
          entityId: entity.id,
          kind: 'radius',
          world: toWorldPoint(m, rectCornerHandleLocal(box, id, perCorner[id], minPad)),
          cursor: 'nwse-resize',
          appearance: 'corner-radius',
        })
      }
    } else if (shape?.kind === 'star' && entity.closed) {
      const { cx, cy } = starCenter(entity.points)
      const tips = shape.points ?? 5
      const corner =
        typeof shape.cornerRadii === 'number' ? shape.cornerRadii : (shape.cornerRadii?.[0] ?? 0)
      const outerR = starConstructionRadius(entity.points, cx, cy, tips, corner)
      const pad = 12 / Math.max(camera.getState().zoom, 1e-9)
      handles.push({
        id: `${entity.id}:star-tips`,
        entityId: entity.id,
        kind: 'angle',
        world: toWorldPoint(m, starTipsHandleLocal(cx, cy, outerR, pad)),
        cursor: 'ns-resize',
        appearance: 'star-tips',
      })
      handles.push({
        id: `${entity.id}:star-corner`,
        entityId: entity.id,
        kind: 'radius',
        world: toWorldPoint(m, {
          x: starCornerHandleX(cx, outerR, corner),
          y: cy,
        }),
        cursor: 'ew-resize',
        appearance: 'corner-radius',
      })
    } else {
      entity.points.forEach((p, i) => {
        handles.push({
          id: `${entity.id}:${i}`,
          entityId: entity.id,
          kind: 'endpoint',
          world: toWorldPoint(m, p),
          cursor: 'move',
        })
      })
      entity.holes?.forEach((hole, hi) => {
        hole.forEach((p, i) => {
          handles.push({
            id: `${entity.id}:h${hi}:${i}`,
            entityId: entity.id,
            kind: 'endpoint',
            world: toWorldPoint(m, p),
            cursor: 'move',
          })
        })
      })
    }
  } else if (entity.type === 'text' && entity.path?.kind === 'arc') {
    const fontSize = Math.max(1e-6, entity.fontSize)
    const baseline = entity.path.baseline ?? 'outer'
    const layoutR =
      baseline === 'inner'
        ? Math.max(1e-3, entity.path.radius - fontSize)
        : Math.max(1e-3, entity.path.radius)
    const box = arcTextLocalBounds(
      entity.content,
      fontSize,
      entity.position,
      entity.path,
      entity.widthFactor ?? 1,
      entity.fontFamily || 'sans-serif',
    )
    const padWorld = 22 / Math.max(camera.getState().zoom, 1e-9)
    const radiusLocal = {
      x: box.maxX + padWorld,
      y: (box.minY + box.maxY) / 2,
    }
    const arcGuide = {
      center: toWorldPoint(m, entity.position),
      rim: toWorldPoint(m, {
        x: entity.position.x + layoutR,
        y: entity.position.y,
      }),
    }
    handles.push({
      id: `${entity.id}:arc-center`,
      entityId: entity.id,
      kind: 'center',
      world: toWorldPoint(m, entity.position),
      cursor: 'move',
      appearance: 'arc-center',
      arcGuide,
    })
    const mid = arcTextStringMidpoint(entity)
    if (mid) {
      handles.push({
        id: `${entity.id}:arc-angle`,
        entityId: entity.id,
        kind: 'angle',
        world: toWorldPoint(m, mid),
        cursor: 'grab',
        appearance: 'arc-angle',
      })
    }
    handles.push({
      id: `${entity.id}:arc-radius`,
      entityId: entity.id,
      kind: 'radius',
      world: toWorldPoint(m, radiusLocal),
      cursor: 'ew-resize',
      appearance: 'arc-radius',
    })
  }
  return handles
}

export function hitTestHandle(
  handles: ControlHandle[],
  screen: ScreenPoint,
  camera: Camera2D,
  pixelTol = 8,
): ControlHandle | null {
  let best: ControlHandle | null = null
  let bestDist = pixelTol
  for (const h of handles) {
    const s = camera.worldToScreen(h.world)
    const d = Math.hypot(s.x - screen.x, s.y - screen.y)
    if (d <= bestDist) {
      best = h
      bestDist = d
    }
  }
  return best
}
