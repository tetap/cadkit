/**
 * Vector boolean operations (union / subtract / intersect / exclude).
 *
 * Planned for a later phase — not implemented in this release.
 * Intended inputs: closed polyline / rectangle / ellipse / circle
 * (tessellated to polygons). Result: path or closed polyline, undoable.
 *
 * @see plan: editor interaction fixes — boolean-later
 */
export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude'

export interface BooleanRequest {
  op: BooleanOp
  /** Entity ids of closed shapes to combine (order matters for subtract). */
  subjectIds: string[]
}

/** Placeholder API surface for future boolean engine wiring. */
export function booleanOpsAvailable(): boolean {
  return false
}
