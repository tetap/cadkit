import type { CadDocument, DocumentChange } from '@cadkit/document'
import type { Entity, EntityId, GroupEntity, LayerId } from '@cadkit/types'

function emptyStackChange(): DocumentChange {
  return {
    added: [],
    updated: [],
    removed: [],
    beforeBounds: new Map(),
    afterBounds: new Map(),
  }
}

export type EntityStackOp = 'front' | 'back' | 'forward' | 'backward' | 'reorder'

export class ReorderEntitiesCommand implements Command {
  readonly name = 'reorderEntities'
  private before: Record<string, EntityId[]> | null = null
  private after: Record<string, EntityId[]> | null = null

  constructor(
    private readonly op: EntityStackOp,
    private readonly ids: readonly EntityId[],
    private readonly layerId?: LayerId,
    private readonly orderedIds?: readonly EntityId[],
  ) {}

  execute(doc: CadDocument): DocumentChange | null {
    if (!this.before) this.before = doc.getEntityOrderSnapshot()
    let changed = false
    if (this.op === 'reorder') {
      if (!this.layerId || !this.orderedIds) return null
      const prev = doc.getEntityOrder(this.layerId)
      const next = doc.reorderEntitiesInLayer(this.layerId, this.orderedIds)
      changed = next.length !== prev.length || next.some((id, i) => id !== prev[i])
    } else if (this.op === 'front') changed = doc.bringToFront(this.ids)
    else if (this.op === 'back') changed = doc.sendToBack(this.ids)
    else if (this.op === 'forward') changed = doc.bringForward(this.ids)
    else changed = doc.sendBackward(this.ids)
    if (!changed && this.after == null) return null
    this.after = doc.getEntityOrderSnapshot()
    // Non-geometry change: empty DocumentChange keeps history entry; Editor notifies scene.
    return emptyStackChange()
  }

  undo(doc: CadDocument): void {
    if (this.before) doc.restoreEntityOrderSnapshot(this.before)
  }
}

export interface Command {
  readonly name: string
  readonly coalesceKey?: string
  execute(doc: CadDocument): DocumentChange | DocumentChange[] | null
  undo(doc: CadDocument): void
}

export class AddEntityCommand implements Command {
  readonly name = 'addEntity'
  private snapshot: Entity

  constructor(entity: Entity) {
    this.snapshot = structuredClone(entity)
  }

  execute(doc: CadDocument): DocumentChange {
    return doc.add(structuredClone(this.snapshot))
  }

  undo(doc: CadDocument): void {
    const e = doc.getEntity(this.snapshot.id)
    if (!e) return
    if (e.type === 'group') doc.removeSubtree(e.id)
    else doc.removeLeaf(e.id)
  }
}

export class RemoveEntityCommand implements Command {
  readonly name = 'removeEntity'
  private snapshots: Entity[] = []

  constructor(private readonly id: EntityId) {}

  execute(doc: CadDocument): DocumentChange | null {
    this.snapshots = doc.snapshotSubtree(this.id)
    if (this.snapshots.length === 0) return null
    return doc.removeSubtree(this.id)
  }

  undo(doc: CadDocument): void {
    if (this.snapshots.length === 0) return
    doc.addMany(this.snapshots.map((e) => structuredClone(e)))
  }
}

/** Explicit alias with full subtree snapshot semantics. */
export class RemoveSubtreeCommand extends RemoveEntityCommand {}

export class UpdateEntityCommand implements Command {
  readonly name = 'updateEntity'
  readonly coalesceKey: string
  private before: Entity | null = null
  private afterPatch: Partial<Entity>

  constructor(
    private readonly id: EntityId,
    patch: Partial<Entity>,
    coalesceKey?: string,
  ) {
    this.afterPatch = patch
    this.coalesceKey = coalesceKey ?? `update:${id}`
  }

  execute(doc: CadDocument): DocumentChange | null {
    const entity = doc.getEntity(this.id)
    if (!entity) return null
    if (!this.before) this.before = structuredClone(entity)
    return doc.update(this.id, this.afterPatch)
  }

  undo(doc: CadDocument): void {
    if (this.before) doc.replace(structuredClone(this.before))
  }

  /** Merge continuous transform updates (e.g. drag). */
  coalesce(next: UpdateEntityCommand): UpdateEntityCommand {
    this.afterPatch = { ...this.afterPatch, ...next.afterPatch }
    return this
  }
}

/**
 * Multi-entity mutation as a single undo step (selection drag / multi-handle).
 * Coalesce merges later patches while keeping the first before-snapshots.
 */
export class MutateEntitiesCommand implements Command {
  readonly name = 'mutateEntities'
  readonly coalesceKey: string
  private readonly before = new Map<EntityId, Entity>()
  private readonly after = new Map<EntityId, Entity>()
  private patches: Map<EntityId, Partial<Entity>>

  constructor(patches: Map<EntityId, Partial<Entity>>, coalesceKey: string) {
    this.patches = patches
    this.coalesceKey = coalesceKey
  }

  execute(doc: CadDocument): DocumentChange | DocumentChange[] | null {
    if (this.patches.size === 0 && this.after.size > 0) {
      // redo — restore after snapshots without cascading remove
      for (const [, ent] of this.after) doc.replace(structuredClone(ent))
      return null
    }

    const change: DocumentChange = {
      added: [],
      updated: [],
      removed: [],
      beforeBounds: new Map(),
      afterBounds: new Map(),
    }
    for (const [id, patch] of this.patches) {
      const cur = doc.getEntity(id)
      if (!cur) continue
      if (!this.before.has(id)) this.before.set(id, structuredClone(cur))
      const c = doc.update(id, patch)
      if (!c) continue
      change.updated.push(...c.updated)
      for (const [k, v] of c.beforeBounds) change.beforeBounds.set(k, v)
      for (const [k, v] of c.afterBounds) change.afterBounds.set(k, v)
      const next = doc.getEntity(id)
      if (next) this.after.set(id, structuredClone(next))
    }
    this.patches = new Map()
    return change.updated.length ? change : null
  }

  undo(doc: CadDocument): void {
    for (const [, ent] of this.before) {
      doc.replace(structuredClone(ent))
    }
  }

  /** Fold another mutation into this command (same coalesceKey). */
  absorb(next: MutateEntitiesCommand): void {
    for (const [id, b] of next.before) {
      if (!this.before.has(id)) this.before.set(id, b)
    }
    for (const [id, a] of next.after) this.after.set(id, a)
  }
}

export class GroupCommand implements Command {
  readonly name = 'group'
  private groupSnapshot: GroupEntity | null = null
  private childBefore = new Map<EntityId, Entity>()

  constructor(
    private readonly childIds: EntityId[],
    private readonly group: GroupEntity,
  ) {}

  execute(doc: CadDocument): DocumentChange {
    for (const id of this.childIds) {
      const e = doc.getEntity(id)
      if (e && !this.childBefore.has(id)) this.childBefore.set(id, structuredClone(e))
    }
    this.groupSnapshot = structuredClone(this.group)
    return doc.group(this.childIds, structuredClone(this.group))
  }

  undo(doc: CadDocument): void {
    if (!this.groupSnapshot) return
    // Dissolve without baking — restore exact child snapshots
    const g = doc.getEntity(this.groupSnapshot.id)
    if (g?.type === 'group') {
      // clear children list then remove leaf group
      doc.update(g.id, { children: [] } as Partial<Entity>)
      for (const [, snap] of this.childBefore) {
        doc.replace(structuredClone(snap))
      }
      doc.removeLeaf(this.groupSnapshot.id)
    } else {
      for (const [, snap] of this.childBefore) doc.replace(structuredClone(snap))
    }
  }
}

export class UngroupCommand implements Command {
  readonly name = 'ungroup'
  private groupSnapshot: GroupEntity | null = null
  private childBefore = new Map<EntityId, Entity>()
  private childAfter = new Map<EntityId, Entity>()

  constructor(private readonly groupId: EntityId) {}

  execute(doc: CadDocument): DocumentChange | null {
    const group = doc.getEntity(this.groupId)
    if (!group || group.type !== 'group') return null
    this.groupSnapshot = structuredClone(group)
    for (const id of group.children) {
      const e = doc.getEntity(id)
      if (e) this.childBefore.set(id, structuredClone(e))
    }
    const change = doc.ungroup(this.groupId)
    for (const id of this.childBefore.keys()) {
      const e = doc.getEntity(id)
      if (e) this.childAfter.set(id, structuredClone(e))
    }
    return change
  }

  undo(doc: CadDocument): void {
    if (!this.groupSnapshot) return
    // Restore children to pre-ungroup state, then re-insert group
    for (const [, snap] of this.childBefore) {
      doc.replace(structuredClone(snap))
    }
    const group = structuredClone(this.groupSnapshot)
    // Children already have parentId pointing at group from snapshots
    doc.add(group)
    // Ensure group.children membership
    for (const id of group.children) {
      const e = doc.getEntity(id)
      if (e && e.parentId !== group.id) {
        doc.replace({ ...e, parentId: group.id })
      }
    }
  }
}

/** Run several commands as one undo/redo step. */
export class BatchCommand implements Command {
  readonly name = 'batch'

  constructor(private readonly commands: Command[]) {}

  execute(doc: CadDocument): DocumentChange | DocumentChange[] | null {
    const changes: DocumentChange[] = []
    for (const cmd of this.commands) {
      const ch = cmd.execute(doc)
      if (!ch) continue
      if (Array.isArray(ch)) changes.push(...ch)
      else changes.push(ch)
    }
    return changes.length ? changes : null
  }

  undo(doc: CadDocument): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i]!.undo(doc)
  }
}

export class HistoryStack {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private readonly maxSize: number

  constructor(
    private readonly doc: CadDocument,
    maxSize = 200,
  ) {
    this.maxSize = maxSize
  }

  execute(command: Command): DocumentChange | DocumentChange[] | null {
    const last = this.undoStack[this.undoStack.length - 1]
    if (last && command.coalesceKey && last.coalesceKey === command.coalesceKey) {
      if (last instanceof UpdateEntityCommand && command instanceof UpdateEntityCommand) {
        last.coalesce(command)
        return command.execute(this.doc)
      }
      if (last instanceof MutateEntitiesCommand && command instanceof MutateEntitiesCommand) {
        const change = command.execute(this.doc)
        last.absorb(command)
        return change
      }
    }
    const change = command.execute(this.doc)
    if (change == null) return null
    this.undoStack.push(command)
    if (this.undoStack.length > this.maxSize) this.undoStack.shift()
    this.redoStack.length = 0
    return change
  }

  undo(): boolean {
    const cmd = this.undoStack.pop()
    if (!cmd) return false
    cmd.undo(this.doc)
    this.redoStack.push(cmd)
    return true
  }

  redo(): boolean {
    const cmd = this.redoStack.pop()
    if (!cmd) return false
    cmd.execute(this.doc)
    this.undoStack.push(cmd)
    return true
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }
}
