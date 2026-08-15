import {
  createAABB,
  type AABB,
  type Entity,
  type EntityId,
  type ScreenPoint,
  type SelectionHitMode,
  type WorldPoint,
} from '@cadkit/types'
import type { Camera2D } from '@cadkit/geometry'
import {
  measureTextAdvance,
  parseRectCornerId,
  pointsAABB,
  resolveWorldMatrix,
  starCenter,
  starConstructionRadius,
  transformPoint,
  type RectCornerId,
} from '@cadkit/geometry'
import type { CadDocument, DocumentChange } from '@cadkit/document'
import type { SceneProjector } from '@cadkit/scene'
import { SelectionSet } from './selection.js'
import { applyOrtho, bestSnap, collectSnaps, type SnapOptions } from './snap.js'
import {
  excludeIds,
  snapAngleDelta,
  snapSelectionTranslation,
  type AlignGuide,
} from './align-snap.js'
import { pickEntity } from './pick.js'
import {
  handleEditPatch,
  removePolylineVertices,
  translateEntityPatch,
  type PathVertexRef,
} from './entity-edit.js'
import {
  comparePathVertexRef,
  parsePathVertexHandleId,
  parsePathVertexKey,
  pathVertexKey,
} from './path-vertex.js'
import {
  buildsHandlesForEntity,
  hitTestHandle,
  type ControlHandle,
} from './handles.js'
import {
  aabbCenter,
  buildTransformHandles,
  cloneEntitySnapshot,
  oppositeScaleCorner,
  patchesFromMatrix,
  rotateMatrixAbout,
  scaleFactorsFromDrag,
  scaleHandleWorld,
  scaleMatrixAbout,
  selectionWorldBounds,
  type SelectionFrame,
} from './selection-transform.js'

export type ToolName =
  | 'select'
  | 'pan'
  | 'zoom'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'circle'
  | 'heart'
  | 'star'
  | 'polyline'
  | 'pen'
  | 'brush'
  | 'arc'
  | 'text'
  | 'image'
  | 'measure'

export type SelectInteractionMode = 'object' | 'edit'

export interface ToolContext {
  doc: CadDocument
  camera: Camera2D
  scene: SceneProjector
  selection: SelectionSet
  snap: SnapOptions
  ortho: boolean
  /** Object-mode hit testing for empty space inside the selection AABB. */
  selectionHitMode?: SelectionHitMode
  /** True while Shift is held (multi-select). */
  shiftKey?: boolean
  /** True while Space is held (temporary pan). */
  spaceKey?: boolean
  onEntityCreated?: (id: EntityId) => void
  /** Apply document change to spatial index + request render. */
  commitChange?: (change: DocumentChange | DocumentChange[] | null) => void
  /** Undoable add (preferred over raw doc.add). */
  addEntity?: (entity: Entity) => void
  /** Undoable multi-entity patch (selection drag). */
  applyPatches?: (patches: Map<EntityId, Partial<Entity>>, coalesceKey: string) => void
  /** Undoable remove selection. */
  removeEntities?: (ids: EntityId[]) => void
  /** Notify UI to refresh handle overlay. */
  onSelectionEdited?: () => void
  /** Camera moved (pan/zoom); Editor should emit camera:change + render. */
  onCameraChanged?: () => void
  /** Sticky tool changed (not temporary Space/MMB pan). */
  onToolChanged?: (tool: ToolName) => void
  /** Align guides for overlay (cleared when idle). */
  onAlignGuides?: (guides: AlignGuide[]) => void
  /** Rubber-band / shape preview overlay. */
  onPreview?: (preview: import('./shape-tools.js').PreviewPrimitive) => void
  /** Start IME text editing at a screen position. */
  beginTextEdit?: (opts: {
    entityId?: EntityId
    layerId?: import('@cadkit/types').LayerId
    world: WorldPoint
    screenX: number
    screenY: number
    /** Optional click position to place the initial caret. */
    clickScreen?: ScreenPoint
    /** Screen-space font size for parking the hidden IME. */
    fontSize: number
    /** World-space font size for canvas draft / caret (defaults to fontSize / zoom). */
    worldFontSize?: number
    fontFamily?: string
    color?: string
    widthPx?: number
    widthFactor?: number
    rotation?: number
    align?: 'left' | 'center' | 'right'
    path?: import('@cadkit/types').TextArcPath
    initial: string
    onCommit: (text: string) => void
    onCancel: () => void
  }) => void
  cancelTextEdit?: () => void
  /** Commit in-place text edit (same as blur). */
  commitTextEdit?: () => void
  /** True while the hidden IME is editing a text entity / draft. */
  isTextEditing?: () => boolean
  /** Keep IME focused across canvas pointer gestures. */
  retainTextEditFocus?: () => void
  hitTestTextEdit?: (screen: ScreenPoint, world: WorldPoint) => boolean
  textCaretIndexAt?: (screen: ScreenPoint) => number
  setTextSelection?: (start: number, end: number) => void
  getTextSelection?: () => { start: number; end: number }
  /** Image tool: place / open picker at world point. */
  placeImageAt?: (world: WorldPoint) => void
}

export interface Tool {
  readonly name: ToolName
  onPointerDown?(screen: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void
  onPointerMove?(screen: ScreenPoint, world: WorldPoint, ctx: ToolContext): void
  onPointerUp?(screen: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void
  onDoubleClick?(screen: ScreenPoint, world: WorldPoint, ctx: ToolContext): void
  onKeyDown?(key: string, ctx: ToolContext): void
  /** Fixed-timestep / rAF tick for inertia etc. Returns true if still animating. */
  tick?(dtSec: number, ctx: ToolContext): boolean
  cancel?(ctx: ToolContext): void
}

type TransformDrag = {
  kind: 'scale' | 'rotate'
  session: string
  handle: ControlHandle
  startWorld: WorldPoint
  /** Frame AABB frozen at gesture start (not rebuilt while rotating). */
  bounds: AABB
  snapshots: Map<EntityId, Entity>
  /** Live rotation angle for OBB frame during rotate gesture. */
  liveAngle: number
}

export class SelectTool implements Tool {
  readonly name = 'select' as const
  private mode: SelectInteractionMode = 'object'
  private editEntityId: EntityId | null = null
  /** Vertex keys (`o:i` / `h:hi:i`) selected while editing a polyline path. */
  private selectedVertices = new Set<string>()
  private boxStart: WorldPoint | null = null
  private boxCurrent: WorldPoint | null = null
  private drag: {
    ids: EntityId[]
    origin: WorldPoint
    session: string
    moved: boolean
    startBounds: AABB
    snapshots: Map<EntityId, Entity>
  } | null = null
  private handleDrag: {
    handle: ControlHandle
    session: string
    startWorld: WorldPoint
    startCenter?: { x: number; y: number }
    startRadius?: number
    starDrag?: {
      cx: number
      cy: number
      outerR: number
      tips: number
      corner: number
    }
    rectDrag?: {
      minX: number
      minY: number
      maxX: number
      maxY: number
      cornerId: RectCornerId
      pad: number
      cornerRadii: number | readonly [number, number, number, number]
    }
    arcDrag?: {
      startAngle: number
      endAngle: number
    }
  } | null = null
  private transformDrag: TransformDrag | null = null
  private suppressBox = false
  private alignGuides: AlignGuide[] = []
  /** Entity (or group root) under the cursor while idle. */
  private hoverId: EntityId | null = null
  /** Drag-selecting characters inside an in-place text edit. */
  private textDrag: { anchor: number } | null = null

  getMode(): SelectInteractionMode {
    return this.mode
  }

  /** Path-edit selected vertices (outer + holes), empty outside edit selection. */
  getSelectedVertices(): readonly PathVertexRef[] {
    const refs: PathVertexRef[] = []
    for (const key of this.selectedVertices) {
      const ref = parsePathVertexKey(key)
      if (ref) refs.push(ref)
    }
    return refs.sort(comparePathVertexRef)
  }

  getAlignGuides(): AlignGuide[] {
    return this.alignGuides
  }

  getHoverId(): EntityId | null {
    return this.hoverId
  }

  /** World AABB of the hovered target, or null when none / already selected. */
  getHoverFrame(ctx: ToolContext): AABB | null {
    if (!this.hoverId) return null
    if (ctx.selection.has(this.hoverId)) return null
    const entity = ctx.doc.getEntity(this.hoverId)
    if (!entity || entity.style.visible === false) return null
    return selectionWorldBounds([entity], (id) => ctx.doc.getEntity(id))
  }

  /** Active box-select AABB in world space, or null when not marquee-selecting. */
  getMarqueeAABB(): AABB | null {
    if (this.suppressBox || !this.boxStart || !this.boxCurrent) return null
    return createAABB(
      Math.min(this.boxStart.x, this.boxCurrent.x),
      Math.min(this.boxStart.y, this.boxCurrent.y),
      Math.max(this.boxStart.x, this.boxCurrent.x),
      Math.max(this.boxStart.y, this.boxCurrent.y),
    )
  }

  /**
   * Object-mode selection frame. During rotate, keeps the start AABB and applies
   * live OBB rotation so handles track the pointer; axis-aligned rebuild happens on release.
   */
  getSelectionFrame(ctx: ToolContext): SelectionFrame | null {
    if (ctx.isTextEditing?.()) return null
    if (this.mode !== 'object' || ctx.selection.size === 0) return null
    if (this.transformDrag?.kind === 'rotate') {
      return { box: this.transformDrag.bounds, rotation: this.transformDrag.liveAngle }
    }
    const box = selectionWorldBounds(selectedEntities(ctx), (id) => ctx.doc.getEntity(id))
    return box ? { box, rotation: 0 } : null
  }

  /** Axis-aligned box only (for hit-testing empty space inside the frame). */
  getSelectionFrameAABB(ctx: ToolContext): AABB | null {
    return this.getSelectionFrame(ctx)?.box ?? null
  }

  getOverlayHandles(ctx: ToolContext): ControlHandle[] {
    // Hide transform / vertex handles while typing so the entity can't be dragged.
    if (ctx.isTextEditing?.()) return []
    if (this.mode === 'edit') {
      const id = this.editEntityId
      if (!id) return []
      const e = ctx.doc.getEntity(id)
      // Nested group children store geometry in parent-local space — project to world.
      if (!e) return []
      const handles = buildsHandlesForEntity(e, ctx.camera, (eid) => ctx.doc.getEntity(eid))
      if (this.selectedVertices.size === 0 || e.type !== 'polyline') return handles
      return handles.map((h) => {
        if (h.kind !== 'endpoint') return h
        const ref = parsePathVertexHandleId(h.id)
        if (!ref) return h
        return this.selectedVertices.has(pathVertexKey(ref)) ? { ...h, selected: true } : h
      })
    }
    const frame = this.getSelectionFrame(ctx)
    const handles = frame ? buildTransformHandles(frame.box, ctx.camera, frame.rotation) : []
    // Single selection: parametric shape / arc-text handles without entering edit mode.
    const ids = ctx.selection.toArray()
    if (ids.length === 1) {
      const e = ctx.doc.getEntity(ids[0]!)
      const shapeKind = e?.type === 'polyline' ? e.shape?.kind : null
      if (
        (e?.type === 'text' && e.path?.kind === 'arc') ||
        e?.type === 'circle' ||
        e?.type === 'arc' ||
        e?.type === 'ellipse' ||
        (e?.type === 'polyline' &&
          e.closed &&
          (shapeKind === 'rect' || shapeKind === 'star'))
      ) {
        handles.push(
          ...buildsHandlesForEntity(e, ctx.camera, (eid) => ctx.doc.getEntity(eid)),
        )
      }
    }
    return handles
  }

  enterEditMode(entityId: EntityId, ctx: ToolContext): void {
    this.mode = 'edit'
    this.editEntityId = entityId
    this.selectedVertices.clear()
    ctx.selection.set([entityId])
    ctx.onSelectionEdited?.()
  }

  exitEditMode(ctx: ToolContext, clearSelection = false): void {
    this.mode = 'object'
    this.editEntityId = null
    this.selectedVertices.clear()
    if (clearSelection) ctx.selection.clear()
    ctx.onSelectionEdited?.()
  }

  private clearVertexSelection(): void {
    this.selectedVertices.clear()
  }

  private selectVertexAtHandle(handle: ControlHandle, shiftKey: boolean): boolean {
    if (handle.kind !== 'endpoint') return false
    const ref = parsePathVertexHandleId(handle.id)
    if (!ref || !Number.isInteger(ref.pointIndex) || ref.pointIndex < 0) return false
    const key = pathVertexKey(ref)
    if (shiftKey) {
      if (this.selectedVertices.has(key)) this.selectedVertices.delete(key)
      else this.selectedVertices.add(key)
    } else {
      this.selectedVertices.clear()
      this.selectedVertices.add(key)
    }
    return true
  }

  onPointerDown(screen: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0) return
    this.clearGuides(ctx)
    this.textDrag = null

    // In-place text edit: place caret / extend selection; never drag the entity.
    if (ctx.isTextEditing?.()) {
      ctx.retainTextEditFocus?.()
      if (ctx.hitTestTextEdit?.(screen, world)) {
        const idx = ctx.textCaretIndexAt?.(screen) ?? 0
        const sel = ctx.getTextSelection?.() ?? { start: idx, end: idx }
        if (ctx.shiftKey) {
          const anchor = sel.start === sel.end ? sel.start : this.selectionAnchor(sel, idx)
          ctx.setTextSelection?.(Math.min(anchor, idx), Math.max(anchor, idx))
          this.textDrag = { anchor }
        } else {
          ctx.setTextSelection?.(idx, idx)
          this.textDrag = { anchor: idx }
        }
        this.drag = null
        this.handleDrag = null
        this.transformDrag = null
        this.boxStart = null
        this.boxCurrent = null
        this.suppressBox = true
        return
      }
      // Click outside the text — commit edit; ignore the rest of this gesture
      // so we don't immediately start dragging the text entity.
      ctx.commitTextEdit?.()
      this.drag = null
      this.handleDrag = null
      this.transformDrag = null
      this.boxStart = null
      this.boxCurrent = null
      this.suppressBox = true
      return
    }

    const handles = this.getOverlayHandles(ctx)
    const handle = hitTestHandle(handles, screen, ctx.camera, 12)
    if (handle) {
      if (handle.kind === 'scale' || handle.kind === 'rotate') {
        const bounds = this.getSelectionFrameAABB(ctx)
        if (!bounds) return
        const snapshots = collectTransformSnapshots(ctx)
        this.transformDrag = {
          kind: handle.kind,
          session: `xform:${handle.id}:${Date.now()}`,
          handle,
          startWorld: world,
          bounds,
          snapshots,
          liveAngle: 0,
        }
        this.handleDrag = null
      } else {
        if (this.mode === 'edit') {
          this.selectVertexAtHandle(handle, !!ctx.shiftKey)
          // Shift toggles multi-select only — do not start a drag (avoids
          // accidentally moving a vertex while deselecting).
          if (ctx.shiftKey) {
            this.handleDrag = null
            this.transformDrag = null
            this.boxStart = null
            this.boxCurrent = null
            this.drag = null
            this.suppressBox = true
            ctx.onSelectionEdited?.()
            return
          }
        }
        const entity = ctx.doc.getEntity(handle.entityId)
        const arcText =
          entity?.type === 'text' && entity.path?.kind === 'arc'
            ? { position: entity.position, radius: entity.path.radius }
            : null
        let starDrag:
          | {
              cx: number
              cy: number
              outerR: number
              tips: number
              corner: number
            }
          | undefined
        let rectDrag:
          | {
              minX: number
              minY: number
              maxX: number
              maxY: number
              cornerId: RectCornerId
              pad: number
              cornerRadii: number | readonly [number, number, number, number]
            }
          | undefined
        let arcDrag: { startAngle: number; endAngle: number } | undefined
        if (
          entity?.type === 'circle' &&
          (handle.id.endsWith(':arc-open') || handle.id.endsWith(':arc-start'))
        ) {
          arcDrag = { startAngle: 0, endAngle: Math.PI * 2 }
        } else if (entity?.type === 'arc') {
          arcDrag = { startAngle: entity.startAngle, endAngle: entity.endAngle }
        } else if (entity?.type === 'ellipse') {
          arcDrag = { startAngle: entity.startAngle, endAngle: entity.endAngle }
        }
        if (
          entity?.type === 'polyline' &&
          entity.shape?.kind === 'star' &&
          (handle.id.endsWith(':star-tips') || handle.id.endsWith(':star-corner'))
        ) {
          const { cx, cy } = starCenter(entity.points)
          const tips = entity.shape.points ?? 5
          const corner =
            typeof entity.shape.cornerRadii === 'number'
              ? entity.shape.cornerRadii
              : (entity.shape.cornerRadii?.[0] ?? 0)
          starDrag = {
            cx,
            cy,
            outerR: starConstructionRadius(entity.points, cx, cy, tips, corner),
            tips,
            corner,
          }
        }
        if (entity?.type === 'polyline' && entity.shape?.kind === 'rect') {
          const cornerId = parseRectCornerId(handle.id)
          if (cornerId) {
            const box = pointsAABB(entity.points)
            const prev = entity.shape.cornerRadii ?? 0
            rectDrag = {
              minX: box.minX,
              minY: box.minY,
              maxX: box.maxX,
              maxY: box.maxY,
              cornerId,
              pad: 18 / Math.max(ctx.camera.getState().zoom, 1e-9),
              cornerRadii: prev,
            }
          }
        }
        this.handleDrag = {
          handle,
          session: `handle:${handle.id}:${Date.now()}`,
          startWorld: world,
          startCenter: arcText ? { ...arcText.position } : undefined,
          startRadius: arcText?.radius,
          starDrag,
          rectDrag,
          arcDrag,
        }
        this.transformDrag = null
      }
      this.boxStart = null
      this.boxCurrent = null
      this.drag = null
      this.suppressBox = true
      ctx.onSelectionEdited?.()
      return
    }

    const hit = pickEntity(ctx, world, screen)
    if (hit) {
      const target = this.mode === 'edit' ? hit : resolveGroupRoot(ctx, hit)
      if (this.mode === 'edit' && hit !== this.editEntityId) {
        this.mode = 'object'
        this.editEntityId = null
        this.clearVertexSelection()
      } else if (this.mode === 'edit' && hit === this.editEntityId) {
        this.clearVertexSelection()
      }
      if (ctx.shiftKey) {
        ctx.selection.toggle(target)
        this.mode = 'object'
        this.editEntityId = null
        this.clearVertexSelection()
      } else if (!ctx.selection.has(target)) {
        ctx.selection.set([target])
        this.mode = 'object'
        this.editEntityId = null
        this.clearVertexSelection()
      }
      this.beginDrag(ctx, world)
      ctx.onSelectionEdited?.()
      return
    }

    // Empty geometry hit — optionally treat selection AABB as hittable
    const hitMode = ctx.selectionHitMode ?? 'bounds'
    if (this.mode === 'object' && hitMode === 'bounds' && ctx.selection.size > 0) {
      const frame = this.getSelectionFrameAABB(ctx)
      if (frame && pointInAABB(world, frame)) {
        this.beginDrag(ctx, world)
        ctx.onSelectionEdited?.()
        return
      }
    }

    // Empty space
    if (this.mode === 'edit') {
      this.mode = 'object'
      this.editEntityId = null
      this.clearVertexSelection()
    }
    if (!ctx.shiftKey) ctx.selection.clear()
    this.boxStart = world
    this.boxCurrent = world
    this.drag = null
    this.handleDrag = null
    this.transformDrag = null
    this.suppressBox = false
    ctx.onSelectionEdited?.()
  }

  /** Prefer the existing selection end farther from the new index as the shift-anchor. */
  private selectionAnchor(sel: { start: number; end: number }, idx: number): number {
    const distStart = Math.abs(sel.start - idx)
    const distEnd = Math.abs(sel.end - idx)
    return distStart >= distEnd ? sel.start : sel.end
  }

  private beginDrag(ctx: ToolContext, world: WorldPoint): void {
    const ids = expandTransformTargets(ctx)
    const snapshots = new Map<EntityId, Entity>()
    for (const id of ids) {
      const e = ctx.doc.getEntity(id)
      if (e && !e.style.locked) snapshots.set(id, cloneEntitySnapshot(e))
    }
    const startBounds =
      selectionWorldBounds(
        [...snapshots.values()],
        (id) => ctx.doc.getEntity(id),
      ) ?? createAABB(world.x, world.y, world.x, world.y)
    this.drag = {
      ids,
      origin: world,
      session: `drag:${Date.now()}`,
      moved: false,
      startBounds,
      snapshots,
    }
    this.boxStart = null
    this.boxCurrent = null
    this.suppressBox = true
  }

  onPointerMove(screen: ScreenPoint, world: WorldPoint, ctx: ToolContext): void {
    if (this.textDrag && ctx.isTextEditing?.()) {
      ctx.retainTextEditFocus?.()
      const idx = ctx.textCaretIndexAt?.(screen) ?? this.textDrag.anchor
      const a = this.textDrag.anchor
      ctx.setTextSelection?.(Math.min(a, idx), Math.max(a, idx))
      return
    }
    if (this.transformDrag && ctx.applyPatches) {
      this.hoverId = null
      const patches = this.computeTransformPatches(this.transformDrag, world, ctx)
      if (patches.size) {
        ctx.applyPatches(patches, this.transformDrag.session)
        ctx.onSelectionEdited?.()
      }
      return
    }

    if (this.handleDrag) {
      this.hoverId = null
      const { handle, session, startWorld, startCenter, startRadius, starDrag, rectDrag, arcDrag } =
        this.handleDrag
      const entity = ctx.doc.getEntity(handle.entityId)
      if (!entity || !ctx.applyPatches) return
      const patch = handleEditPatch(
        entity,
        handle,
        world,
        (eid) => ctx.doc.getEntity(eid),
        { startWorld, startCenter, startRadius, starDrag, rectDrag, arcDrag },
      )
      if (!patch) return
      ctx.applyPatches(new Map([[handle.entityId, patch]]), session)
      ctx.onSelectionEdited?.()
      return
    }

    if (this.drag && ctx.applyPatches) {
      this.hoverId = null
      const rawDx = world.x - this.drag.origin.x
      const rawDy = world.y - this.drag.origin.y
      const proposed: AABB = {
        minX: this.drag.startBounds.minX + rawDx,
        minY: this.drag.startBounds.minY + rawDy,
        maxX: this.drag.startBounds.maxX + rawDx,
        maxY: this.drag.startBounds.maxY + rawDy,
      }
      const selected = new Set(this.drag.ids)
      for (const id of this.drag.ids) {
        const e = this.drag.snapshots.get(id)
        if (e?.type === 'group') for (const c of e.children) selected.add(c)
      }
      const others = excludeIds(ctx.doc.getEntities(), selected)
      const snapped = snapSelectionTranslation(
        proposed,
        rawDx,
        rawDy,
        others,
        {
          ...ctx.snap,
          worldPerPixel: 1 / Math.max(ctx.camera.getState().zoom, 1e-9),
        },
        (e) => resolveWorldMatrix(e, (id) => ctx.doc.getEntity(id)),
      )
      this.alignGuides = snapped.guides
      ctx.onAlignGuides?.(this.alignGuides)

      this.drag.moved = true
      const patches = new Map<EntityId, Partial<Entity>>()
      for (const [id, snap] of this.drag.snapshots) {
        const patch = translateEntityPatch(snap, snapped.dx, snapped.dy, (eid) => ctx.doc.getEntity(eid))
        if (patch) patches.set(id, patch)
      }
      if (patches.size) {
        ctx.applyPatches(patches, this.drag.session)
        ctx.onSelectionEdited?.()
      }
      return
    }

    if (this.boxStart && !this.suppressBox) {
      this.hoverId = null
      this.boxCurrent = world
      return
    }

    // Idle: highlight the pick target so the user sees what a click would select.
    const hit = pickEntity(ctx, world, screen)
    if (!hit) {
      this.hoverId = null
      return
    }
    this.hoverId = this.mode === 'edit' ? hit : resolveGroupRoot(ctx, hit)
  }

  onPointerUp(_s: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0) return

    if (this.textDrag) {
      this.textDrag = null
      ctx.retainTextEditFocus?.()
      return
    }

    if (this.transformDrag) {
      this.transformDrag = null
      this.clearGuides(ctx)
      ctx.onSelectionEdited?.()
      return
    }

    if (this.handleDrag) {
      this.handleDrag = null
      ctx.onSelectionEdited?.()
      return
    }

    if (this.drag) {
      this.drag = null
      this.boxStart = null
      this.boxCurrent = null
      this.clearGuides(ctx)
      ctx.onSelectionEdited?.()
      return
    }

    if (this.suppressBox || !this.boxStart) {
      this.boxStart = null
      this.boxCurrent = null
      return
    }

    const minX = Math.min(this.boxStart.x, world.x)
    const minY = Math.min(this.boxStart.y, world.y)
    const maxX = Math.max(this.boxStart.x, world.x)
    const maxY = Math.max(this.boxStart.y, world.y)
    if (maxX - minX > 1e-6 || maxY - minY > 1e-6) {
      const ids = ctx.scene.query({ minX, minY, maxX, maxY }).filter((id) => {
        const e = ctx.doc.getEntity(id)
        return e && e.type !== 'group'
      })
      // Promote to group roots
      const roots = [...new Set(ids.map((id) => resolveGroupRoot(ctx, id)))]
      this.mode = 'object'
      this.editEntityId = null
      if (ctx.shiftKey) {
        for (const id of roots) ctx.selection.add(id)
      } else {
        ctx.selection.set(roots)
      }
    }
    this.boxStart = null
    this.boxCurrent = null
    ctx.onSelectionEdited?.()
  }

  onDoubleClick(clickScreen: ScreenPoint, world: WorldPoint, ctx: ToolContext): void {
    const screen = ctx.camera.worldToScreen(world)
    const hit = pickEntity(ctx, world, screen)
    if (!hit) return
    const entity = ctx.doc.getEntity(hit)
    if (!entity) return
    if (entity.type === 'text' && ctx.beginTextEdit) {
      const matrix = resolveWorldMatrix(entity, (id) => ctx.doc.getEntity(id))
      const anchor = transformPoint(matrix, entity.position)
      const anchorScreen = ctx.camera.worldToScreen({
        x: anchor.x,
        y: anchor.y,
        __space: 'world',
      })
      const worldScale = Math.hypot(matrix[0] ?? 1, matrix[1] ?? 0)
      const screenScale = ctx.camera.getState().zoom * worldScale
      this.mode = 'object'
      this.editEntityId = null
      this.drag = null
      this.textDrag = null
      ctx.selection.set([hit])
      ctx.onSelectionEdited?.()
      ctx.beginTextEdit({
        entityId: hit,
        layerId: entity.layerId,
        world: { x: anchor.x, y: anchor.y, __space: 'world' },
        screenX: anchorScreen.x,
        screenY: anchorScreen.y,
        clickScreen,
        fontSize: entity.fontSize * screenScale,
        worldFontSize: entity.fontSize,
        fontFamily: entity.fontFamily,
        color: entity.style.fill || entity.style.stroke || '#111827',
        widthPx: measureTextAdvance(
          entity.content,
          entity.fontSize,
          entity.fontFamily || 'sans-serif',
          entity.widthFactor ?? 1,
        ) * screenScale,
        widthFactor: entity.widthFactor,
        rotation: entity.rotation,
        align: entity.align,
        path: entity.path,
        initial: entity.content,
        onCommit: (content) => {
          if (content === entity.content) return
          if (!content.trim()) {
            ctx.removeEntities?.([hit])
            ctx.selection.clear()
          } else {
            ctx.applyPatches?.(
              new Map([[hit, { content } as Partial<Entity>]]),
              `text-edit:${String(hit)}`,
            )
          }
          ctx.onSelectionEdited?.()
        },
        onCancel: () => {
          ctx.onSelectionEdited?.()
        },
      })
      return
    }
    if (
      entity.type !== 'line' &&
      entity.type !== 'polyline' &&
      entity.type !== 'circle' &&
      entity.type !== 'bezier'
    ) {
      return
    }
    this.enterEditMode(hit, ctx)
  }

  onKeyDown(key: string, ctx: ToolContext): void {
    if (key === 'Delete' || key === 'Backspace') {
      // Path edit: Delete only removes selected vertices — never the whole entity.
      if (this.mode === 'edit') {
        if (
          this.editEntityId &&
          this.selectedVertices.size > 0
        ) {
          const entity = ctx.doc.getEntity(this.editEntityId)
          if (entity?.type === 'polyline') {
            const result = removePolylineVertices(entity, this.getSelectedVertices())
            if (result === 'remove') {
              ctx.removeEntities?.([entity.id])
              ctx.selection.clear()
              this.mode = 'object'
              this.editEntityId = null
              this.clearVertexSelection()
            } else if (result && ctx.applyPatches) {
              ctx.applyPatches(
                new Map([[entity.id, result]]),
                `vertex-delete:${String(entity.id)}:${Date.now()}`,
              )
              this.clearVertexSelection()
            }
            ctx.onSelectionEdited?.()
          }
        }
        return
      }
      const ids = ctx.selection.toArray()
      if (ids.length && ctx.removeEntities) {
        ctx.removeEntities(ids)
        ctx.selection.clear()
        this.mode = 'object'
        this.editEntityId = null
        this.clearVertexSelection()
        ctx.onSelectionEdited?.()
      }
    }
    if (key === 'Escape') {
      if (this.mode === 'edit') {
        if (this.selectedVertices.size > 0) {
          this.clearVertexSelection()
          ctx.onSelectionEdited?.()
          return
        }
        this.exitEditMode(ctx, false)
        return
      }
      ctx.selection.clear()
      this.cancel(ctx)
      ctx.onSelectionEdited?.()
    }
  }

  cancel(ctx: ToolContext): void {
    this.boxStart = null
    this.boxCurrent = null
    this.drag = null
    this.handleDrag = null
    this.transformDrag = null
    this.suppressBox = false
    this.hoverId = null
    this.clearGuides(ctx)
  }

  /** Clear hover when the pointer leaves the canvas. */
  clearHover(): void {
    this.hoverId = null
  }

  private clearGuides(ctx: ToolContext): void {
    this.alignGuides = []
    ctx.onAlignGuides?.([])
  }

  private computeTransformPatches(
    drag: TransformDrag,
    world: WorldPoint,
    ctx: ToolContext,
  ): Map<EntityId, Partial<Entity>> {
    if (drag.kind === 'rotate') {
      const c = aabbCenter(drag.bounds)
      const a0 = Math.atan2(drag.startWorld.y - c.y, drag.startWorld.x - c.x)
      const a1 = Math.atan2(world.y - c.y, world.x - c.x)
      let delta = a1 - a0
      const step = ctx.shiftKey ? 45 : (ctx.snap.angleStepDeg ?? 15)
      if (step > 0) delta = snapAngleDelta(delta, step)
      drag.liveAngle = delta
      return patchesFromMatrix(
        drag.snapshots,
        rotateMatrixAbout(c, delta),
        (id) => ctx.doc.getEntity(id),
      )
    }

    const corner = drag.handle.scaleCorner
    if (!corner) return new Map()
    const anchor = scaleHandleWorld(drag.bounds, oppositeScaleCorner(corner))
    const { sx, sy } = scaleFactorsFromDrag(corner, anchor, drag.startWorld, world)
    return patchesFromMatrix(
      drag.snapshots,
      scaleMatrixAbout(anchor, sx, sy),
      (id) => ctx.doc.getEntity(id),
    )
  }
}

function selectedEntities(ctx: ToolContext): Entity[] {
  const out: Entity[] = []
  for (const id of ctx.selection.toArray()) {
    const e = ctx.doc.getEntity(id)
    if (e) out.push(e)
  }
  return out
}

function pointInAABB(p: { x: number; y: number }, box: AABB): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY
}

/** Walk to outermost group ancestor for object-mode selection. */
function resolveGroupRoot(ctx: ToolContext, id: EntityId): EntityId {
  let cur = id
  const guard = new Set<string>()
  while (true) {
    if (guard.has(cur)) break
    guard.add(cur)
    const e = ctx.doc.getEntity(cur)
    if (!e?.parentId) break
    const parent = ctx.doc.getEntity(e.parentId as EntityId)
    if (!parent || parent.type !== 'group') break
    cur = parent.id
  }
  return cur
}

/** Prefer group entities over their children when building transform snapshots. */
function expandTransformTargets(ctx: ToolContext): EntityId[] {
  const selected = ctx.selection.toArray()
  const set = new Set(selected)
  const out: EntityId[] = []
  for (const id of selected) {
    const e = ctx.doc.getEntity(id)
    if (!e || e.style.locked) continue
    if (e.parentId && set.has(e.parentId as EntityId)) continue
    out.push(id)
  }
  return out
}

function collectTransformSnapshots(ctx: ToolContext): Map<EntityId, Entity> {
  const snapshots = new Map<EntityId, Entity>()
  for (const id of expandTransformTargets(ctx)) {
    const e = ctx.doc.getEntity(id)
    if (e && !e.style.locked) snapshots.set(id, cloneEntitySnapshot(e))
  }
  return snapshots
}

export class PanTool implements Tool {
  readonly name = 'pan' as const
  private last: ScreenPoint | null = null
  private lastTime = 0
  private vx = 0
  private vy = 0
  private coasting = false

  isDragging(): boolean {
    return this.last !== null
  }

  isCoasting(): boolean {
    return this.coasting
  }

  stopInertia(): void {
    this.coasting = false
    this.vx = 0
    this.vy = 0
  }

  onPointerDown(screen: ScreenPoint, _w: WorldPoint, button: number): void {
    if (button !== 0) return
    this.stopInertia()
    this.last = screen
    this.lastTime = nowMs()
    this.vx = 0
    this.vy = 0
  }

  onPointerMove(screen: ScreenPoint, _w: WorldPoint, ctx: ToolContext): void {
    if (!this.last) return
    const t = nowMs()
    const dt = Math.max(1, t - this.lastTime) / 1000
    const dx = screen.x - this.last.x
    const dy = screen.y - this.last.y
    if (dx === 0 && dy === 0) return
    ctx.camera.pan(dx, dy)
    // EMA velocity in screen px/s
    const alpha = 0.35
    this.vx = this.vx * (1 - alpha) + (dx / dt) * alpha
    this.vy = this.vy * (1 - alpha) + (dy / dt) * alpha
    this.last = screen
    this.lastTime = t
    ctx.onCameraChanged?.()
  }

  onPointerUp(): void {
    this.last = null
    const speed = Math.hypot(this.vx, this.vy)
    this.coasting = speed > 40
    if (!this.coasting) {
      this.vx = 0
      this.vy = 0
    }
  }

  tick(dtSec: number, ctx: ToolContext): boolean {
    if (!this.coasting) return false
    const damp = ctx.snap.panDamping ?? 5
    const decay = Math.exp(-damp * dtSec)
    this.vx *= decay
    this.vy *= decay
    const dx = this.vx * dtSec
    const dy = this.vy * dtSec
    if (Math.hypot(this.vx, this.vy) < 8 || Math.hypot(dx, dy) < 0.05) {
      this.stopInertia()
      return false
    }
    ctx.camera.pan(dx, dy)
    ctx.onCameraChanged?.()
    return true
  }

  cancel(): void {
    this.last = null
    this.stopInertia()
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export class LineTool implements Tool {
  readonly name = 'line' as const
  private start: WorldPoint | null = null

  onPointerDown(_s: ScreenPoint, world: WorldPoint, button: number, ctx: ToolContext): void {
    if (button !== 0) return
    const snapped = snapWorld(ctx, world)
    if (!this.start) {
      this.start = snapped
      ctx.onPreview?.({ kind: 'line', a: snapped, b: snapped })
      return
    }
    let end = snapped
    if (ctx.ortho) end = { ...applyOrtho(this.start, end), __space: 'world' }
    const line = ctx.doc.createLine(this.start, end)
    if (ctx.addEntity) ctx.addEntity(line)
    else {
      const change = ctx.doc.add(line)
      ctx.commitChange?.(change)
    }
    ctx.selection.set([line.id])
    ctx.onEntityCreated?.(line.id)
    ctx.onSelectionEdited?.()
    ctx.onPreview?.({ kind: 'none' })
    this.start = null
  }

  onPointerMove(_s: ScreenPoint, world: WorldPoint, ctx: ToolContext): void {
    if (!this.start) return
    let end = snapWorld(ctx, world)
    if (ctx.ortho) end = { ...applyOrtho(this.start, end), __space: 'world' }
    ctx.onPreview?.({ kind: 'line', a: this.start, b: end })
  }

  onKeyDown(key: string, ctx: ToolContext): void {
    if (key === 'Escape') this.cancel(ctx)
  }

  cancel(ctx?: ToolContext): void {
    this.start = null
    ctx?.onPreview?.({ kind: 'none' })
  }
}

export class ToolManager {
  private tools = new Map<ToolName, Tool>()
  /** Tool currently receiving pointer events (may be temporary pan). */
  private active: Tool
  /** User-selected tool shown in UI (Space/MMB pan does not change this). */
  private sticky: ToolName = 'select'
  private readonly select = new SelectTool()
  private readonly pan = new PanTool()
  /** Tool to restore after temporary pan (space / middle button). */
  private resumeTool: ToolName | null = null
  private middlePanning = false
  private lastTick = 0

  constructor(private readonly ctx: ToolContext) {
    this.register(this.select)
    this.register(this.pan)
    this.register(new LineTool())
    // Lazy import avoided — register via side module in Editor/bootstrap
    this.active = this.select
  }

  /** Register the full builtin shape/text/image tool set. */
  registerBuiltinShapes(tools: Tool[]): void {
    for (const t of tools) this.register(t)
  }

  get context(): ToolContext {
    return this.ctx
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  activate(name: ToolName): void {
    this.pan.stopInertia()
    this.active.cancel?.(this.ctx)
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    this.active = tool
    this.sticky = name
    this.resumeTool = null
    this.middlePanning = false
    this.ctx.onToolChanged?.(name)
  }

  /** Sticky tool for UI (ignores temporary Space / middle-button pan). */
  getActive(): ToolName {
    return this.sticky
  }

  /** Tool currently handling input. */
  getEffectiveTool(): ToolName {
    return this.active.name
  }

  isPanning(): boolean {
    return this.active.name === 'pan' && this.pan.isDragging()
  }

  /** Drive pan inertia; call from Editor rAF. Returns true if still coasting. */
  tick(dtSec?: number): boolean {
    const t = nowMs()
    const dt = dtSec ?? (this.lastTick ? Math.min(0.05, (t - this.lastTick) / 1000) : 1 / 60)
    this.lastTick = t
    if (this.pan.isCoasting()) return this.pan.tick(dt, this.ctx)
    return false
  }

  setModifierKeys(opts: { shiftKey?: boolean; spaceKey?: boolean }): void {
    if (opts.shiftKey !== undefined) this.ctx.shiftKey = opts.shiftKey
    if (opts.spaceKey !== undefined) {
      const was = !!this.ctx.spaceKey
      this.ctx.spaceKey = opts.spaceKey
      if (opts.spaceKey && !was && this.active.name !== 'pan') {
        this.resumeTool = this.sticky
        this.active.cancel?.(this.ctx)
        this.active = this.pan
      } else if (!opts.spaceKey && was && this.resumeTool && !this.middlePanning) {
        const name = this.resumeTool
        this.resumeTool = null
        // Keep coasting on the pan tool instance even after releasing Space
        if (!this.pan.isCoasting()) {
          this.active.cancel?.(this.ctx)
          this.active = this.tools.get(name) ?? this.select
        } else {
          this.active = this.tools.get(name) ?? this.select
        }
      }
    }
  }

  pointerDown(screen: ScreenPoint, world: WorldPoint, button: number): void {
    this.pan.stopInertia()
    // Middle mouse → temporary pan
    if (button === 1) {
      if (this.active.name !== 'pan') {
        this.resumeTool = this.sticky
        this.active.cancel?.(this.ctx)
        this.active = this.pan
      }
      this.middlePanning = true
      this.active.onPointerDown?.(screen, world, 0, this.ctx)
      return
    }
    this.active.onPointerDown?.(screen, world, button, this.ctx)
  }

  pointerMove(screen: ScreenPoint, world: WorldPoint): void {
    this.active.onPointerMove?.(screen, world, this.ctx)
  }

  pointerUp(screen: ScreenPoint, world: WorldPoint, button: number): void {
    if (button === 1 || this.middlePanning) {
      this.active.onPointerUp?.(screen, world, 0, this.ctx)
      if (this.middlePanning) {
        this.middlePanning = false
        if (this.resumeTool && !this.ctx.spaceKey) {
          const name = this.resumeTool
          this.resumeTool = null
          this.active = this.tools.get(name) ?? this.select
        }
      }
      return
    }
    this.active.onPointerUp?.(screen, world, button, this.ctx)
  }

  doubleClick(screen: ScreenPoint, world: WorldPoint): void {
    this.active.onDoubleClick?.(screen, world, this.ctx)
  }

  keyDown(key: string): void {
    this.active.onKeyDown?.(key, this.ctx)
  }

  /** Handles for current selection (for overlay). */
  getSelectionHandles(): ControlHandle[] {
    return this.select.getOverlayHandles(this.ctx)
  }

  /** Object-mode frame (AABB + live rotation while rotating). */
  getSelectionFrame(): SelectionFrame | null {
    return this.select.getSelectionFrame(this.ctx)
  }

  /** Object-mode AABB frame around selection. */
  getSelectionFrameAABB(): AABB | null {
    return this.select.getSelectionFrameAABB(this.ctx)
  }

  getSelectMode(): SelectInteractionMode {
    return this.select.getMode()
  }

  /** Path-edit selected vertices (outer + holes). */
  getSelectedVertices(): readonly PathVertexRef[] {
    return this.select.getSelectedVertices()
  }

  /** World AABB of the active box-select marquee, if any. */
  getMarqueeAABB(): AABB | null {
    return this.select.getMarqueeAABB()
  }

  getAlignGuides(): AlignGuide[] {
    return this.select.getAlignGuides()
  }

  getHoverId(): EntityId | null {
    return this.active.name === 'select' ? this.select.getHoverId() : null
  }

  getHoverFrame(): AABB | null {
    return this.active.name === 'select' ? this.select.getHoverFrame(this.ctx) : null
  }

  clearHover(): void {
    this.select.clearHover()
  }

  setSelectionHitMode(mode: SelectionHitMode): void {
    this.ctx.selectionHitMode = mode
  }

  getSelectionHitMode(): SelectionHitMode {
    return this.ctx.selectionHitMode ?? 'bounds'
  }
}

function snapWorld(ctx: ToolContext, world: WorldPoint): WorldPoint {
  const candidates = collectSnaps(ctx.doc.getEntities(), world, {
    ...ctx.snap,
    worldPerPixel: 1 / Math.max(ctx.camera.getState().zoom, 1e-9),
  })
  return bestSnap(candidates)?.point ?? world
}

export { pickEntity } from './pick.js'
export type { AlignGuide } from './align-snap.js'
