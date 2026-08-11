/**
 * Vector boolean operations via Clipper2 (union / subtract / intersect / exclude).
 * Inputs: closed polyline, circle, ellipse, closed bezier (and other closed contours
 * from `entityToOffsetContours`). Results are closed world-space contours.
 */
import {
  booleanOpD,
  ClipType,
  differenceD,
  FillRule,
  intersectD,
  xorD,
  type PathD,
  type PathsD,
} from 'clipper2-ts'
import type { Entity } from '@cadkit/types'
import {
  entityToOffsetContours,
  pathsToCompoundContours,
  type OffsetContour,
} from './offset.js'
import type { EntityLookup } from './world-matrix.js'

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude'

export interface BooleanRequest {
  op: BooleanOp
  /** Entity ids of closed shapes to combine (order matters for subtract). */
  subjectIds: string[]
}

export interface BooleanOptions {
  /** Clipper decimal precision (digits after decimal). Default 4. */
  precision?: number
  /** Tessellation quality for curves / circles. */
  arcTolerance?: number
}

export function booleanOpsAvailable(): boolean {
  return true
}

function dedupeClose(points: OffsetContour['points'], eps = 1e-9): OffsetContour['points'] {
  if (points.length === 0) return []
  const out = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const prev = out[out.length - 1]!
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p)
  }
  return out
}

function toPathD(points: OffsetContour['points']): PathD {
  return points.map((p) => ({ x: p.x, y: p.y }))
}

function fromPathD(path: PathD): OffsetContour['points'] {
  return path.map((p) => ({ x: p.x, y: p.y }))
}

function contoursToPathsD(contours: readonly OffsetContour[]): PathsD {
  const paths: PathsD = []
  for (const c of contours) {
    const pts = dedupeClose(c.points)
    if (!(c.closed && pts.length >= 3)) continue
    paths.push(toPathD(pts))
    for (const hole of c.holes ?? []) {
      const hp = dedupeClose(hole)
      if (hp.length >= 3) paths.push(toPathD(hp))
    }
  }
  return paths
}

function pathsDToContours(paths: PathsD, precision: number): OffsetContour[] {
  return pathsToCompoundContours(paths, precision)
}

/** Closed world contours suitable for boolean ops (empty if entity cannot participate). */
export function entityToBooleanContours(
  entity: Entity,
  lookup: EntityLookup = () => undefined,
  opts?: { arcTolerance?: number },
): OffsetContour[] {
  if (entity.type === 'group' || entity.type === 'image' || entity.type === 'dimension') {
    return []
  }
  return entityToOffsetContours(entity, lookup, opts).filter(
    (c) => c.closed && dedupeClose(c.points).length >= 3,
  )
}

export function entitySupportsBoolean(entity: Entity, lookup?: EntityLookup): boolean {
  return entityToBooleanContours(entity, lookup).length > 0
}

/**
 * Boolean-combine contour groups. Each group is one subject's rings.
 * - union / intersect / exclude: fold left→right
 * - subtract: first group minus the union of the rest
 */
export function booleanContourGroups(
  groups: readonly (readonly OffsetContour[])[],
  op: BooleanOp,
  options?: BooleanOptions,
): OffsetContour[] {
  const precision = options?.precision ?? 4
  const pathGroups = groups.map((g) => contoursToPathsD(g)).filter((g) => g.length > 0)
  if (pathGroups.length < 2) return []

  const fill = FillRule.NonZero

  if (op === 'union') {
    const all: PathsD = pathGroups.flat()
    return pathsDToContours(booleanOpD(ClipType.Union, all, null, fill, precision), precision)
  }

  if (op === 'subtract') {
    const subject = pathGroups[0]!
    const clip = pathGroups.slice(1).flat()
    if (!clip.length) return pathsDToContours(subject, precision)
    return pathsDToContours(differenceD(subject, clip, fill, precision), precision)
  }

  let acc = pathGroups[0]!
  for (let i = 1; i < pathGroups.length; i++) {
    const clip = pathGroups[i]!
    if (op === 'intersect') acc = intersectD(acc, clip, fill, precision)
    else acc = xorD(acc, clip, fill, precision)
    if (!acc.length) return []
  }
  return pathsDToContours(acc, precision)
}

/** Convenience: entities → boolean result contours in world space. */
export function booleanEntities(
  entities: readonly Entity[],
  op: BooleanOp,
  lookup: EntityLookup = () => undefined,
  options?: BooleanOptions,
): OffsetContour[] {
  const groups = entities.map((e) =>
    entityToBooleanContours(e, lookup, { arcTolerance: options?.arcTolerance }),
  )
  return booleanContourGroups(groups, op, options)
}
