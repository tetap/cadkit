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

export interface Layer {
  id: LayerId
  name: string
  visible: boolean
  locked: boolean
  color?: string
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
    return [...this.layers.values()]
  }

  getLayer(id: LayerId): Layer | undefined {
    return this.layers.get(id)
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
    this.version++
    return layer
  }

  updateLayer(
    id: LayerId,
    patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'color'>>,
  ): Layer | null {
    const prev = this.layers.get(id)
    if (!prev) return null
    const next: Layer = {
      ...prev,
      ...patch,
      id: prev.id,
      name: patch.name !== undefined ? patch.name.trim() || prev.name : prev.name,
    }
    this.layers.set(id, next)
    this.version++
    return next
  }

  /**
   * Remove a layer. Entities on it move to `fallbackId` (default layer).
   * The last remaining layer cannot be removed.
   */
  removeLayer(id: LayerId, fallbackId?: LayerId): boolean {
    if (!this.layers.has(id) || this.layers.size <= 1) return false
    const dest =
      fallbackId && this.layers.has(fallbackId) && fallbackId !== id
        ? fallbackId
        : [...this.layers.keys()].find((lid) => lid !== id)
    if (!dest) return false
    for (const entity of this.entities.values()) {
      if (entity.layerId === id) {
        this.entities.set(entity.id, { ...entity, layerId: dest, version: entity.version + 1 })
      }
    }
    this.layers.delete(id)
    if (this.defaultLayerId === id) this.defaultLayerId = dest
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
    for (const entity of entities) {
      if (!entity.layerId) entity.layerId = this.defaultLayerId
      const before = emptyAABB()
      this.entities.set(entity.id, entity)
      change.added.push(entity.id)
      change.beforeBounds.set(entity.id, before)
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
    const next = { ...prev, ...patch, id: prev.id, type: prev.type, version: prev.version + 1 } as Entity
    this.entities.set(id, next)
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
      layers: [...this.layers.values()],
      entities: this.getEntities(),
    }
  }

  static fromJSON(data: SerializedDocument): CadDocument {
    const doc = new CadDocument({
      schemaVersion: data.schemaVersion,
      unit: data.unit,
      tolerance: data.tolerance,
    })
    for (const layer of data.layers) {
      doc.layers.set(layer.id, layer)
    }
    if (data.layers[0]) doc.defaultLayerId = data.layers[0].id
    doc.addMany(data.entities)
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
