import type { AABB, EntityId } from '@cadkit/types'
import { aabbArea, intersectsAABB, unionAABB } from '@cadkit/types'

export interface SpatialItem {
  id: EntityId
  bounds: AABB
}

interface RNode {
  leaf: boolean
  bounds: AABB
  children: RNode[]
  items: SpatialItem[]
}

const MAX_ENTRIES = 9
const MIN_ENTRIES = 4

function emptyBounds(): AABB {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

function itemBounds(items: SpatialItem[]): AABB {
  if (items.length === 0) return emptyBounds()
  let b = { ...items[0]!.bounds }
  for (let i = 1; i < items.length; i++) b = unionAABB(b, items[i]!.bounds)
  return b
}

function nodeBounds(node: RNode): AABB {
  if (node.leaf) return itemBounds(node.items)
  let b = emptyBounds()
  for (const c of node.children) b = unionAABB(b, c.bounds)
  return b
}

/**
 * Simple R-tree suitable for CAD viewport/box queries.
 * Static bulk-load + incremental insert; delta tree can wrap this.
 */
export class RTree {
  private root: RNode = { leaf: true, bounds: emptyBounds(), children: [], items: [] }
  private size = 0

  getSize(): number {
    return this.size
  }

  clear(): void {
    this.root = { leaf: true, bounds: emptyBounds(), children: [], items: [] }
    this.size = 0
  }

  insert(item: SpatialItem): void {
    this.insertNode(this.root, item)
    this.size++
    if (this.root.items.length > MAX_ENTRIES && this.root.leaf) {
      this.splitRoot()
    }
  }

  remove(id: EntityId): boolean {
    const removed = this.removeFromNode(this.root, id)
    if (removed) this.size--
    return removed
  }

  update(item: SpatialItem): void {
    this.remove(item.id)
    this.insert(item)
  }

  search(query: AABB): EntityId[] {
    const out: EntityId[] = []
    this.searchNode(this.root, query, out)
    return out
  }

  searchItems(query: AABB): SpatialItem[] {
    const out: SpatialItem[] = []
    this.searchItemsNode(this.root, query, out)
    return out
  }

  /** Bulk load by sorting on x and packing leaves. */
  bulkLoad(items: SpatialItem[]): void {
    this.clear()
    if (items.length === 0) return
    const sorted = [...items].sort((a, b) => a.bounds.minX - b.bounds.minX || a.bounds.minY - b.bounds.minY)
    const leaves: RNode[] = []
    for (let i = 0; i < sorted.length; i += MAX_ENTRIES) {
      const chunk = sorted.slice(i, i + MAX_ENTRIES)
      leaves.push({ leaf: true, bounds: itemBounds(chunk), children: [], items: chunk })
    }
    this.root = this.buildLevel(leaves)
    this.size = items.length
  }

  private buildLevel(nodes: RNode[]): RNode {
    if (nodes.length === 1) return nodes[0]!
    const parents: RNode[] = []
    for (let i = 0; i < nodes.length; i += MAX_ENTRIES) {
      const chunk = nodes.slice(i, i + MAX_ENTRIES)
      const parent: RNode = {
        leaf: false,
        bounds: emptyBounds(),
        children: chunk,
        items: [],
      }
      parent.bounds = nodeBounds(parent)
      parents.push(parent)
    }
    return this.buildLevel(parents)
  }

  private insertNode(node: RNode, item: SpatialItem): void {
    if (node.leaf) {
      node.items.push(item)
      node.bounds = itemBounds(node.items)
      if (node.items.length > MAX_ENTRIES && node !== this.root) {
        // parent will handle via split propagation simplified: rebuild leaf locally
      }
      return
    }
    let best = node.children[0]!
    let bestEnlargement = Infinity
    for (const child of node.children) {
      const united = unionAABB(child.bounds, item.bounds)
      const enlargement = aabbArea(united) - aabbArea(child.bounds)
      if (enlargement < bestEnlargement) {
        bestEnlargement = enlargement
        best = child
      }
    }
    this.insertNode(best, item)
    if (best.leaf && best.items.length > MAX_ENTRIES) {
      this.splitChild(node, best)
    }
    node.bounds = nodeBounds(node)
  }

  private splitChild(parent: RNode, child: RNode): void {
    const items = child.items
    items.sort((a, b) => a.bounds.minX - b.bounds.minX)
    const mid = Math.ceil(items.length / 2)
    const leftItems = items.slice(0, mid)
    const rightItems = items.slice(mid)
    child.items = leftItems
    child.bounds = itemBounds(leftItems)
    const right: RNode = {
      leaf: true,
      bounds: itemBounds(rightItems),
      children: [],
      items: rightItems,
    }
    parent.children.push(right)
    // ensure min fill by no-op for simplicity; MIN_ENTRIES reserved for future
    void MIN_ENTRIES
    parent.bounds = nodeBounds(parent)
  }

  private splitRoot(): void {
    const items = this.root.items
    items.sort((a, b) => a.bounds.minX - b.bounds.minX)
    const mid = Math.ceil(items.length / 2)
    const left: RNode = {
      leaf: true,
      bounds: itemBounds(items.slice(0, mid)),
      children: [],
      items: items.slice(0, mid),
    }
    const right: RNode = {
      leaf: true,
      bounds: itemBounds(items.slice(mid)),
      children: [],
      items: items.slice(mid),
    }
    this.root = {
      leaf: false,
      bounds: unionAABB(left.bounds, right.bounds),
      children: [left, right],
      items: [],
    }
  }

  private removeFromNode(node: RNode, id: EntityId): boolean {
    if (node.leaf) {
      const idx = node.items.findIndex((i) => i.id === id)
      if (idx < 0) return false
      node.items.splice(idx, 1)
      node.bounds = node.items.length ? itemBounds(node.items) : emptyBounds()
      return true
    }
    for (const child of node.children) {
      if (this.removeFromNode(child, id)) {
        node.bounds = nodeBounds(node)
        return true
      }
    }
    return false
  }

  private searchNode(node: RNode, query: AABB, out: EntityId[]): void {
    if (!intersectsAABB(node.bounds, query) && node.items.length + node.children.length > 0) {
      // empty newly created root has infinite inverted bounds — skip check
      if (Number.isFinite(node.bounds.minX) && !intersectsAABB(node.bounds, query)) return
    }
    if (node.leaf) {
      for (const item of node.items) {
        if (intersectsAABB(item.bounds, query)) out.push(item.id)
      }
      return
    }
    for (const child of node.children) this.searchNode(child, query, out)
  }

  private searchItemsNode(node: RNode, query: AABB, out: SpatialItem[]): void {
    if (Number.isFinite(node.bounds.minX) && !intersectsAABB(node.bounds, query)) return
    if (node.leaf) {
      for (const item of node.items) {
        if (intersectsAABB(item.bounds, query)) out.push(item)
      }
      return
    }
    for (const child of node.children) this.searchItemsNode(child, query, out)
  }
}

/** Static index + small delta for frequent edits. */
export class SpatialIndex {
  private staticTree = new RTree()
  private delta = new Map<EntityId, SpatialItem | null>()

  bulkLoad(items: SpatialItem[]): void {
    this.staticTree.bulkLoad(items)
    this.delta.clear()
  }

  upsert(item: SpatialItem): void {
    this.delta.set(item.id, item)
  }

  remove(id: EntityId): void {
    this.delta.set(id, null)
  }

  search(query: AABB): EntityId[] {
    const base = this.staticTree.searchItems(query)
    const map = new Map<EntityId, SpatialItem>()
    for (const item of base) map.set(item.id, item)
    for (const [id, item] of this.delta) {
      if (item == null) map.delete(id)
      else if (intersectsAABB(item.bounds, query)) map.set(id, item)
      else map.delete(id)
    }
    return [...map.keys()]
  }

  compact(): void {
    const all = this.staticTree.searchItems({
      minX: -Infinity,
      minY: -Infinity,
      maxX: Infinity,
      maxY: Infinity,
    })
    const map = new Map(all.map((i) => [i.id, i]))
    for (const [id, item] of this.delta) {
      if (item == null) map.delete(id)
      else map.set(id, item)
    }
    this.bulkLoad([...map.values()])
  }

  getDeltaSize(): number {
    return this.delta.size
  }
}
