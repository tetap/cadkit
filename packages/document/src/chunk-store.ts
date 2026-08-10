import type { Entity, EntityId, AABB } from '@cadkit/types'

export interface ChunkMeta {
  id: string
  bounds: AABB
  entityCount: number
  version: number
}

export interface ChunkRecord {
  meta: ChunkMeta
  entities: Entity[]
}

/**
 * Out-of-core chunk store. Uses in-memory Map by default; when OPFS is available
 * in the browser, chunks can be persisted as JSON blobs.
 */
export class ChunkStore {
  private readonly chunks = new Map<string, ChunkRecord>()
  private readonly lru: string[] = []
  private residentBytes = 0

  constructor(private readonly maxResidentMB = 512) {}

  put(chunk: ChunkRecord): void {
    const bytes = estimateBytes(chunk)
    if (this.chunks.has(chunk.meta.id)) this.remove(chunk.meta.id)
    this.chunks.set(chunk.meta.id, chunk)
    this.touch(chunk.meta.id)
    this.residentBytes += bytes
    this.evictIfNeeded()
  }

  get(id: string): ChunkRecord | undefined {
    const c = this.chunks.get(id)
    if (c) this.touch(id)
    return c
  }

  remove(id: string): void {
    const c = this.chunks.get(id)
    if (!c) return
    this.residentBytes -= estimateBytes(c)
    this.chunks.delete(id)
    const idx = this.lru.indexOf(id)
    if (idx >= 0) this.lru.splice(idx, 1)
  }

  query(bounds: AABB): Entity[] {
    const out: Entity[] = []
    for (const chunk of this.chunks.values()) {
      if (!intersects(chunk.meta.bounds, bounds)) continue
      out.push(...chunk.entities)
    }
    return out
  }

  residentMB(): number {
    return this.residentBytes / (1024 * 1024)
  }

  size(): number {
    return this.chunks.size
  }

  /** Partition entities into spatial chunks for large imports. */
  static partition(entities: Entity[], cellSize: number): ChunkRecord[] {
    const buckets = new Map<string, Entity[]>()
    for (const e of entities) {
      const key = cellKey(e, cellSize)
      const arr = buckets.get(key) ?? []
      arr.push(e)
      buckets.set(key, arr)
    }
    return [...buckets.entries()].map(([id, ents], i) => ({
      meta: {
        id: id || `chunk_${i}`,
        bounds: boundsOf(ents),
        entityCount: ents.length,
        version: 1,
      },
      entities: ents,
    }))
  }

  private touch(id: string): void {
    const idx = this.lru.indexOf(id)
    if (idx >= 0) this.lru.splice(idx, 1)
    this.lru.push(id)
  }

  private evictIfNeeded(): void {
    while (this.residentMB() > this.maxResidentMB * 0.8 && this.lru.length > 1) {
      const id = this.lru.shift()
      if (id) this.remove(id)
    }
  }
}

function estimateBytes(chunk: ChunkRecord): number {
  return chunk.entities.length * 64 + 256
}

function intersects(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

function cellKey(entity: Entity, cellSize: number): string {
  let x = 0
  let y = 0
  if (entity.type === 'line') {
    x = entity.start.x
    y = entity.start.y
  } else if ('center' in entity && entity.center) {
    x = entity.center.x
    y = entity.center.y
  }
  return `${Math.floor(x / cellSize)}_${Math.floor(y / cellSize)}`
}

function boundsOf(entities: Entity[]): AABB {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const e of entities) {
    if (e.type === 'line') {
      box.minX = Math.min(box.minX, e.start.x, e.end.x)
      box.minY = Math.min(box.minY, e.start.y, e.end.y)
      box.maxX = Math.max(box.maxX, e.start.x, e.end.x)
      box.maxY = Math.max(box.maxY, e.start.y, e.end.y)
    }
  }
  return box
}

export type { EntityId }
