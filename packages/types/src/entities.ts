import type { BlockId, EntityId, GroupId, LayerId } from './ids.js'
import type { Vec2 } from './coordinates.js'

export type EntityType =
  | 'line'
  | 'polyline'
  | 'arc'
  | 'circle'
  | 'ellipse'
  | 'bezier'
  | 'nurbs'
  | 'path'
  | 'hatch'
  | 'image'
  | 'text'
  | 'dimension'
  | 'blockDefinition'
  | 'blockInstance'
  | 'group'

export interface EntityStyle {
  stroke?: string
  strokeWidth?: number
  fill?: string
  opacity?: number
  lineType?: string
  visible?: boolean
  locked?: boolean
}

export interface EntityBase {
  id: EntityId
  type: EntityType
  layerId: LayerId
  parentId?: GroupId | EntityId
  style: EntityStyle
  /** Affine transform: [a, b, c, d, e, f] local → parent/world */
  transform: readonly [number, number, number, number, number, number]
  version: number
}

export interface LineEntity extends EntityBase {
  type: 'line'
  start: Vec2
  end: Vec2
}

export interface PolylineEntity extends EntityBase {
  type: 'polyline'
  points: Vec2[]
  closed: boolean
}

export interface ArcEntity extends EntityBase {
  type: 'arc'
  center: Vec2
  radius: number
  startAngle: number
  endAngle: number
}

export interface CircleEntity extends EntityBase {
  type: 'circle'
  center: Vec2
  radius: number
}

export interface EllipseEntity extends EntityBase {
  type: 'ellipse'
  center: Vec2
  radiusX: number
  radiusY: number
  rotation: number
  startAngle: number
  endAngle: number
}

/**
 * Cubic Bezier path.
 * `points` are packed as chained cubics: [p0, c1, c2, p1, c1', c2', p2, ...]
 * (length = 3k + 1). Straight segments use collinear control points.
 */
export interface BezierEntity extends EntityBase {
  type: 'bezier'
  points: Vec2[]
  closed?: boolean
}

export interface NurbsEntity extends EntityBase {
  type: 'nurbs'
  degree: number
  controlPoints: Vec2[]
  knots: number[]
  weights?: number[]
}

export interface PathEntity extends EntityBase {
  type: 'path'
  d: string
}

export interface HatchEntity extends EntityBase {
  type: 'hatch'
  boundaryIds: EntityId[]
  pattern?: string
}

export interface ImageFilterOp {
  id: string
  type: string
  params: Record<string, number>
  wgslBody?: string
}

export interface ImageEntity extends EntityBase {
  type: 'image'
  /** Stable asset registry id (preferred over ephemeral blob URLs). */
  assetId?: string
  /** Original / export href (file name, URL, or data URL). */
  href: string
  /** Natural pixel size of the source bitmap. */
  naturalWidth?: number
  naturalHeight?: number
  /** World-space size. */
  width: number
  height: number
  origin: Vec2
  preserveAspectRatio?: boolean
  /** Ordered filter stack (builtin + custom WGSL). */
  filters?: ImageFilterOp[]
}

/** Arc layout for text: `position` is the circle center. */
export interface TextArcPath {
  kind: 'arc'
  radius: number
  /** Radians; layout starts at this angle from +X. */
  startAngle: number
  /** Signed sweep in radians (+CCW / -CW). */
  sweep: number
  /** Baseline on the outer or inner side of the arc. */
  baseline?: 'outer' | 'inner'
}

export interface TextEntity extends EntityBase {
  type: 'text'
  content: string
  /** Em-box bottom of the first line for straight text; circle center when `path.kind === 'arc'`. */
  position: Vec2
  fontFamily: string
  fontSize: number
  widthFactor?: number
  rotation?: number
  align?: 'left' | 'center' | 'right'
  /** When set, glyphs are laid out along a curve (arc in v1). */
  path?: TextArcPath
}

export interface DimensionEntity extends EntityBase {
  type: 'dimension'
  start: Vec2
  end: Vec2
  offset: number
  text?: string
}

export interface BlockDefinitionEntity extends EntityBase {
  type: 'blockDefinition'
  blockId: BlockId
  name: string
  children: EntityId[]
  basePoint: Vec2
}

export interface BlockInstanceEntity extends EntityBase {
  type: 'blockInstance'
  blockId: BlockId
  insertion: Vec2
  scale: Vec2
  rotation: number
}

export interface GroupEntity extends EntityBase {
  type: 'group'
  groupId: GroupId
  children: EntityId[]
  clip?: boolean
}

export type Entity =
  | LineEntity
  | PolylineEntity
  | ArcEntity
  | CircleEntity
  | EllipseEntity
  | BezierEntity
  | NurbsEntity
  | PathEntity
  | HatchEntity
  | ImageEntity
  | TextEntity
  | DimensionEntity
  | BlockDefinitionEntity
  | BlockInstanceEntity
  | GroupEntity

export const IDENTITY_TRANSFORM = [1, 0, 0, 1, 0, 0] as const
