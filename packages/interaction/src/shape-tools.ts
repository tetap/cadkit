import { layerFillFromStroke } from '@cadkit/document'
import {
  buildHeartPath,
  buildStarPath,
  boxFromCorners,
  invert,
  resolveWorldMatrix,
  transformPoint,
} from '@cadkit/geometry'
import {
  IDENTITY_TRANSFORM,
  createEntityId,
  worldPoint,
  type Entity,
  type EntityId,
  type EntityStyle,
  type ScreenPoint,
  type WorldPoint,
} from '@cadkit/types'
import { pickEntity } from './pick.js'
import { applyOrtho, bestSnap, collectSnaps } from './snap.js'
import type { Tool, ToolContext, ToolName } from './tools.js'

function activeLayerStyle(ctx: ToolContext, opts?: { fill?: boolean; text?: boolean }): EntityStyle {
  const layer = ctx.doc.getLayer(ctx.doc.getDefaultLayerId())
  const stroke = layer?.color ?? (opts?.text ? '#111827' : '#32cd79')
  if (opts?.text) return { stroke, fill: stroke }
  if (opts?.fill) return { stroke, strokeWidth: 1, fill: layerFillFromStroke(stroke) }
  return { stroke, strokeWidth: 1 }
}

/** Pen-tool anchor while drawing (Illustrator / Figma style). */
export interface PenAnchorPreview {
  point: WorldPoint
  handleIn: WorldPoint | null
  handleOut: WorldPoint | null
}

export type PreviewPrimitive =
  | { kind: 'line'; a: WorldPoint; b: WorldPoint }
  | { kind: 'rect'; minX: number; minY: number; maxX: number; maxY: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'polyline'; points: WorldPoint[]; closed?: boolean }
  /** One or more world-space polylines (e.g. offset preview). */
  | { kind: 'paths'; paths: Array<{ points: WorldPoint[]; closed?: boolean }> }
  /** Vector pen: anchors + optional rubber-band / live handle drag. */
  | {
      kind: 'pen'
      anchors: PenAnchorPreview[]
      /** Anchor currently under the pointer (pointer-down, not yet committed). */
      placing?: PenAnchorPreview
      cursor?: WorldPoint
      closedHint?: boolean
    }
  | { kind: 'none' }

export type PreviewEmitter = (preview: PreviewPrimitive) => void

function snapWorld(ctx: ToolContext, world: WorldPoint): WorldPoint {
  const candidates = collectSnaps(ctx.doc.getEntities(), world, {
    ...ctx.snap,
    worldPerPixel: 1 / Math.max(ctx.camera.getState().zoom, 1e-9),
  })
  return bestSnap(candidates)?.point ?? world
}

function commitEntity(ctx: ToolContext, entity: Entity): void {
  if (ctx.addEntity) ctx.addEntity(entity)
  else ctx.commitChange?.(ctx.doc.add(entity))
  ctx.selection.set([entity.id])
  ctx.onEntityCreated?.(entity.id)
  ctx.onSelectionEdited?.()
}

/** Shared drag-to-create shape behaviour. */
export abstract class DragShapeTool implements Tool {
  abstract readonly name: ToolName
  protected origin: WorldPoint | null = null
  protected current: WorldPoint | null = null

  onPointerDown(_s: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0) return
    this.origin = snapWorld(ctx, world)
    this.current = this.origin
    ctx.onPreview?.(this.buildPreview(this.origin, this.current, ctx))
  }

  onPointerMove(_s: ScreenPoint, world: WorldPoint, ctx: ToolContext): void {
    if (!this.origin) return
    let cur = snapWorld(ctx, world)
    if (ctx.shiftKey) cur = this.applyConstraint(this.origin, cur)
    if (ctx.ortho) cur = { ...applyOrtho(this.origin, cur), __space: 'world' }
    this.current = cur
    ctx.onPreview?.(this.buildPreview(this.origin, cur, ctx))
  }

  onPointerUp(_s: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0 || !this.origin) return
    let end = snapWorld(ctx, world)
    if (ctx.shiftKey) end = this.applyConstraint(this.origin, end)
    if (ctx.ortho) end = { ...applyOrtho(this.origin, end), __space: 'world' }
    const entity = this.createEntity(this.origin, end, ctx)
    this.origin = null
    this.current = null
    ctx.onPreview?.({ kind: 'none' })
    if (entity) commitEntity(ctx, entity)
  }

  onKeyDown(key: string, ctx: ToolContext): void {
    if (key === 'Escape') {
      this.cancel(ctx)
    }
  }

  cancel(ctx: ToolContext): void {
    this.origin = null
    this.current = null
    ctx.onPreview?.({ kind: 'none' })
  }

  protected applyConstraint(origin: WorldPoint, cur: WorldPoint): WorldPoint {
    const dx = cur.x - origin.x
    const dy = cur.y - origin.y
    const s = Math.max(Math.abs(dx), Math.abs(dy))
    return {
      x: origin.x + Math.sign(dx || 1) * s,
      y: origin.y + Math.sign(dy || 1) * s,
      __space: 'world',
    }
  }

  protected abstract buildPreview(a: WorldPoint, b: WorldPoint, ctx: ToolContext): PreviewPrimitive
  protected abstract createEntity(a: WorldPoint, b: WorldPoint, ctx: ToolContext): Entity | null
}

export class RectangleTool extends DragShapeTool {
  readonly name = 'rectangle' as const

  protected buildPreview(a: WorldPoint, b: WorldPoint): PreviewPrimitive {
    return {
      kind: 'rect',
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    }
  }

  protected createEntity(a: WorldPoint, b: WorldPoint, ctx: ToolContext): Entity | null {
    const minX = Math.min(a.x, b.x)
    const minY = Math.min(a.y, b.y)
    const maxX = Math.max(a.x, b.x)
    const maxY = Math.max(a.y, b.y)
    if (Math.hypot(maxX - minX, maxY - minY) < 1e-6) return null
    return {
      id: createEntityId('polyline'),
      type: 'polyline',
      layerId: ctx.doc.getDefaultLayerId(),
      style: activeLayerStyle(ctx, { fill: true }),
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      closed: true,
      shape: { kind: 'rect', cornerRadii: 0 },
    }
  }
}

export class HeartTool extends DragShapeTool {
  readonly name = 'heart' as const

  protected buildPreview(a: WorldPoint, b: WorldPoint): PreviewPrimitive {
    const box = boxFromCorners(a, b)
    return {
      kind: 'polyline',
      points: buildHeartPath(box.minX, box.minY, box.maxX, box.maxY).map((p) =>
        worldPoint(p.x, p.y),
      ),
      closed: true,
    }
  }

  protected createEntity(a: WorldPoint, b: WorldPoint, ctx: ToolContext): Entity | null {
    const box = boxFromCorners(a, b)
    if (box.w < 1e-6 || box.h < 1e-6) return null
    const points = buildHeartPath(box.minX, box.minY, box.maxX, box.maxY)
    return {
      id: createEntityId('polyline'),
      type: 'polyline',
      layerId: ctx.doc.getDefaultLayerId(),
      style: activeLayerStyle(ctx, { fill: true }),
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points,
      closed: true,
      shape: { kind: 'heart', cornerRadii: 0 },
    }
  }
}

export class StarTool extends DragShapeTool {
  readonly name = 'star' as const

  protected buildPreview(a: WorldPoint, b: WorldPoint): PreviewPrimitive {
    const box = boxFromCorners(a, b)
    const r = Math.min(box.w, box.h) / 2
    return {
      kind: 'polyline',
      points: buildStarPath(box.cx, box.cy, r, 5).map((p) => worldPoint(p.x, p.y)),
      closed: true,
    }
  }

  protected createEntity(a: WorldPoint, b: WorldPoint, ctx: ToolContext): Entity | null {
    const box = boxFromCorners(a, b)
    const r = Math.min(box.w, box.h) / 2
    if (r < 1e-6) return null
    return {
      id: createEntityId('polyline'),
      type: 'polyline',
      layerId: ctx.doc.getDefaultLayerId(),
      style: activeLayerStyle(ctx, { fill: true }),
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: buildStarPath(box.cx, box.cy, r, 5),
      closed: true,
      shape: { kind: 'star', points: 5, cornerRadii: 0 },
    }
  }
}

export class EllipseTool extends DragShapeTool {
  readonly name = 'ellipse' as const

  protected buildPreview(a: WorldPoint, b: WorldPoint): PreviewPrimitive {
    return {
      kind: 'ellipse',
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      rx: Math.abs(b.x - a.x) / 2,
      ry: Math.abs(b.y - a.y) / 2,
    }
  }

  protected createEntity(a: WorldPoint, b: WorldPoint, ctx: ToolContext): Entity | null {
    const rx = Math.abs(b.x - a.x) / 2
    const ry = Math.abs(b.y - a.y) / 2
    if (rx < 1e-6 || ry < 1e-6) return null
    return {
      id: createEntityId('ellipse'),
      type: 'ellipse',
      layerId: ctx.doc.getDefaultLayerId(),
      style: activeLayerStyle(ctx, { fill: true }),
      transform: IDENTITY_TRANSFORM,
      version: 1,
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      radiusX: rx,
      radiusY: ry,
      rotation: 0,
      startAngle: 0,
      endAngle: Math.PI * 2,
    }
  }
}

export class CircleTool extends DragShapeTool {
  readonly name = 'circle' as const

  protected applyConstraint(origin: WorldPoint, cur: WorldPoint): WorldPoint {
    return cur
  }

  protected buildPreview(a: WorldPoint, b: WorldPoint): PreviewPrimitive {
    const r = Math.hypot(b.x - a.x, b.y - a.y)
    return { kind: 'ellipse', cx: a.x, cy: a.y, rx: r, ry: r }
  }

  protected createEntity(a: WorldPoint, b: WorldPoint, ctx: ToolContext): Entity | null {
    const r = Math.hypot(b.x - a.x, b.y - a.y)
    if (r < 1e-6) return null
    return {
      id: createEntityId('circle'),
      type: 'circle',
      layerId: ctx.doc.getDefaultLayerId(),
      style: activeLayerStyle(ctx, { fill: true }),
      transform: IDENTITY_TRANSFORM,
      version: 1,
      center: { x: a.x, y: a.y },
      radius: r,
    }
  }
}

export class PolylineTool implements Tool {
  readonly name = 'polyline' as const
  private points: WorldPoint[] = []

  onPointerDown(screen: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0) return
    const p = snapWorld(ctx, world)
    // Close by clicking near the first point (same gesture as PenTool).
    if (this.points.length >= 3) {
      const s0 = ctx.camera.worldToScreen(this.points[0]!)
      if (Math.hypot(s0.x - screen.x, s0.y - screen.y) <= 10) {
        this.commit(ctx, true)
        return
      }
    }
    this.points.push(p)
    ctx.onPreview?.({ kind: 'polyline', points: [...this.points], closed: false })
  }

  onPointerMove(screen: ScreenPoint, world: WorldPoint, ctx: ToolContext): void {
    if (!this.points.length) return
    const p = snapWorld(ctx, world)
    const closedHint =
      this.points.length >= 3 &&
      (() => {
        const s0 = ctx.camera.worldToScreen(this.points[0]!)
        return Math.hypot(s0.x - screen.x, s0.y - screen.y) <= 10
      })()
    ctx.onPreview?.({
      kind: 'polyline',
      points: closedHint ? [...this.points] : [...this.points, p],
      closed: closedHint,
    })
  }

  onDoubleClick(_s: ScreenPoint, _w: WorldPoint, ctx: ToolContext): void {
    this.commit(ctx, false)
  }

  onKeyDown(key: string, ctx: ToolContext): void {
    if (key === 'Enter') this.commit(ctx, false)
    else if (key === 'Escape') this.cancel(ctx)
  }

  cancel(ctx: ToolContext): void {
    this.points = []
    ctx.onPreview?.({ kind: 'none' })
  }

  private commit(ctx: ToolContext, closed: boolean): void {
    if (this.points.length < 2) {
      this.cancel(ctx)
      return
    }
    const entity: Entity = {
      id: createEntityId('polyline'),
      type: 'polyline',
      layerId: ctx.doc.getDefaultLayerId(),
      style: activeLayerStyle(ctx),
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: this.points.map((p) => ({ x: p.x, y: p.y })),
      closed,
    }
    this.points = []
    ctx.onPreview?.({ kind: 'none' })
    commitEntity(ctx, entity)
  }
}

type PenAnchor = {
  point: WorldPoint
  handleIn: WorldPoint | null
  handleOut: WorldPoint | null
}

function reflect(origin: WorldPoint, tip: WorldPoint): WorldPoint {
  return worldPoint(origin.x * 2 - tip.x, origin.y * 2 - tip.y)
}

function lerpHandle(a: WorldPoint, b: WorldPoint, t: number): WorldPoint {
  return worldPoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}

/** Pack pen anchors into chained cubic control points (length 3k+1). */
export function anchorsToCubicPoints(anchors: readonly PenAnchor[], closed: boolean): WorldPoint[] {
  const n = anchors.length
  if (n < 2) return []
  const segCount = closed ? n : n - 1
  const pts: WorldPoint[] = []
  for (let i = 0; i < segCount; i++) {
    const a = anchors[i]!
    const b = anchors[(i + 1) % n]!
    const p0 = worldPoint(a.point.x, a.point.y)
    const p3 = worldPoint(b.point.x, b.point.y)
    const p1 = a.handleOut
      ? worldPoint(a.handleOut.x, a.handleOut.y)
      : lerpHandle(p0, p3, 1 / 3)
    const p2 = b.handleIn
      ? worldPoint(b.handleIn.x, b.handleIn.y)
      : lerpHandle(p0, p3, 2 / 3)
    if (i === 0) pts.push(p0, p1, p2, p3)
    else pts.push(p1, p2, p3)
  }
  return pts
}

const DEFAULT_HANDLE_EPS = 1e-4

function nearLerp(h: WorldPoint, a: WorldPoint, b: WorldPoint, t: number): boolean {
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t
  return Math.hypot(h.x - x, h.y - y) <= DEFAULT_HANDLE_EPS
}

/** Unpack chained cubics (`3k+1` points) back into pen anchors. */
export function cubicPointsToAnchors(
  points: readonly { x: number; y: number }[],
  closed: boolean,
): PenAnchor[] {
  if (points.length < 4 || (points.length - 1) % 3 !== 0) return []
  const segs = (points.length - 1) / 3
  const n = closed ? segs : segs + 1
  const at = (i: number) => points[i]!
  const anchors: PenAnchor[] = []
  for (let i = 0; i < n; i++) {
    const p = at(Math.min(i * 3, points.length - 1))
    const prev = anchors[i - 1]?.point
    const nextIdx = closed ? ((i + 1) % n) * 3 : (i + 1) * 3
    const next = i + 1 < n || closed ? at(Math.min(nextIdx, points.length - 1)) : null
    let handleOut: WorldPoint | null = null
    let handleIn: WorldPoint | null = null
    if (i < segs) {
      const h = at(i * 3 + 1)
      if (next && !nearLerp(worldPoint(h.x, h.y), worldPoint(p.x, p.y), worldPoint(next.x, next.y), 1 / 3)) {
        handleOut = worldPoint(h.x, h.y)
      }
    }
    if (i > 0) {
      const h = at(i * 3 - 1)
      if (prev && !nearLerp(worldPoint(h.x, h.y), prev, worldPoint(p.x, p.y), 2 / 3)) {
        handleIn = worldPoint(h.x, h.y)
      }
    } else if (closed && segs >= 1) {
      const h = at(points.length - 2)
      const last = at((n - 1) * 3)
      if (!nearLerp(worldPoint(h.x, h.y), worldPoint(last.x, last.y), worldPoint(p.x, p.y), 2 / 3)) {
        handleIn = worldPoint(h.x, h.y)
      }
    }
    anchors.push({
      point: worldPoint(p.x, p.y),
      handleIn,
      handleOut,
    })
  }
  return anchors
}

function reverseAnchors(anchors: readonly PenAnchor[]): PenAnchor[] {
  return anchors
    .slice()
    .reverse()
    .map((a) => ({
      point: a.point,
      handleIn: a.handleOut,
      handleOut: a.handleIn,
    }))
}

/**
 * Vector pen (Illustrator / Figma style):
 * click = corner anchor, click-drag = smooth Bezier handles,
 * Enter / double-click = commit open path, click first point = close.
 */
export class PenTool implements Tool {
  readonly name = 'pen' as const
  private anchors: PenAnchor[] = []
  /** Pointer-down placing a new anchor (may become smooth on drag). */
  private placing: { point: WorldPoint; handleOut: WorldPoint | null } | null = null
  private cursor: WorldPoint | null = null
  /** Continue an existing open bezier instead of creating a new one. */
  private resumeId: EntityId | null = null
  private resumeLocalFromWorld: ((p: WorldPoint) => { x: number; y: number }) | null = null
  /** Swallow the second click of a dblclick after resuming (same screen spot). */
  private suppressUntil = 0
  private suppressScreen: ScreenPoint | null = null
  private ignoreFinish = false
  /** Single-click on path body: wait to see if it becomes a double-click resume. */
  private pendingPathResume: EntityId | null = null
  private pendingTimer = 0

  onPointerDown(screen: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0) return
    if (performance.now() < this.suppressUntil && this.suppressScreen) {
      const d = Math.hypot(screen.x - this.suppressScreen.x, screen.y - this.suppressScreen.y)
      if (d <= 12) return
    }
    if (this.pendingPathResume) {
      // Second click of a dblclick on an existing path — wait for onDoubleClick.
      return
    }
    const p = snapWorld(ctx, world)
    if (this.anchors.length === 0) {
      const endHit = findOpenBezierEnd(ctx, screen)
      if (endHit) {
        this.applyResume(ctx, endHit.id, endHit.reverse)
        this.suppressUntil = performance.now() + 400
        this.suppressScreen = screen
        this.ignoreFinish = true
        return
      }
      const pathId = pickOpenBezier(ctx, screen, world)
      if (pathId) {
        this.pendingPathResume = pathId
        globalThis.clearTimeout(this.pendingTimer)
        this.pendingTimer = globalThis.setTimeout(() => {
          if (this.pendingPathResume === pathId) {
            ctx.selection.set([pathId])
            ctx.onSelectionEdited?.()
            this.pendingPathResume = null
          }
        }, 320)
        return
      }
    }
    // Close path by clicking near the first anchor.
    if (this.anchors.length >= 3) {
      const first = this.anchors[0]!.point
      const s0 = ctx.camera.worldToScreen(first)
      if (Math.hypot(s0.x - screen.x, s0.y - screen.y) <= 10) {
        this.commit(ctx, true)
        return
      }
    }
    this.ignoreFinish = false
    this.placing = { point: p, handleOut: null }
    this.cursor = p
    this.emitPreview(ctx)
  }

  onPointerMove(screen: ScreenPoint, world: WorldPoint, ctx: ToolContext): void {
    const p = snapWorld(ctx, world)
    this.cursor = p
    if (this.placing) {
      const zoom = Math.max(ctx.camera.getState().zoom, 1e-9)
      const dragPx = Math.hypot(
        screen.x - ctx.camera.worldToScreen(this.placing.point).x,
        screen.y - ctx.camera.worldToScreen(this.placing.point).y,
      )
      // ~3px drag → smooth point with symmetric handles.
      this.placing.handleOut = dragPx >= 3 ? p : null
      this.emitPreview(ctx)
      return
    }
    if (this.anchors.length) this.emitPreview(ctx)
  }

  onPointerUp(_s: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0 || !this.placing) return
    const p = snapWorld(ctx, world)
    const zoom = Math.max(ctx.camera.getState().zoom, 1e-9)
    const dragged =
      this.placing.handleOut != null &&
      Math.hypot(p.x - this.placing.point.x, p.y - this.placing.point.y) >= 3 / zoom
    const anchor: PenAnchor = dragged
      ? {
          point: this.placing.point,
          handleOut: this.placing.handleOut,
          handleIn: reflect(this.placing.point, this.placing.handleOut!),
        }
      : {
          point: this.placing.point,
          handleIn: null,
          handleOut: null,
        }
    this.anchors.push(anchor)
    this.placing = null
    this.cursor = p
    this.emitPreview(ctx)
  }

  onDoubleClick(screen: ScreenPoint, world: WorldPoint, ctx: ToolContext): void {
    globalThis.clearTimeout(this.pendingTimer)
    if (this.pendingPathResume) {
      const id = this.pendingPathResume
      this.pendingPathResume = null
      const end = nearestOpenBezierEnd(ctx, id, screen)
      if (end) this.applyResume(ctx, id, end.reverse)
      this.ignoreFinish = false
      return
    }
    if (this.ignoreFinish) {
      this.ignoreFinish = false
      return
    }
    if (this.anchors.length === 0) {
      const pathId = pickOpenBezier(ctx, screen, world)
      if (pathId) {
        const end = nearestOpenBezierEnd(ctx, pathId, screen)
        if (end) this.applyResume(ctx, pathId, end.reverse)
      }
      return
    }
    // Second click of dblclick already appended an extra anchor when finishing
    // a 3+ point path — drop it. Keep both points of a 2-point finish.
    if (this.anchors.length >= 3) this.anchors.pop()
    if (this.anchors.length >= 2) this.commit(ctx, false)
    else this.cancel(ctx)
  }

  onKeyDown(key: string, ctx: ToolContext): void {
    if (key === 'Enter') this.commit(ctx, false)
    else if (key === 'Escape') this.cancel(ctx)
    else if (key === 'Backspace' || key === 'Delete') {
      if (this.placing) {
        this.placing = null
      } else if (this.anchors.length) {
        this.anchors.pop()
      }
      if (!this.anchors.length) {
        this.cancel(ctx)
        return
      }
      this.emitPreview(ctx)
    }
  }

  cancel(ctx: ToolContext): void {
    globalThis.clearTimeout(this.pendingTimer)
    this.anchors = []
    this.placing = null
    this.cursor = null
    this.resumeId = null
    this.resumeLocalFromWorld = null
    this.pendingPathResume = null
    this.ignoreFinish = false
    this.suppressUntil = 0
    this.suppressScreen = null
    ctx.onPreview?.({ kind: 'none' })
  }

  private applyResume(ctx: ToolContext, id: EntityId, reverse: boolean): void {
    const entity = ctx.doc.getEntity(id)
    if (!entity || entity.type !== 'bezier' || entity.closed) return
    const m = resolveWorldMatrix(entity, (eid) => ctx.doc.getEntity(eid))
    const worldPts = entity.points.map((p) => {
      const q = transformPoint(m, p)
      return { x: q.x, y: q.y }
    })
    let anchors = cubicPointsToAnchors(worldPts, false)
    if (anchors.length < 2) return
    if (reverse) anchors = reverseAnchors(anchors)
    const inv = invert(m)
    this.anchors = anchors
    this.resumeId = id
    this.resumeLocalFromWorld = inv
      ? (p) => transformPoint(inv, p)
      : (p) => ({ x: p.x, y: p.y })
    this.placing = null
    this.cursor = anchors[anchors.length - 1]!.point
    ctx.selection.set([id])
    this.emitPreview(ctx)
  }

  private emitPreview(ctx: ToolContext): void {
    const closedHint =
      !this.placing &&
      !!this.cursor &&
      this.anchors.length >= 3 &&
      (() => {
        const s0 = ctx.camera.worldToScreen(this.anchors[0]!.point)
        const sc = ctx.camera.worldToScreen(this.cursor!)
        return Math.hypot(s0.x - sc.x, s0.y - sc.y) <= 10
      })()
    const placing: PenAnchorPreview | undefined = this.placing
      ? {
          point: this.placing.point,
          handleOut: this.placing.handleOut,
          handleIn: this.placing.handleOut
            ? reflect(this.placing.point, this.placing.handleOut)
            : null,
        }
      : undefined
    ctx.onPreview?.({
      kind: 'pen',
      anchors: this.anchors.map((a) => ({
        point: a.point,
        handleIn: a.handleIn,
        handleOut: a.handleOut,
      })),
      placing,
      cursor: this.placing ? undefined : (this.cursor ?? undefined),
      closedHint,
    })
  }

  private commit(ctx: ToolContext, closed: boolean): void {
    this.placing = null
    if (this.anchors.length < 2) {
      this.cancel(ctx)
      return
    }
    const cubic = anchorsToCubicPoints(this.anchors, closed)
    const toLocal = this.resumeLocalFromWorld
    const points = cubic.map((p) => (toLocal ? toLocal(p) : { x: p.x, y: p.y }))
    const resumeId = this.resumeId
    this.anchors = []
    this.cursor = null
    this.resumeId = null
    this.resumeLocalFromWorld = null
    ctx.onPreview?.({ kind: 'none' })
    if (resumeId && ctx.doc.getEntity(resumeId)?.type === 'bezier' && ctx.applyPatches) {
      ctx.applyPatches(new Map([[resumeId, { points, closed }]]), `pen-resume:${String(resumeId)}`)
      ctx.selection.set([resumeId])
      ctx.onSelectionEdited?.()
      return
    }
    const entity: Entity = {
      id: createEntityId('bezier'),
      type: 'bezier',
      layerId: ctx.doc.getDefaultLayerId(),
      style: activeLayerStyle(ctx),
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points,
      closed,
    }
    commitEntity(ctx, entity)
  }
}

function bezierWorldEnds(
  ctx: ToolContext,
  entity: Extract<Entity, { type: 'bezier' }>,
): { start: WorldPoint; end: WorldPoint } | null {
  if (entity.points.length < 2) return null
  const m = resolveWorldMatrix(entity, (id) => ctx.doc.getEntity(id))
  const a = transformPoint(m, entity.points[0]!)
  const b = transformPoint(m, entity.points[entity.points.length - 1]!)
  return { start: worldPoint(a.x, a.y), end: worldPoint(b.x, b.y) }
}

function findOpenBezierEnd(
  ctx: ToolContext,
  screen: ScreenPoint,
): { id: EntityId; reverse: boolean } | null {
  let best: { id: EntityId; reverse: boolean; dist: number } | null = null
  for (const e of ctx.doc.getEntities()) {
    if (e.type !== 'bezier' || e.closed || e.style.visible === false || e.style.locked) continue
    const ends = bezierWorldEnds(ctx, e)
    if (!ends) continue
    for (const [pt, reverse] of [
      [ends.end, false],
      [ends.start, true],
    ] as const) {
      const s = ctx.camera.worldToScreen(pt)
      const d = Math.hypot(s.x - screen.x, s.y - screen.y)
      if (d <= 10 && (!best || d < best.dist)) best = { id: e.id, reverse, dist: d }
    }
  }
  return best
}

function nearestOpenBezierEnd(
  ctx: ToolContext,
  id: EntityId,
  screen: ScreenPoint,
): { reverse: boolean } | null {
  const e = ctx.doc.getEntity(id)
  if (!e || e.type !== 'bezier' || e.closed) return null
  const ends = bezierWorldEnds(ctx, e)
  if (!ends) return null
  const se = ctx.camera.worldToScreen(ends.end)
  const ss = ctx.camera.worldToScreen(ends.start)
  const de = Math.hypot(se.x - screen.x, se.y - screen.y)
  const ds = Math.hypot(ss.x - screen.x, ss.y - screen.y)
  return { reverse: ds < de }
}

function pickOpenBezier(ctx: ToolContext, screen: ScreenPoint, world: WorldPoint): EntityId | null {
  const id = pickEntity(ctx, world, screen)
  if (!id) return null
  const e = ctx.doc.getEntity(id)
  if (!e || e.type !== 'bezier' || e.closed || e.style.visible === false || e.style.locked) {
    return null
  }
  return id
}

/** Freehand brush → open polyline stroke. */
export class BrushTool implements Tool {
  readonly name = 'brush' as const
  private points: WorldPoint[] = []
  private drawing = false

  onPointerDown(_s: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0) return
    this.drawing = true
    this.points = [snapWorld(ctx, world)]
    ctx.onPreview?.({ kind: 'polyline', points: [...this.points] })
  }

  onPointerMove(_s: ScreenPoint, world: WorldPoint, ctx: ToolContext): void {
    if (!this.drawing) return
    const p = snapWorld(ctx, world)
    const last = this.points[this.points.length - 1]!
    const minDist = 0.75 / Math.max(ctx.camera.getState().zoom, 1e-9)
    if (Math.hypot(p.x - last.x, p.y - last.y) < minDist) return
    this.points.push(p)
    ctx.onPreview?.({ kind: 'polyline', points: [...this.points] })
  }

  onPointerUp(_s: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0 || !this.drawing) return
    this.drawing = false
    const end = snapWorld(ctx, world)
    const last = this.points[this.points.length - 1]
    if (last && Math.hypot(end.x - last.x, end.y - last.y) > 1e-6) {
      this.points.push(end)
    }
    if (this.points.length < 2 && this.points[0]) {
      const zoom = Math.max(ctx.camera.getState().zoom, 1e-9)
      const eps = 2 / zoom
      this.points.push(worldPoint(this.points[0].x + eps, this.points[0].y))
    }
    const entity: Entity = {
      id: createEntityId('polyline'),
      type: 'polyline',
      layerId: ctx.doc.getDefaultLayerId(),
      style: activeLayerStyle(ctx),
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: this.points.map((p) => ({ x: p.x, y: p.y })),
      closed: false,
    }
    this.points = []
    ctx.onPreview?.({ kind: 'none' })
    commitEntity(ctx, entity)
  }

  onKeyDown(key: string, ctx: ToolContext): void {
    if (key === 'Escape') this.cancel(ctx)
  }

  cancel(ctx: ToolContext): void {
    this.drawing = false
    this.points = []
    ctx.onPreview?.({ kind: 'none' })
  }
}

export class TextTool implements Tool {
  readonly name = 'text' as const
  private pending: WorldPoint | null = null

  onPointerDown(_s: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0) return
    const p = snapWorld(ctx, world)
    this.pending = p
    const screen = ctx.camera.worldToScreen(p)
    const textStyle = activeLayerStyle(ctx, { text: true })
    const textColor = textStyle.fill ?? textStyle.stroke ?? '#111827'
    const layerId = ctx.doc.getDefaultLayerId()
    ctx.beginTextEdit?.({
      world: p,
      screenX: screen.x,
      screenY: screen.y,
      fontSize: 14 * ctx.camera.getState().zoom,
      worldFontSize: 14,
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      color: textColor,
      layerId,
      initial: '',
      onCommit: (content) => {
        if (!content.trim()) {
          this.pending = null
          return
        }
        const entity: Entity = {
          id: createEntityId('text'),
          type: 'text',
          layerId,
          style: textStyle,
          transform: IDENTITY_TRANSFORM,
          version: 1,
          content,
          position: { x: p.x, y: p.y },
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: 14,
        }
        this.pending = null
        commitEntity(ctx, entity)
      },
      onCancel: () => {
        this.pending = null
      },
    })
  }

  onKeyDown(key: string, ctx: ToolContext): void {
    if (key === 'Escape') {
      this.pending = null
      ctx.cancelTextEdit?.()
    }
  }

  cancel(ctx: ToolContext): void {
    this.pending = null
    ctx.cancelTextEdit?.()
  }
}

export class ImageTool implements Tool {
  readonly name = 'image' as const

  onPointerDown(_s: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0) return
    const p = snapWorld(ctx, world)
    ctx.placeImageAt?.(p)
  }

  cancel(): void {}
}

export function createBuiltinTools(): Tool[] {
  return [
    new RectangleTool(),
    new EllipseTool(),
    new CircleTool(),
    new HeartTool(),
    new StarTool(),
    new PolylineTool(),
    new PenTool(),
    new BrushTool(),
    new TextTool(),
    new ImageTool(),
  ]
}

export type { EntityId }
