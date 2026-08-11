import type { EntityId } from '@cadkit/types'

/** Vertex on a polyline outer ring or a hole ring. */
export interface PathVertexRef {
  /** `null` = outer ring; otherwise hole index in `entity.holes`. */
  holeIndex: number | null
  pointIndex: number
}

export function pathVertexKey(ref: PathVertexRef): string {
  return ref.holeIndex === null ? `o:${ref.pointIndex}` : `h:${ref.holeIndex}:${ref.pointIndex}`
}

export function parsePathVertexKey(key: string): PathVertexRef | null {
  const hole = /^h:(\d+):(\d+)$/.exec(key)
  if (hole) {
    return { holeIndex: Number(hole[1]), pointIndex: Number(hole[2]) }
  }
  const outer = /^o:(\d+)$/.exec(key)
  if (outer) {
    return { holeIndex: null, pointIndex: Number(outer[1]) }
  }
  return null
}

/** Parse a polyline endpoint handle id (`ent:3` or `ent:h0:2`). */
export function parsePathVertexHandleId(handleId: string): PathVertexRef | null {
  const hole = /:h(\d+):(\d+)$/.exec(handleId)
  if (hole) {
    return { holeIndex: Number(hole[1]), pointIndex: Number(hole[2]) }
  }
  // Outer: trailing `:N` but not `:hN:…` (already handled) or named suffixes.
  const outer = /:(\d+)$/.exec(handleId)
  if (!outer) return null
  return { holeIndex: null, pointIndex: Number(outer[1]) }
}

export function polylineVertexHandleId(entityId: EntityId, ref: PathVertexRef): string {
  return ref.holeIndex === null
    ? `${entityId}:${ref.pointIndex}`
    : `${entityId}:h${ref.holeIndex}:${ref.pointIndex}`
}

export function comparePathVertexRef(a: PathVertexRef, b: PathVertexRef): number {
  const ah = a.holeIndex === null ? -1 : a.holeIndex
  const bh = b.holeIndex === null ? -1 : b.holeIndex
  if (ah !== bh) return ah - bh
  return a.pointIndex - b.pointIndex
}
