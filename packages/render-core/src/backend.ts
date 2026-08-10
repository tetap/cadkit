import type { AABB, EntityId, RendererKind } from '@cadkit/types'
import type { Camera2D } from '@cadkit/geometry'
import type { DisplayListStats, RenderItem } from '@cadkit/scene'

export interface FrameMetrics {
  frameMs: number
  drawCalls: number
  visibleCount: number
  uploadBytes: number
  memoryMB: number
  backend: RendererKind
  gpuLost?: boolean
  /** Phase breakdown (ms) for incremental-render diagnostics. */
  sceneBuildMs?: number
  packMs?: number
  uploadMs?: number
  submitMs?: number
  /** Geometry bytes written this frame (0 on pan-only reuse). */
  geometryUploadBytes?: number
  mode?: 'full' | 'pan-reuse' | 'zoom-bin'
}

export interface GridOverlayInput {
  /** Screen-space line-list vertices: x,y,r,g,b,a per vertex */
  vertices: Float32Array
  vertexCount: number
  /** Optional page fill triangle-list (same vertex format) */
  fillVertices?: Float32Array
  fillVertexCount?: number
}

export interface RenderFrameInput {
  camera: Camera2D
  items: RenderItem[]
  selected: ReadonlySet<EntityId>
  clearColor?: string
  stats?: DisplayListStats
  /** Optional crisp screen-space grid overlay */
  grid?: GridOverlayInput
  /** Skip vector geometry pack/upload; reuse last GPU buffer (pan-only). */
  skipGeometryUpload?: boolean
  /** Skip grid buffer upload; reuse last overlay buffer. */
  skipGridUpload?: boolean
  sceneRevision?: number
  lodBin?: number
  mode?: 'full' | 'pan-reuse' | 'zoom-bin'
  textures?: TextureResolver
}

export interface PickResult {
  pickId: number
  entityId?: EntityId
}

/** Resolve decoded bitmaps for image primitives (Editor → AssetRegistry). */
export interface TextureResolver {
  getBitmap(assetId: string): ImageBitmap | null | undefined
  getStatus?(assetId: string): 'loading' | 'ready' | 'error' | undefined
}

export interface RendererBackend {
  readonly kind: RendererKind
  initialize(canvas: HTMLCanvasElement): Promise<void>
  resize(width: number, height: number, dpr: number): void
  render(input: RenderFrameInput): FrameMetrics
  /** Optional GPU ID pick; may be async-delayed. */
  pick?(x: number, y: number): Promise<PickResult | null>
  setMemoryBudget?(budgetMB: number): void
  setTextureResolver?(resolver: TextureResolver | null): void
  dispose(): void
}

export class MemoryBudget {
  private usedBytes = 0
  private readonly entries = new Map<string, number>()

  constructor(private budgetMB: number) {}

  setBudget(mb: number): void {
    this.budgetMB = mb
  }

  track(key: string, bytes: number): void {
    const prev = this.entries.get(key) ?? 0
    this.usedBytes += bytes - prev
    this.entries.set(key, bytes)
  }

  release(key: string): void {
    const prev = this.entries.get(key) ?? 0
    this.usedBytes -= prev
    this.entries.delete(key)
  }

  usedMB(): number {
    return this.usedBytes / (1024 * 1024)
  }

  pressure(): number {
    return this.usedMB() / Math.max(1, this.budgetMB)
  }

  shouldEvict(): boolean {
    return this.pressure() >= 0.8
  }
}

export interface DirtyRect {
  bounds: AABB
}

/** Keep a bounded set of dirty rects; merge or fullscreen when thresholds exceeded. */
export class DirtyRegionTracker {
  private rects: DirtyRect[] = []
  private fullscreen = false

  constructor(
    private readonly maxRects: number,
    private readonly mergeAreaRatio: number,
    private viewportArea = 1,
  ) {}

  setViewportArea(area: number): void {
    this.viewportArea = Math.max(1, area)
  }

  markFull(): void {
    this.fullscreen = true
    this.rects = []
  }

  mark(bounds: AABB): void {
    if (this.fullscreen) return
    this.rects.push({ bounds })
    this.compact()
  }

  consume(): { fullscreen: boolean; rects: DirtyRect[] } {
    const result = { fullscreen: this.fullscreen, rects: this.rects }
    this.rects = []
    this.fullscreen = false
    return result
  }

  private compact(): void {
    if (this.rects.length <= this.maxRects) {
      const area = this.rects.reduce(
        (s, r) => s + (r.bounds.maxX - r.bounds.minX) * (r.bounds.maxY - r.bounds.minY),
        0,
      )
      if (area / this.viewportArea >= this.mergeAreaRatio) this.markFull()
      return
    }
    // Merge all into one AABB
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const r of this.rects) {
      minX = Math.min(minX, r.bounds.minX)
      minY = Math.min(minY, r.bounds.minY)
      maxX = Math.max(maxX, r.bounds.maxX)
      maxY = Math.max(maxY, r.bounds.maxY)
    }
    this.rects = [{ bounds: { minX, minY, maxX, maxY } }]
    const area = (maxX - minX) * (maxY - minY)
    if (area / this.viewportArea >= this.mergeAreaRatio) this.markFull()
  }
}
