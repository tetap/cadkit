import type { EntityId } from '@cadkit/types'

export class SelectionSet {
  private ids = new Set<EntityId>()

  get size(): number {
    return this.ids.size
  }

  has(id: EntityId): boolean {
    return this.ids.has(id)
  }

  clear(): void {
    this.ids.clear()
  }

  set(ids: Iterable<EntityId>): void {
    this.ids = new Set(ids)
  }

  add(id: EntityId): void {
    this.ids.add(id)
  }

  toggle(id: EntityId): void {
    if (this.ids.has(id)) this.ids.delete(id)
    else this.ids.add(id)
  }

  remove(id: EntityId): void {
    this.ids.delete(id)
  }

  toArray(): EntityId[] {
    return [...this.ids]
  }

  asReadonly(): ReadonlySet<EntityId> {
    return this.ids
  }
}
