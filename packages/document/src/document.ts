import {
  type AABB,
  type DocumentConfig,
  type Entity,
  type EntityId,
  type GroupEntity,
  type LayerId,
  type SessionToken,
  DEFAULT_DOCUMENT_CONFIG,
  IDENTITY_TRANSFORM,
  createEntityId,
  createLayerId,
  createSessionToken,
  emptyAABB,
  isValidAABB,
} from '@cadkit/types'
import {
  aggregateBounds,
  bakeParentLocalMatrix,
  entityWorldBounds,
  resolveWorldMatrix,
} from '@cadkit/geometry'

/**
 * Layer strategy:
 * - `line` / `fill`: vector engraver modes (G-code + canvas paint)
 * - `image`: raster-only layer (no line/fill coupling)
 */
export type LayerEngraveMode = 'line' | 'fill' | 'image'

/** Fill path styles when `engraveMode === 'fill'`. */
export type LayerFillStyle = 'bidirectional' | 'crossHatch'

/**
 * Per-layer GRBL / G-code machining parameters.
 * Stored on the layer only — entities do not carry their own G-code settings.
 */
export interface LayerGcodeParams {
  /** Line / fill engraver, or dedicated image layer. */
  mode: LayerEngraveMode
  /** Hatch spacing in document units (mm). Only for fill mode. */
  lineSpacing: number
  /** Hatch / fill path style. Only for fill mode. */
  fillStyle: LayerFillStyle
  /**
   * Hatch angle in degrees (0 = horizontal). Cross-hatch adds a second pass at +90°.
   * Only for fill mode.
   */
  fillAngle: number
  /** Laser power (S-word). Unclamped — firmware range varies. */
  power: number
  /** Feed rate in mm/min (F-word). */
  speed: number
  /** Number of passes over the same path. */
  passes: number
}

export const DEFAULT_LAYER_GCODE: LayerGcodeParams = {
  mode: 'line',
  lineSpacing: 0.1,
  fillStyle: 'bidirectional',
  fillAngle: 0,
  power: 500,
  speed: 1000,
  passes: 1,
}

const FILL_STYLE_SET = new Set<LayerFillStyle>(['bidirectional', 'crossHatch'])

function normalizeFillAngle(deg: unknown): number {
  if (!Number.isFinite(deg as number)) return DEFAULT_LAYER_GCODE.fillAngle
  // Normalize to [0, 180) — 180° is the same hatch family as 0°.
  let a = (deg as number) % 180
  if (a < 0) a += 180
  if (a >= 180 - 1e-9) a = 0
  return a
}

export function resolveLayerGcode(layer: Layer | undefined | null): LayerGcodeParams {
  const g = layer?.gcode
  const rawStyle = g?.fillStyle as string | undefined
  const fillStyle: LayerFillStyle =
    rawStyle && FILL_STYLE_SET.has(rawStyle as LayerFillStyle)
      ? (rawStyle as LayerFillStyle)
      : DEFAULT_LAYER_GCODE.fillStyle
  const mode: LayerEngraveMode =
    g?.mode === 'fill' ? 'fill' : g?.mode === 'image' ? 'image' : 'line'
  return {
    ...DEFAULT_LAYER_GCODE,
    ...g,
    mode,
    fillStyle,
    fillAngle: normalizeFillAngle(g?.fillAngle),
    lineSpacing: Number.isFinite(g?.lineSpacing) ? Math.max(1e-4, g!.lineSpacing) : DEFAULT_LAYER_GCODE.lineSpacing,
    power: Number.isFinite(g?.power) ? g!.power : DEFAULT_LAYER_GCODE.power,
    speed: Number.isFinite(g?.speed) ? Math.max(1, g!.speed) : DEFAULT_LAYER_GCODE.speed,
    passes: Number.isFinite(g?.passes) ? Math.max(1, Math.round(g!.passes)) : DEFAULT_LAYER_GCODE.passes,
  }
}

export function isImageLayer(layer: Layer | undefined | null): boolean {
  return resolveLayerGcode(layer).mode === 'image'
}

/** Whether an entity may live on the given layer (image layers are raster-only). */
export function layerAcceptsEntity(
  layer: Layer | undefined | null,
  entity: { type: string },
): boolean {
  const imageLayer = isImageLayer(layer)
  if (entity.type === 'image') return imageLayer
  if (entity.type === 'group') return !imageLayer
  return !imageLayer
}

export interface Layer {
  id: LayerId
  name: string
  visible: boolean
  locked: boolean
  color?: string
  /**
   * Engraver / G-code params. `mode` also controls canvas paint:
   * line → stroke only; fill → fill + stroke (open paths stay visible).
   */
  gcode?: LayerGcodeParams
}

export interface LayerAwarePaint {
  stroke: string
  fill?: string
  strokeWidth: number
}

/**
 * Resolve entity stroke/fill for display, honoring the layer engraver mode:
 * - `line`: keep stroke, drop fill
 * - `fill`: ensure a solid fill, **keep stroke** so open paths / text holes stay visible
 * - `image`: leave style as-is (rasters are not recolored by engraver mode)
 *
 * Canvas paint is not identical to G-code strategy: fill mode must not hide
 * strokes, or pen/polyline/bezier confirmations look blank.
 */
export function resolveLayerAwarePaint(
  layer: Layer | undefined | null,
  style: { stroke?: string; fill?: string; strokeWidth?: number },
): LayerAwarePaint {
  const stroke = style.stroke ?? layer?.color ?? '#32cd79'
  const strokeWidth = style.strokeWidth ?? 1
  const rawFill = style.fill
  const hasFill =
    !!rawFill &&
    rawFill !== 'none' &&
    rawFill !== 'transparent' &&
    !/00$/i.test(rawFill)
  const fill =
    hasFill || rawFill === undefined
      ? (rawFill ?? (layer?.color ? layerFillFromStroke(layer.color) : undefined))
      : rawFill

  const mode = resolveLayerGcode(layer).mode
  if (mode === 'image') {
    return { stroke, fill: rawFill, strokeWidth }
  }
  if (mode === 'line') {
    return { stroke, fill: undefined, strokeWidth }
  }

  // Fill mode: ensure fill from entity/stroke/layer, but keep stroke for outlines.
  const fillColor = hasFill && rawFill ? rawFill : layerFillFromStroke(stroke)
  return { stroke, fill: fillColor, strokeWidth }
}

export interface DocumentChange {
  added: EntityId[]
  updated: EntityId[]
  removed: EntityId[]
  beforeBounds: Map<EntityId, AABB>
  afterBounds: Map<EntityId, AABB>
}

export interface SerializedDocument {
  schemaVersion: number
  unit: DocumentConfig['unit']
  tolerance: number
  layers: Layer[]
  entities: Entity[]
  /** Per-layer stack order: index 0 = front. Omitted in older files. */
  entityOrder?: Record<string, EntityId[]>
}

function emptyChange(): DocumentChange {
  return {
    added: [],
    updated: [],
    removed: [],
    beforeBounds: new Map(),
    afterBounds: new Map(),
  }
}

/** Distinct palette for new layers (CAD-style layer colors). */
const LAYER_PALETTE = [
  '#32cd79',
  '#3b82f6',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#64748b',
] as const

function nextLayerColor(index: number): string {
  return LAYER_PALETTE[index % LAYER_PALETTE.length]!
}

/** Derive a solid fill from a stroke/layer color (optional alpha hex overrides opacity). */
export function layerFillFromStroke(stroke: string, alphaHex = 'ff'): string {
  if (/^#[0-9a-fA-F]{6}$/.test(stroke)) {
    return alphaHex.toLowerCase() === 'ff' ? stroke : `${stroke}${alphaHex}`
  }
  if (/^#[0-9a-fA-F]{8}$/.test(stroke)) {
    const base = stroke.slice(0, 7)
    return alphaHex.toLowerCase() === 'ff' ? base : base + alphaHex
  }
  return '#32cd79'
}

export class CadDocument {
  readonly sessionToken: SessionToken = createSessionToken()
  private readonly config: DocumentConfig
  private readonly entities = new Map<EntityId, Entity>()
  private readonly layers = new Map<LayerId, Layer>()
  /** Stable stack order: index 0 = top of the layers panel / drawn last (front). */
  private layerOrder: LayerId[] = []
  /** Per-layer entity stack: index 0 = front (drawn last / picked first). */
  private readonly entityOrder = new Map<LayerId, EntityId[]>()
  /** O(1) stack index within a layer (mirrors entityOrder). */
  private readonly entityStackIndex = new Map<EntityId, number>()
  private readonly boundsCache = new Map<EntityId, AABB>()
  private documentBoundsCache: AABB | null = null
  private version = 0
  private defaultLayerId: LayerId

  constructor(config: Partial<DocumentConfig> = {}) {
    this.config = { ...DEFAULT_DOCUMENT_CONFIG, ...config }
    this.defaultLayerId = createLayerId('0')
    this.layers.set(this.defaultLayerId, {
      id: this.defaultLayerId,
      name: '0',
      visible: true,
      locked: false,
      color: '#32cd79',
    })
    this.layerOrder = [this.defaultLayerId]
    this.entityOrder.set(this.defaultLayerId, [])
  }

  getConfig(): DocumentConfig {
    return this.config
  }

  getVersion(): number {
    return this.version
  }

  getDefaultLayerId(): LayerId {
    return this.defaultLayerId
  }

  setDefaultLayerId(id: LayerId): boolean {
    if (!this.layers.has(id)) return false
    this.defaultLayerId = id
    return true
  }

  getLayers(): Layer[] {
    return this.layerOrder
      .map((id) => this.layers.get(id))
      .filter((layer): layer is Layer => !!layer)
  }

  /** Front-to-back layer ids (same order as `getLayers()`). */
  getLayerOrder(): LayerId[] {
    return [...this.layerOrder]
  }

  getLayer(id: LayerId): Layer | undefined {
    return this.layers.get(id)
  }

  /** Index in stack order, or -1. Lower index = closer to front. */
  getLayerIndex(id: LayerId): number {
    return this.layerOrder.indexOf(id)
  }

  addLayer(input?: { name?: string; color?: string; visible?: boolean; locked?: boolean }): Layer {
    const id = createLayerId('layer')
    const layer: Layer = {
      id,
      name: input?.name?.trim() || `Layer ${this.layers.size}`,
      visible: input?.visible ?? true,
      locked: input?.locked ?? false,
      color: input?.color ?? nextLayerColor(this.layers.size),
    }
    this.layers.set(id, layer)
    this.entityOrder.set(id, [])
    // New layers appear at the front of the stack.
    this.layerOrder.unshift(id)
    this.version++
    return layer
  }

  /** Front-to-back entity ids on a layer (index 0 = front). */
  getEntityOrder(layerId: LayerId): EntityId[] {
    return [...(this.entityOrder.get(layerId) ?? [])]
  }

  /** Entity count on a layer's stack (O(1)). */
  getEntityOrderCount(layerId: LayerId): number {
    return this.entityOrder.get(layerId)?.length ?? 0
  }

  /** Index within the layer stack, or -1. Lower index = closer to front. O(1). */
  getEntityStackIndex(id: EntityId): number {
    return this.entityStackIndex.get(id) ?? -1
  }

  private reindexLayerOrder(layerId: LayerId): void {
    const list = this.entityOrder.get(layerId)
    if (!list) return
    for (let i = 0; i < list.length; i++) this.entityStackIndex.set(list[i]!, i)
  }

  private setLayerOrder(layerId: LayerId, next: EntityId[]): void {
    this.entityOrder.set(layerId, next)
    this.reindexLayerOrder(layerId)
  }

  /**
   * Reorder entities on one layer. `orderedIds` is front-to-back; extras ignored;
   * missing ids keep relative order at the end.
   */
  reorderEntitiesInLayer(layerId: LayerId, orderedIds: readonly EntityId[]): EntityId[] {
    if (!this.layers.has(layerId)) return []
    const current = this.entityOrder.get(layerId) ?? []
    const allowed = new Set(current)
    const seen = new Set<EntityId>()
    const next: EntityId[] = []
    for (const id of orderedIds) {
      if (!allowed.has(id) || seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    for (const id of current) {
      if (!seen.has(id)) next.push(id)
    }
    const same = next.length === current.length && next.every((id, i) => id === current[i])
    if (!same) {
      this.setLayerOrder(layerId, next)
      this.version++
    }
    return [...next]
  }

  /** Snapshot of every layer's entity stack (for undo). */
  getEntityOrderSnapshot(): Record<string, EntityId[]> {
    const out: Record<string, EntityId[]> = {}
    for (const [layerId, ids] of this.entityOrder) out[layerId] = [...ids]
    return out
  }

  /** Restore a full entity-order snapshot (undo / JSON load). */
  restoreEntityOrderSnapshot(snapshot: Record<string, EntityId[]>): void {
    for (const layerId of this.layers.keys()) {
      const raw = snapshot[layerId] ?? []
      const existing = new Set(
        [...this.entities.values()].filter((e) => e.layerId === layerId).map((e) => e.id),
      )
      const seen = new Set<EntityId>()
      const next: EntityId[] = []
      for (const id of raw) {
        if (!existing.has(id) || seen.has(id)) continue
        seen.add(id)
        next.push(id)
      }
      for (const id of existing) {
        if (!seen.has(id)) next.push(id)
      }
      this.setLayerOrder(layerId, next)
    }
    this.version++
  }

  bringToFront(ids: readonly EntityId[]): boolean {
    return this.moveStackBlock(ids, 'front')
  }

  sendToBack(ids: readonly EntityId[]): boolean {
    return this.moveStackBlock(ids, 'back')
  }

  bringForward(ids: readonly EntityId[]): boolean {
    return this.moveStackBlock(ids, 'forward')
  }

  sendBackward(ids: readonly EntityId[]): boolean {
    return this.moveStackBlock(ids, 'backward')
  }

  private moveStackBlock(
    ids: readonly EntityId[],
    mode: 'front' | 'back' | 'forward' | 'backward',
  ): boolean {
    const byLayer = new Map<LayerId, EntityId[]>()
    for (const id of ids) {
      const e = this.entities.get(id)
      if (!e) continue
      const list = byLayer.get(e.layerId) ?? []
      list.push(id)
      byLayer.set(e.layerId, list)
    }
    let changed = false
    for (const [layerId, selectedList] of byLayer) {
      const order = this.entityOrder.get(layerId) ?? []
      if (!order.length) continue
      const selected = new Set(selectedList.filter((id) => order.includes(id)))
      if (!selected.size) continue
      const block = order.filter((id) => selected.has(id))
      const rest = order.filter((id) => !selected.has(id))
      const minIdx = order.findIndex((id) => selected.has(id))
      let insertAt = minIdx
      if (mode === 'front') insertAt = 0
      else if (mode === 'back') insertAt = rest.length
      else if (mode === 'forward') insertAt = Math.max(0, minIdx - 1)
      else insertAt = Math.min(rest.length, minIdx + 1)
      const next = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)]
      if (next.every((id, i) => id === order[i])) continue
      this.setLayerOrder(layerId, next)
      changed = true
    }
    if (changed) this.version++
    return changed
  }

  private insertEntityFront(layerId: LayerId, id: EntityId): void {
    let list = this.entityOrder.get(layerId)
    if (!list) {
      list = []
      this.entityOrder.set(layerId, list)
    }
    const idx = list.indexOf(id)
    if (idx >= 0) list.splice(idx, 1)
    list.unshift(id)
    this.reindexLayerOrder(layerId)
  }

  private removeEntityFromOrder(id: EntityId, layerId?: LayerId): void {
    if (layerId) {
      const list = this.entityOrder.get(layerId)
      if (!list) return
      const idx = list.indexOf(id)
      if (idx >= 0) {
        list.splice(idx, 1)
        this.entityStackIndex.delete(id)
        this.reindexLayerOrder(layerId)
      }
      return
    }
    for (const [lid, list] of this.entityOrder) {
      const idx = list.indexOf(id)
      if (idx >= 0) {
        list.splice(idx, 1)
        this.entityStackIndex.delete(id)
        this.reindexLayerOrder(lid)
        return
      }
    }
  }

  private moveEntityOrderToLayer(id: EntityId, fromLayer: LayerId, toLayer: LayerId): void {
    if (fromLayer === toLayer) return
    this.removeEntityFromOrder(id, fromLayer)
    this.insertEntityFront(toLayer, id)
  }

  /**
   * Reorder layers. `orderedIds` must be a permutation of existing layer ids
   * (extras ignored; missing ids keep their relative order at the end).
   */
  reorderLayers(orderedIds: readonly LayerId[]): LayerId[] {
    const seen = new Set<LayerId>()
    const next: LayerId[] = []
    for (const id of orderedIds) {
      if (!this.layers.has(id) || seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    for (const id of this.layerOrder) {
      if (!seen.has(id) && this.layers.has(id)) next.push(id)
    }
    const same =
      next.length === this.layerOrder.length && next.every((id, i) => id === this.layerOrder[i])
    if (!same) {
      this.layerOrder = next
      this.version++
    }
    return [...this.layerOrder]
  }

  updateLayer(
    id: LayerId,
    patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'color' | 'gcode'>>,
  ): Layer | null {
    const prev = this.layers.get(id)
    if (!prev) return null
    const next: Layer = {
      ...prev,
      ...patch,
      id: prev.id,
      name: patch.name !== undefined ? patch.name.trim() || prev.name : prev.name,
      gcode:
        patch.gcode !== undefined
          ? { ...resolveLayerGcode(prev), ...patch.gcode }
          : prev.gcode,
    }
    this.layers.set(id, next)
    this.version++
    return next
  }

  /**
   * Remove a layer. Entities move to a compatible fallback (image → image layer,
   * vectors → line/fill layer). Refuses to delete the last image layer while it
   * still holds images. The last remaining layer cannot be removed.
   */
  removeLayer(id: LayerId, fallbackId?: LayerId): boolean {
    if (!this.layers.has(id) || this.layers.size <= 1) return false
    const removing = this.layers.get(id)!
    const others = [...this.layers.entries()].filter(([lid]) => lid !== id)
    const hasImages = [...this.entities.values()].some(
      (e) => e.layerId === id && e.type === 'image',
    )
    if (isImageLayer(removing) && hasImages && !others.some(([, l]) => isImageLayer(l))) {
      return false
    }

    const preferred =
      fallbackId && this.layers.has(fallbackId) && fallbackId !== id ? fallbackId : null
    const vectorDest =
      (preferred && !isImageLayer(this.layers.get(preferred)) ? preferred : null) ??
      others.find(([, l]) => !isImageLayer(l))?.[0] ??
      others[0]?.[0]
    const imageDest =
      (preferred && isImageLayer(this.layers.get(preferred)) ? preferred : null) ??
      others.find(([, l]) => isImageLayer(l))?.[0] ??
      vectorDest
    if (!vectorDest || !imageDest) return false

    const moving = this.entityOrder.get(id) ?? []
    const byDest = new Map<LayerId, EntityId[]>()
    for (const eid of moving) {
      const entity = this.entities.get(eid)
      if (!entity) continue
      const dest = entity.type === 'image' ? imageDest : vectorDest
      this.entities.set(entity.id, { ...entity, layerId: dest, version: entity.version + 1 })
      const list = byDest.get(dest) ?? []
      list.push(eid)
      byDest.set(dest, list)
    }
    // Also catch entities that were on the layer but missing from order.
    for (const entity of this.entities.values()) {
      if (entity.layerId !== id) continue
      const dest = entity.type === 'image' ? imageDest : vectorDest
      this.entities.set(entity.id, { ...entity, layerId: dest, version: entity.version + 1 })
      const list = byDest.get(dest) ?? []
      if (!list.includes(entity.id)) list.push(entity.id)
      byDest.set(dest, list)
    }

    for (const [dest, ids] of byDest) {
      const destOrder = [...(this.entityOrder.get(dest) ?? [])]
      const movingSet = new Set(ids)
      const kept = destOrder.filter((eid) => !movingSet.has(eid))
      this.setLayerOrder(dest, [...ids, ...kept])
    }
    this.entityOrder.delete(id)
    this.layers.delete(id)
    this.layerOrder = this.layerOrder.filter((lid) => lid !== id)
    if (this.defaultLayerId === id) {
      this.defaultLayerId = vectorDest
    }
    this.version++
    this.invalidateDocumentBounds()
    return true
  }

  getEntity(id: EntityId): Entity | undefined {
    return this.entities.get(id)
  }

  getEntities(): Entity[] {
    return [...this.entities.values()]
  }

  getEntityIds(): EntityId[] {
    return [...this.entities.keys()]
  }

  count(): number {
    return this.entities.size
  }

  getBounds(id: EntityId): AABB | undefined {
    return this.boundsCache.get(id)
  }

  getDocumentBounds(): AABB {
    if (!this.documentBoundsCache) {
      this.documentBoundsCache = aggregateBounds([...this.boundsCache.values()])
    }
    return this.documentBoundsCache
  }

  private invalidateDocumentBounds(): void {
    this.documentBoundsCache = null
  }

  private computeWorldBounds(entity: Entity): AABB {
    if (entity.type === 'group') {
      const boxes = entity.children
        .map((id) => {
          const child = this.entities.get(id)
          return child ? this.computeWorldBounds(child) : undefined
        })
        .filter((b): b is AABB => !!b && isValidAABB(b))
      return aggregateBounds(boxes)
    }
    const m = resolveWorldMatrix(entity, (id) => this.entities.get(id))
    return entityWorldBounds(entity, m)
  }

  private attachToParent(childId: EntityId, parentId: EntityId): void {
    const parent = this.entities.get(parentId)
    if (!parent || parent.type !== 'group') return
    if (parent.children.includes(childId)) return
    const next: GroupEntity = {
      ...parent,
      children: [...parent.children, childId],
      version: parent.version + 1,
    }
    this.entities.set(parentId, next)
  }

  private detachFromParent(childId: EntityId, parentId: EntityId | undefined): DocumentChange {
    const change = emptyChange()
    if (!parentId) return change
    const parent = this.entities.get(parentId)
    if (!parent || parent.type !== 'group') return change
    if (!parent.children.includes(childId)) return change
    const before = this.boundsCache.get(parentId) ?? emptyAABB()
    const next: GroupEntity = {
      ...parent,
      children: parent.children.filter((c) => c !== childId),
      version: parent.version + 1,
    }
    this.entities.set(parentId, next)
    const after = this.computeWorldBounds(next)
    this.boundsCache.set(parentId, after)
    change.updated.push(parentId)
    change.beforeBounds.set(parentId, before)
    change.afterBounds.set(parentId, after)
    return change
  }

  add(entity: Entity): DocumentChange {
    if (!entity.layerId) entity.layerId = this.defaultLayerId
    const before = emptyAABB()
    this.entities.set(entity.id, entity)
    this.insertEntityFront(entity.layerId, entity.id)
    if (entity.parentId) this.attachToParent(entity.id, entity.parentId as EntityId)
    const after = this.computeWorldBounds(entity)
    this.boundsCache.set(entity.id, after)
    if (entity.parentId) this.recomputeGroupBounds(entity.parentId as EntityId)
    this.version++
    this.invalidateDocumentBounds()
    return {
      added: [entity.id],
      updated: [],
      removed: [],
      beforeBounds: new Map([[entity.id, before]]),
      afterBounds: new Map([[entity.id, after]]),
    }
  }

  /** Batch insert with a single version bump. */
  addMany(entities: Entity[]): DocumentChange {
    const change = emptyChange()
    if (entities.length === 0) return change
    const prependByLayer = new Map<LayerId, EntityId[]>()
    for (const entity of entities) {
      if (!entity.layerId) entity.layerId = this.defaultLayerId
      const before = emptyAABB()
      this.entities.set(entity.id, entity)
      const bucket = prependByLayer.get(entity.layerId) ?? []
      bucket.push(entity.id)
      prependByLayer.set(entity.layerId, bucket)
      change.added.push(entity.id)
      change.beforeBounds.set(entity.id, before)
    }
    // One splice per layer: last-in-batch becomes front (matches repeated unshift).
    for (const [layerId, ids] of prependByLayer) {
      const existing = this.entityOrder.get(layerId) ?? []
      const incoming = new Set(ids)
      const kept = existing.filter((id) => !incoming.has(id))
      const block: EntityId[] = []
      for (let i = ids.length - 1; i >= 0; i--) block.push(ids[i]!)
      this.setLayerOrder(layerId, [...block, ...kept])
    }
    // Second pass: parent links + bounds (parents may appear later in the list)
    for (const entity of entities) {
      if (entity.parentId) this.attachToParent(entity.id, entity.parentId as EntityId)
    }
    for (const entity of entities) {
      const live = this.entities.get(entity.id) ?? entity
      const after = this.computeWorldBounds(live)
      this.boundsCache.set(entity.id, after)
      change.afterBounds.set(entity.id, after)
      if (live.parentId) this.recomputeGroupBounds(live.parentId as EntityId)
    }
    this.version++
    this.invalidateDocumentBounds()
    return change
  }

  /** Replace an entity in-place with an exact snapshot (used by history undo). */
  replace(entity: Entity): DocumentChange {
    const prev = this.entities.get(entity.id)
    const before = this.boundsCache.get(entity.id) ?? emptyAABB()
    this.entities.set(entity.id, structuredClone(entity))
    if (!prev) this.insertEntityFront(entity.layerId, entity.id)
    else if (prev.layerId !== entity.layerId) {
      this.moveEntityOrderToLayer(entity.id, prev.layerId, entity.layerId)
    }
    const after = this.computeWorldBounds(entity)
    this.boundsCache.set(entity.id, after)
    if (entity.parentId) this.recomputeGroupBounds(entity.parentId as EntityId)
    else if (entity.type === 'group') this.recomputeGroupBounds(entity.id)
    // If parent linkage changed, fix children lists
    if (prev?.parentId && prev.parentId !== entity.parentId) {
      this.detachFromParent(entity.id, prev.parentId as EntityId)
    }
    if (entity.parentId) this.attachToParent(entity.id, entity.parentId as EntityId)
    this.version++
    this.invalidateDocumentBounds()
    return {
      added: prev ? [] : [entity.id],
      updated: prev ? [entity.id] : [],
      removed: [],
      beforeBounds: new Map([[entity.id, before]]),
      afterBounds: new Map([[entity.id, after]]),
    }
  }

  update(id: EntityId, patch: Partial<Entity>): DocumentChange | null {
    const prev = this.entities.get(id)
    if (!prev) return null
    const before = this.boundsCache.get(id) ?? emptyAABB()
    // Allow explicit type changes (e.g. circle → arc via start/end handles).
    const next = {
      ...prev,
      ...patch,
      id: prev.id,
      type: (patch as { type?: Entity['type'] }).type ?? prev.type,
      version: prev.version + 1,
    } as Entity
    this.entities.set(id, next)
    if (patch.layerId && patch.layerId !== prev.layerId) {
      this.moveEntityOrderToLayer(id, prev.layerId, patch.layerId)
    }
    const after = this.computeWorldBounds(next)
    this.boundsCache.set(id, after)
    const updated = [id]
    const beforeBounds = new Map([[id, before]])
    const afterBounds = new Map([[id, after]])
    if (next.type === 'group' && patch.transform) {
      for (const childId of next.children) {
        const child = this.entities.get(childId)
        if (!child) continue
        const cb = this.boundsCache.get(childId) ?? emptyAABB()
        const ca = this.computeWorldBounds(child)
        this.boundsCache.set(childId, ca)
        updated.push(childId)
        beforeBounds.set(childId, cb)
        afterBounds.set(childId, ca)
        if (child.type === 'group') {
          this.refreshDescendantBounds(child, updated, beforeBounds, afterBounds)
        }
      }
    }
    if (next.parentId) this.recomputeGroupBounds(next.parentId as EntityId)
    else if (next.type === 'group') this.recomputeGroupBounds(next.id)
    this.version++
    this.invalidateDocumentBounds()
    return {
      added: [],
      updated,
      removed: [],
      beforeBounds,
      afterBounds,
    }
  }

  private refreshDescendantBounds(
    group: GroupEntity,
    updated: EntityId[],
    beforeBounds: Map<EntityId, AABB>,
    afterBounds: Map<EntityId, AABB>,
  ): void {
    for (const childId of group.children) {
      const child = this.entities.get(childId)
      if (!child) continue
      const cb = this.boundsCache.get(childId) ?? emptyAABB()
      const ca = this.computeWorldBounds(child)
      this.boundsCache.set(childId, ca)
      if (!updated.includes(childId)) updated.push(childId)
      beforeBounds.set(childId, cb)
      afterBounds.set(childId, ca)
      if (child.type === 'group') this.refreshDescendantBounds(child, updated, beforeBounds, afterBounds)
    }
  }

  /**
   * Remove a single node without cascading into children.
   * Groups must be empty (or children already reparented) before leaf removal.
   */
  removeLeaf(id: EntityId): DocumentChange | null {
    const prev = this.entities.get(id)
    if (!prev) return null
    if (prev.type === 'group' && prev.children.length > 0) {
      throw new Error(
        `removeLeaf(${id}): group still has ${prev.children.length} children; use removeSubtree or ungroup`,
      )
    }
    const before = this.boundsCache.get(id) ?? emptyAABB()
    const parentChange = this.detachFromParent(id, prev.parentId as EntityId | undefined)
    this.removeEntityFromOrder(id, prev.layerId)
    this.entities.delete(id)
    this.boundsCache.delete(id)
    this.version++
    this.invalidateDocumentBounds()
    return {
      added: [],
      updated: parentChange.updated,
      removed: [id],
      beforeBounds: new Map([[id, before], ...parentChange.beforeBounds]),
      afterBounds: new Map([[id, emptyAABB()], ...parentChange.afterBounds]),
    }
  }

  /** Recursively remove a node and its entire subtree. */
  removeSubtree(id: EntityId): DocumentChange | null {
    const root = this.entities.get(id)
    if (!root) return null

    const removed: EntityId[] = []
    const beforeBounds = new Map<EntityId, AABB>()
    const afterBounds = new Map<EntityId, AABB>()

    const collect = (eid: EntityId): void => {
      const e = this.entities.get(eid)
      if (!e) return
      if (e.type === 'group') {
        for (const childId of [...e.children]) collect(childId)
      }
      beforeBounds.set(eid, this.boundsCache.get(eid) ?? emptyAABB())
      afterBounds.set(eid, emptyAABB())
      removed.push(eid)
    }
    collect(id)

    const parentChange = this.detachFromParent(id, root.parentId as EntityId | undefined)

    for (const eid of removed) {
      const e = this.entities.get(eid)
      if (e) this.removeEntityFromOrder(eid, e.layerId)
      this.entities.delete(eid)
      this.boundsCache.delete(eid)
    }

    this.version++
    this.invalidateDocumentBounds()
    return {
      added: [],
      updated: parentChange.updated,
      removed,
      beforeBounds: new Map([...beforeBounds, ...parentChange.beforeBounds]),
      afterBounds: new Map([...afterBounds, ...parentChange.afterBounds]),
    }
  }

  /** Cascading remove (subtree). Prefer removeLeaf / removeSubtree for clarity. */
  remove(id: EntityId): DocumentChange | null {
    return this.removeSubtree(id)
  }

  /**
   * Drop every entity in O(1) map clears (keeps layers).
   * Intended for dev seed / import replace — pair with scene.rebuildIndex() + history.clear().
   */
  clearEntities(): void {
    this.entities.clear()
    this.boundsCache.clear()
    this.entityStackIndex.clear()
    for (const layerId of this.entityOrder.keys()) this.entityOrder.set(layerId, [])
    this.invalidateDocumentBounds()
    this.version++
  }

  /** Collect deep clones of a subtree (root first, then descendants). */
  snapshotSubtree(id: EntityId): Entity[] {
    const root = this.entities.get(id)
    if (!root) return []
    const out: Entity[] = []
    const walk = (eid: EntityId): void => {
      const e = this.entities.get(eid)
      if (!e) return
      out.push(structuredClone(e))
      if (e.type === 'group') {
        for (const childId of e.children) walk(childId)
      }
    }
    walk(id)
    return out
  }

  group(childIds: EntityId[], group: GroupEntity): DocumentChange {
    const change = emptyChange()
    const unique = [...new Set(childIds)]
    // Detach from previous parents first
    for (const id of unique) {
      const e = this.entities.get(id)
      if (!e?.parentId) continue
      const detach = this.detachFromParent(id, e.parentId as EntityId)
      change.updated.push(...detach.updated)
      for (const [k, v] of detach.beforeBounds) change.beforeBounds.set(k, v)
      for (const [k, v] of detach.afterBounds) change.afterBounds.set(k, v)
    }

    for (const id of unique) {
      const e = this.entities.get(id)
      if (!e) continue
      const before = this.boundsCache.get(id) ?? emptyAABB()
      const next = { ...e, parentId: group.id, version: e.version + 1 } as Entity
      this.entities.set(id, next)
      change.updated.push(id)
      change.beforeBounds.set(id, before)
    }

    group.children = [...unique]
    group.transform = group.transform ?? IDENTITY_TRANSFORM
    const addChange = this.add(group)
    // add bumps version; fold into change
    change.added.push(...addChange.added)
    for (const [k, v] of addChange.beforeBounds) change.beforeBounds.set(k, v)
    for (const [k, v] of addChange.afterBounds) change.afterBounds.set(k, v)

    for (const id of unique) {
      const e = this.entities.get(id)
      if (!e) continue
      const after = this.computeWorldBounds(e)
      this.boundsCache.set(id, after)
      change.afterBounds.set(id, after)
    }
    this.recomputeGroupBounds(group.id)
    const gb = this.boundsCache.get(group.id)
    if (gb) change.afterBounds.set(group.id, gb)
    this.invalidateDocumentBounds()
    return change
  }

  /**
   * Dissolve a group: bake group local matrix into direct children so world geometry
   * does not jump. Leaves get geometry baked + identity transform; nested groups
   * keep local geometry and composed transform. Children reparent to the group's parent.
   */
  ungroup(groupId: EntityId): DocumentChange | null {
    const group = this.entities.get(groupId)
    if (!group || group.type !== 'group') return null

    const beforeGroup = this.boundsCache.get(groupId) ?? emptyAABB()
    const children = [...group.children]
    const groupLocal = group.transform as unknown as Parameters<typeof bakeParentLocalMatrix>[1]
    const newParentId = group.parentId as EntityId | undefined

    const change = emptyChange()
    change.removed.push(groupId)
    change.beforeBounds.set(groupId, beforeGroup)
    change.afterBounds.set(groupId, emptyAABB())

    for (const id of children) {
      const e = this.entities.get(id)
      if (!e) continue
      const before = this.boundsCache.get(id) ?? emptyAABB()
      let next = bakeParentLocalMatrix(e, groupLocal)
      if (newParentId) next = { ...next, parentId: newParentId }
      else {
        const { parentId: _drop, ...rest } = next as Entity & { parentId?: EntityId }
        next = rest as Entity
      }
      this.entities.set(id, next)
      if (newParentId) this.attachToParent(id, newParentId)
      const after = this.computeWorldBounds(next)
      this.boundsCache.set(id, after)
      change.updated.push(id)
      change.beforeBounds.set(id, before)
      change.afterBounds.set(id, after)
    }

    // Remove empty group node (children already reparented)
    const emptyGroup: GroupEntity = { ...group, children: [] }
    this.entities.set(groupId, emptyGroup)
    const detach = this.detachFromParent(groupId, group.parentId as EntityId | undefined)
    change.updated.push(...detach.updated)
    for (const [k, v] of detach.beforeBounds) change.beforeBounds.set(k, v)
    for (const [k, v] of detach.afterBounds) change.afterBounds.set(k, v)
    this.entities.delete(groupId)
    this.boundsCache.delete(groupId)

    if (newParentId) this.recomputeGroupBounds(newParentId)
    this.version++
    this.invalidateDocumentBounds()
    return change
  }

  toJSON(): SerializedDocument {
    return {
      schemaVersion: this.config.schemaVersion,
      unit: this.config.unit,
      tolerance: this.config.tolerance,
      layers: this.getLayers(),
      entities: this.getEntities(),
      entityOrder: this.getEntityOrderSnapshot(),
    }
  }

  static fromJSON(data: SerializedDocument): CadDocument {
    const doc = new CadDocument({
      schemaVersion: data.schemaVersion,
      unit: data.unit,
      tolerance: data.tolerance,
    })
    doc.layers.clear()
    doc.layerOrder = []
    doc.entityOrder.clear()
    for (const layer of data.layers) {
      doc.layers.set(layer.id, layer)
      doc.layerOrder.push(layer.id)
      doc.entityOrder.set(layer.id, [])
    }
    if (data.layers[0]) doc.defaultLayerId = data.layers[0].id
    else if (doc.layerOrder[0]) doc.defaultLayerId = doc.layerOrder[0]!
    doc.addMany(data.entities)
    if (data.entityOrder) {
      doc.restoreEntityOrderSnapshot(data.entityOrder)
    } else {
      // Legacy: entities array order per layer = front → back.
      const legacy: Record<string, EntityId[]> = {}
      for (const layerId of doc.layerOrder) legacy[layerId] = []
      for (const e of data.entities) {
        const lid = e.layerId
        if (!legacy[lid]) legacy[lid] = []
        legacy[lid]!.push(e.id)
      }
      doc.restoreEntityOrderSnapshot(legacy)
    }
    return doc
  }

  createLine(start: { x: number; y: number }, end: { x: number; y: number }, style: Entity['style'] = {}): Entity {
    const layerColor = this.layers.get(this.defaultLayerId)?.color ?? '#32cd79'
    return {
      id: createEntityId('line'),
      type: 'line',
      layerId: this.defaultLayerId,
      style: { stroke: layerColor, strokeWidth: 1, ...style },
      transform: [1, 0, 0, 1, 0, 0],
      version: 1,
      start,
      end,
    }
  }

  private recomputeGroupBounds(parentId?: EntityId): void {
    if (!parentId) return
    const parent = this.entities.get(parentId)
    if (!parent || parent.type !== 'group') return
    const boxes = parent.children
      .map((id) => this.boundsCache.get(id) ?? (this.entities.get(id) ? this.computeWorldBounds(this.entities.get(id)!) : undefined))
      .filter((b): b is AABB => !!b && isValidAABB(b))
    for (const id of parent.children) {
      const child = this.entities.get(id)
      if (!child) continue
      const b = this.computeWorldBounds(child)
      this.boundsCache.set(id, b)
    }
    this.boundsCache.set(parentId, aggregateBounds(
      parent.children
        .map((id) => this.boundsCache.get(id))
        .filter((b): b is AABB => !!b && isValidAABB(b)),
    ))
    if (parent.parentId) this.recomputeGroupBounds(parent.parentId as EntityId)
  }
}
