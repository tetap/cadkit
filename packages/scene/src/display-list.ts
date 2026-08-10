import type { AABB, Entity, EntityId, PerformanceConfig } from '@cadkit/types'
import { aabbWidth, aabbHeight } from '@cadkit/types'
import {
  layerFillFromStroke,
  type CadDocument,
  type DocumentChange,
} from '@cadkit/document'
import { SpatialIndex } from '@cadkit/spatial'
import {
  Camera2D,
  lodBin,
  resolveWorldMatrix,
  tessellateArc,
  tessellateCubicChain,
  transformPoint,
} from '@cadkit/geometry'

/** Return true when the entity should be skipped for density LOD. */
function shouldSkipByDensity(id: EntityId, stride: number): boolean {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % stride !== 0
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export type PrimitiveKind =
  | 'line'
  | 'polyline'
  | 'arc'
  | 'circle'
  | 'text'
  | 'image'
  | 'fill'
  | 'instance'

export interface RenderItem {
  id: EntityId
  kind: PrimitiveKind
  /** Packed sort key components */
  zOrder: number
  styleKey: string
  stroke: string
  strokeWidth: number
  fill?: string
  /** Flattened geometry in world space (Float64) */
  coords: Float64Array
  bounds: AABB
  lod: number
  /** For GPU instance / picking */
  pickId: number
  /** Image / text extras */
  assetId?: string
  uv?: Float64Array
  filters?: unknown[]
}

export interface DisplayListStats {
  visibleCount: number
  culledCount: number
  batchHints: number
  buildMs: number
  cacheHits: number
  cacheMisses: number
}

export type SceneBuildMode = 'full' | 'pan-reuse' | 'zoom-bin'

export interface SceneBuildResult {
  items: RenderItem[]
  stats: DisplayListStats
  mode: SceneBuildMode
  revision: number
  lodBin: number
  /** True when GPU geometry upload can be skipped (pan-only reuse). */
  skipGeometryUpload: boolean
}

interface GeomCacheEntry {
  entityVersion: number
  lodBin: number
  /** Invalidates when layer color / visibility styling changes. */
  layerEpoch: number
  item: RenderItem
}

export class SceneProjector {
  private readonly index = new SpatialIndex()
  private readonly pickIds = new Map<EntityId, number>()
  private readonly geomCache = new Map<EntityId, GeomCacheEntry>()
  private nextPickId = 1
  private lastLodBin: number | null = null
  private dirty = true
  private revision = 0
  private cachedBuild: SceneBuildResult | null = null
  private lastCamera = { x: 0, y: 0, zoom: 1, vw: 0, vh: 0 }
  /** World-space bounds invalidated since last consume (for future partial redraw). */
  private pendingDirtyBounds: AABB[] = []
  private dirtyFullscreen = false
  /** Bumped when layer color / visibility changes so geom cache invalidates. */
  private layerEpoch = 0

  constructor(
    private readonly doc: CadDocument,
    private readonly performance: PerformanceConfig,
  ) {
    this.rebuildIndex()
  }

  /** Call after layer color/visibility edits that are not entity DocumentChanges. */
  notifyLayersChanged(): void {
    this.layerEpoch++
    this.geomCache.clear()
    this.dirty = true
    this.revision++
    this.cachedBuild = null
    this.dirtyFullscreen = true
  }

  /** Consume change-invalidation metadata (stable hook for future dirty-rect redraw). */
  consumeDirtyMeta(): { fullscreen: boolean; rects: AABB[] } {
    const result = { fullscreen: this.dirtyFullscreen, rects: this.pendingDirtyBounds }
    this.pendingDirtyBounds = []
    this.dirtyFullscreen = false
    return result
  }

  getRevision(): number {
    return this.revision
  }

  applyChange(change: DocumentChange): void {
    for (const id of change.removed) {
      this.index.remove(id)
      this.pickIds.delete(id)
      this.geomCache.delete(id)
      const before = change.beforeBounds.get(id)
      if (before) this.pendingDirtyBounds.push(before)
    }
    for (const id of [...change.added, ...change.updated]) {
      const bounds = change.afterBounds.get(id) ?? this.doc.getBounds(id)
      if (bounds) {
        this.index.upsert({ id, bounds })
        this.pendingDirtyBounds.push(bounds)
      }
      const before = change.beforeBounds.get(id)
      if (before) this.pendingDirtyBounds.push(before)
      this.geomCache.delete(id)
      if (!this.pickIds.has(id)) this.pickIds.set(id, this.nextPickId++)
    }
    if (this.index.getDeltaSize() > 10_000) this.index.compact()
    this.dirty = true
    this.revision++
    this.cachedBuild = null
  }

  rebuildIndex(): void {
    // Full rebuild: drop stale pick ids from prior documents / seed resets.
    this.pickIds.clear()
    this.nextPickId = 1
    const items = this.doc
      .getEntityIds()
      .map((id) => {
        this.pickIds.set(id, this.nextPickId++)
        return { id, bounds: this.doc.getBounds(id)! }
      })
      .filter((i) => i.bounds)
    this.index.bulkLoad(items)
    this.geomCache.clear()
    this.dirty = true
    this.revision++
    this.cachedBuild = null
    this.dirtyFullscreen = true
    this.pendingDirtyBounds = []
  }

  build(camera: Camera2D, selected: ReadonlySet<EntityId> = new Set()): SceneBuildResult {
    const state = camera.getState()
    const bin = lodBin(state.zoom, this.lastLodBin)
    const zoomChanged = this.lastLodBin !== null && this.lastLodBin !== bin
    const panOnly =
      !this.dirty &&
      !zoomChanged &&
      this.cachedBuild != null &&
      this.cachedBuild.lodBin === bin &&
      state.zoom === this.lastCamera.zoom &&
      state.viewportWidth === this.lastCamera.vw &&
      state.viewportHeight === this.lastCamera.vh

    // Pure pan: reuse previous display list + skip GPU geometry upload.
    // Rebuild when the view center drifts far enough that edge coverage may miss.
    if (panOnly && this.cachedBuild) {
      const dx = (state.x - this.lastCamera.x) * state.zoom
      const dy = (state.y - this.lastCamera.y) * state.zoom
      const drift = Math.hypot(dx, dy)
      const threshold = Math.min(state.viewportWidth, state.viewportHeight) * 0.35
      if (drift < threshold) {
        this.lastCamera = {
          x: state.x,
          y: state.y,
          zoom: state.zoom,
          vw: state.viewportWidth,
          vh: state.viewportHeight,
        }
        return {
          ...this.cachedBuild,
          mode: 'pan-reuse',
          skipGeometryUpload: true,
          stats: { ...this.cachedBuild.stats, buildMs: 0 },
        }
      }
    }

    const t0 = performanceNow()
    this.lastLodBin = bin
    const view = camera.getVisibleWorldBounds()
    // Expand search slightly so pan-reuse has margin.
    const padX = (view.maxX - view.minX) * 0.15
    const padY = (view.maxY - view.minY) * 0.15
    const searchView: AABB = {
      minX: view.minX - padX,
      minY: view.minY - padY,
      maxX: view.maxX + padX,
      maxY: view.maxY + padY,
    }

    const worldPerPixel = 1 / state.zoom
    const pixelError = this.performance.lodNavigationPx
    const ids = this.index.search(searchView)
    const items: RenderItem[] = []
    let culled = 0
    let cacheHits = 0
    let cacheMisses = 0

    for (const id of ids) {
      const entity = this.doc.getEntity(id)
      if (!entity || entity.style.visible === false) continue
      const layer = this.doc.getLayer(entity.layerId)
      if (layer && layer.visible === false) continue
      const bounds = this.doc.getBounds(id)
      if (!bounds) continue

      const screenW = aabbWidth(bounds) * state.zoom
      const screenH = aabbHeight(bounds) * state.zoom
      const maxEdge = Math.max(screenW, screenH)
      if (!selected.has(id) && maxEdge < 0.75) {
        const stride = maxEdge < 0.15 ? 32 : maxEdge < 0.35 ? 8 : 2
        if (shouldSkipByDensity(id, stride)) {
          culled++
          continue
        }
      }

      const cached = this.geomCache.get(id)
      if (
        cached &&
        cached.entityVersion === entity.version &&
        cached.lodBin === bin &&
        cached.layerEpoch === this.layerEpoch
      ) {
        items.push({ ...cached.item, bounds })
        cacheHits++
        continue
      }

      const item = this.projectEntity(entity, bounds, pixelError, worldPerPixel, bin)
      if (item) {
        this.geomCache.set(id, {
          entityVersion: entity.version,
          lodBin: bin,
          layerEpoch: this.layerEpoch,
          item,
        })
        items.push(item)
        cacheMisses++
      }
    }

    items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      if (a.styleKey !== b.styleKey) return a.styleKey.localeCompare(b.styleKey)
      return a.zOrder - b.zOrder
    })

    let batchHints = 0
    let prev = ''
    for (const item of items) {
      const key = `${item.kind}|${item.styleKey}`
      if (key !== prev) {
        batchHints++
        prev = key
      }
    }

    this.dirty = false
    this.lastCamera = {
      x: state.x,
      y: state.y,
      zoom: state.zoom,
      vw: state.viewportWidth,
      vh: state.viewportHeight,
    }
    const result: SceneBuildResult = {
      items,
      stats: {
        visibleCount: items.length,
        culledCount: culled,
        batchHints,
        buildMs: performanceNow() - t0,
        cacheHits,
        cacheMisses,
      },
      mode: zoomChanged ? 'zoom-bin' : 'full',
      revision: this.revision,
      lodBin: bin,
      skipGeometryUpload: false,
    }
    this.cachedBuild = result
    return result
  }

  isDirty(): boolean {
    return this.dirty
  }

  query(bounds: AABB): EntityId[] {
    return this.index.search(bounds)
  }

  getPickId(id: EntityId): number | undefined {
    return this.pickIds.get(id)
  }

  private resolveEntityPaint(entity: Entity): { stroke: string; fill?: string; strokeWidth: number } {
    const layer = this.doc.getLayer(entity.layerId)
    // Prefer entity paint; fall back to layer color so new/unpainted items inherit layer tint.
    const stroke = entity.style.stroke ?? layer?.color ?? '#32cd79'
    const strokeWidth = entity.style.strokeWidth ?? 1
    const rawFill = entity.style.fill
    const hasFill =
      !!rawFill &&
      rawFill !== 'none' &&
      rawFill !== 'transparent' &&
      !/00$/i.test(rawFill)
    const fill =
      hasFill || rawFill === undefined
        ? (rawFill ?? (layer?.color ? layerFillFromStroke(layer.color) : undefined))
        : rawFill
    return { stroke, fill, strokeWidth }
  }

  private projectEntity(
    entity: Entity,
    bounds: AABB,
    pixelError: number,
    worldPerPixel: number,
    lod: number,
  ): RenderItem | null {
    const paint = this.resolveEntityPaint(entity)
    const styleKey = `${paint.stroke}|${paint.strokeWidth}|${paint.fill ?? ''}|${entity.layerId}`
    const pickId = this.pickIds.get(entity.id) ?? 0
    const base = {
      id: entity.id,
      zOrder: 0,
      styleKey,
      stroke: paint.stroke,
      strokeWidth: paint.strokeWidth,
      fill: paint.fill,
      bounds,
      lod,
      pickId,
    }

    const m = resolveWorldMatrix(entity, (id) => this.doc.getEntity(id))
    const wp = (x: number, y: number) => transformPoint(m, { x, y })

    switch (entity.type) {
      case 'line': {
        const a = wp(entity.start.x, entity.start.y)
        const b = wp(entity.end.x, entity.end.y)
        return {
          ...base,
          kind: 'line',
          coords: new Float64Array([a.x, a.y, b.x, b.y]),
        }
      }
      case 'polyline': {
        const pts = entity.points
        const n = pts.length
        const close = entity.closed && n >= 2
        const coords = new Float64Array((n + (close ? 1 : 0)) * 2)
        pts.forEach((p, i) => {
          const q = wp(p.x, p.y)
          coords[i * 2] = q.x
          coords[i * 2 + 1] = q.y
        })
        if (close) {
          const q = wp(pts[0]!.x, pts[0]!.y)
          coords[n * 2] = q.x
          coords[n * 2 + 1] = q.y
        }
        return { ...base, kind: 'polyline', coords }
      }
      case 'bezier': {
        // points packed as chained cubics [p0,c1,c2,p1,...]; sample to a polyline.
        const local = tessellateCubicChain(entity.points, pixelError, worldPerPixel, !!entity.closed)
        const coords = new Float64Array(local.length * 2)
        local.forEach((p, i) => {
          const q = wp(p.x, p.y)
          coords[i * 2] = q.x
          coords[i * 2 + 1] = q.y
        })
        return { ...base, kind: 'polyline', coords }
      }
      case 'circle': {
        const center = wp(entity.center.x, entity.center.y)
        const rim = wp(entity.center.x + entity.radius, entity.center.y)
        const radius = Math.hypot(rim.x - center.x, rim.y - center.y)
        const pts = tessellateArc(center, radius, 0, Math.PI * 2, pixelError, worldPerPixel)
        const coords = new Float64Array(pts.length * 2)
        pts.forEach((p, i) => {
          coords[i * 2] = p.x
          coords[i * 2 + 1] = p.y
        })
        return { ...base, kind: 'circle', coords }
      }
      case 'arc': {
        const center = wp(entity.center.x, entity.center.y)
        const rim = wp(
          entity.center.x + entity.radius * Math.cos(entity.startAngle),
          entity.center.y + entity.radius * Math.sin(entity.startAngle),
        )
        const radius = Math.hypot(rim.x - center.x, rim.y - center.y)
        const rot = Math.atan2(m[1], m[0])
        const pts = tessellateArc(
          center,
          radius,
          entity.startAngle + rot,
          entity.endAngle + rot,
          pixelError,
          worldPerPixel,
        )
        const coords = new Float64Array(pts.length * 2)
        pts.forEach((p, i) => {
          coords[i * 2] = p.x
          coords[i * 2 + 1] = p.y
        })
        return { ...base, kind: 'arc', coords }
      }
      case 'ellipse': {
        const center = wp(entity.center.x, entity.center.y)
        const segments = Math.max(24, Math.ceil(64 / Math.max(worldPerPixel, 1e-6)))
        const coords = new Float64Array((segments + 1) * 2)
        for (let i = 0; i <= segments; i++) {
          const t = (i / segments) * Math.PI * 2
          const lx = entity.center.x + entity.radiusX * Math.cos(t) * Math.cos(entity.rotation) - entity.radiusY * Math.sin(t) * Math.sin(entity.rotation)
          const ly = entity.center.y + entity.radiusX * Math.cos(t) * Math.sin(entity.rotation) + entity.radiusY * Math.sin(t) * Math.cos(entity.rotation)
          const q = wp(lx, ly)
          coords[i * 2] = q.x
          coords[i * 2 + 1] = q.y
        }
        return { ...base, kind: 'polyline', coords }
      }
      case 'text': {
        if (aabbWidth(bounds) / worldPerPixel < 4 || aabbHeight(bounds) / worldPerPixel < 4) {
          return null
        }
        const pos = wp(entity.position.x, entity.position.y)
        return {
          ...base,
          kind: 'text',
          coords: new Float64Array([pos.x, pos.y, entity.fontSize]),
        }
      }
      case 'image': {
        const o = wp(entity.origin.x, entity.origin.y)
        const tr = wp(entity.origin.x + entity.width, entity.origin.y)
        const br = wp(entity.origin.x + entity.width, entity.origin.y + entity.height)
        const bl = wp(entity.origin.x, entity.origin.y + entity.height)
        return {
          ...base,
          kind: 'image',
          coords: new Float64Array([o.x, o.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]),
          uv: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]),
          assetId: entity.assetId ?? entity.href,
          filters: entity.filters,
        }
      }
      default:
        return null
    }
  }
}
