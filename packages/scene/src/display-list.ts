import type { AABB, Entity, EntityId, PerformanceConfig } from '@cadkit/types'
import { aabbWidth, aabbHeight } from '@cadkit/types'
import {
  resolveLayerAwarePaint,
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
  textEntityToLocalOutlines,
  transformPoint,
  worldAxisAlignedRectInstance,
} from '@cadkit/geometry'

/** Return true when the entity should be skipped for density LOD. */
function shouldSkipByDensity(id: EntityId, stride: number): boolean {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % stride !== 0
}

/** True when `inner` is fully inside `outer`. */
function aabbContains(outer: AABB, inner: AABB): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  )
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
  items: RenderItem[]
}

/** Screen-edge threshold (px) below which density LOD starts thinning. */
const DENSITY_LOD_PX = 3

export class SceneProjector {
  private readonly index = new SpatialIndex()
  private readonly pickIds = new Map<EntityId, number>()
  private readonly geomCache = new Map<EntityId, GeomCacheEntry>()
  private nextPickId = 1
  private lastLodBin: number | null = null
  private dirty = true
  private revision = 0
  private cachedBuild: SceneBuildResult | null = null
  /** Camera at last geometry build (not updated on geom-reuse). */
  private lastBuildCamera = { x: 0, y: 0, zoom: 1, vw: 0, vh: 0 }
  /** Padded search AABB from last geometry build — reuse while current view ⊆ this. */
  private lastSearchView: AABB | null = null
  /** World-space bounds invalidated since last consume (for future partial redraw). */
  private pendingDirtyBounds: AABB[] = []
  private dirtyFullscreen = false
  /** Bumped when layer color / visibility changes so geom cache invalidates. */
  private layerEpoch = 0
  /** Cached layer count for O(1) stack bands (refreshed on layer notify / rebuild). */
  private layerCountCache = 1

  constructor(
    private readonly doc: CadDocument,
    private readonly performance: PerformanceConfig,
  ) {
    this.rebuildIndex()
  }

  /** Call after layer color/visibility edits that are not entity DocumentChanges. */
  notifyLayersChanged(): void {
    this.layerEpoch++
    this.layerCountCache = Math.max(1, this.doc.getLayers().length)
    this.geomCache.clear()
    this.dirty = true
    this.revision++
    this.cachedBuild = null
    this.lastSearchView = null
    this.dirtyFullscreen = true
  }

  /**
   * Drop projected geometry cache (e.g. after webfont load settles so glyph
   * outlines are re-traced). Forces a full scene rebuild on next frame.
   */
  invalidateGeometryCache(): void {
    this.geomCache.clear()
    this.cachedBuild = null
    this.dirty = true
    this.lastSearchView = null
    this.dirtyFullscreen = true
    this.revision++
  }

  /** Consume change-invalidation metadata for dirty-rect / pan-blit GPU paths. */
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
    this.lastSearchView = null
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
    this.layerCountCache = Math.max(1, this.doc.getLayers().length)
    this.dirty = true
    this.revision++
    this.cachedBuild = null
    this.lastSearchView = null
    this.dirtyFullscreen = true
    this.pendingDirtyBounds = []
  }

  build(camera: Camera2D, selected: ReadonlySet<EntityId> = new Set()): SceneBuildResult {
    const state = camera.getState()
    const bin = lodBin(state.zoom, this.lastLodBin)
    const zoomChanged = this.lastLodBin !== null && this.lastLodBin !== bin
    const viewportSame =
      state.viewportWidth === this.lastBuildCamera.vw &&
      state.viewportHeight === this.lastBuildCamera.vh

    // Pan or zoom within the same lodBin: reuse display list + skip GPU upload
    // while the current view stays inside the previous padded search AABB.
    if (
      !this.dirty &&
      this.cachedBuild != null &&
      this.cachedBuild.lodBin === bin &&
      viewportSame &&
      this.lastSearchView
    ) {
      const view = camera.getVisibleWorldBounds()
      if (aabbContains(this.lastSearchView, view)) {
        const mode: SceneBuildMode =
          state.zoom === this.lastBuildCamera.zoom ? 'pan-reuse' : 'zoom-bin'
        return {
          ...this.cachedBuild,
          mode,
          skipGeometryUpload: true,
          stats: { ...this.cachedBuild.stats, buildMs: 0 },
        }
      }
    }

    const t0 = performanceNow()
    this.lastLodBin = bin
    const view = camera.getVisibleWorldBounds()
    // Expand search so pan/zoom reuse has margin.
    const padX = (view.maxX - view.minX) * 0.2
    const padY = (view.maxY - view.minY) * 0.2
    const searchView: AABB = {
      minX: view.minX - padX,
      minY: view.minY - padY,
      maxX: view.maxX + padX,
      maxY: view.maxY + padY,
    }

    const worldPerPixel = 1 / state.zoom
    const pixelError = this.performance.lodNavigationPx
    const ids = this.index.search(searchView)
    const maxVisible = this.performance.maxVisible
    const selectExemptMax = this.performance.selectionLodExemptMax
    const selectionExempt = selected.size > 0 && selected.size <= selectExemptMax

    type Candidate = {
      id: EntityId
      entity: Entity
      bounds: AABB
      maxEdge: number
      selected: boolean
    }
    const candidates: Candidate[] = []
    let culled = 0
    const zoom = state.zoom
    const hasSelection = selected.size > 0

    for (let ii = 0; ii < ids.length; ii++) {
      const id = ids[ii]!
      const entity = this.doc.getEntity(id)
      if (!entity || entity.style.visible === false) continue
      const layer = this.doc.getLayer(entity.layerId)
      if (layer && layer.visible === false) continue
      const bounds = this.doc.getBounds(id)
      if (!bounds) continue

      const maxEdge = Math.max(aabbWidth(bounds), aabbHeight(bounds)) * zoom
      const isSel = hasSelection && selected.has(id)
      // Large selections (layer select-all) must not bypass density LOD.
      const exempt = isSel && selectionExempt
      if (!exempt && maxEdge < DENSITY_LOD_PX) {
        const stride =
          maxEdge < 0.25 ? 64 : maxEdge < 0.6 ? 16 : maxEdge < 1.2 ? 8 : maxEdge < 2 ? 4 : 2
        if (shouldSkipByDensity(id, stride)) {
          culled++
          continue
        }
      }

      candidates.push({ id, entity, bounds, maxEdge, selected: isSel })
    }

    // Hard budget: prefer larger-on-screen; avoid O(n log n) when massively over.
    if (maxVisible > 0 && candidates.length > maxVisible) {
      if (candidates.length > maxVisible * 4) {
        const stride = Math.ceil(candidates.length / (maxVisible * 2))
        const thinned: Candidate[] = []
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i]!
          if (c.selected || i % stride === 0) thinned.push(c)
        }
        culled += candidates.length - thinned.length
        candidates.length = 0
        candidates.push(...thinned)
      }
      if (candidates.length > maxVisible) {
        candidates.sort((a, b) => {
          if (a.selected !== b.selected) return a.selected ? -1 : 1
          return b.maxEdge - a.maxEdge
        })
        culled += candidates.length - maxVisible
        candidates.length = maxVisible
      }
    }

    const items: RenderItem[] = []
    let cacheHits = 0
    let cacheMisses = 0

    for (const { id, entity, bounds } of candidates) {
      const cached = this.geomCache.get(id)
      if (
        cached &&
        cached.entityVersion === entity.version &&
        cached.lodBin === bin &&
        cached.layerEpoch === this.layerEpoch
      ) {
        for (const it of cached.items) items.push({ ...it, bounds })
        cacheHits++
        continue
      }

      const projected = this.projectEntity(entity, bounds, pixelError, worldPerPixel, bin)
      if (projected.length) {
        this.geomCache.set(id, {
          entityVersion: entity.version,
          lodBin: bin,
          layerEpoch: this.layerEpoch,
          items: projected,
        })
        items.push(...projected)
        cacheMisses++
      }
    }

    // Layer stack first (higher zOrder = front), then batch by kind/style.
    items.sort((a, b) => {
      if (a.zOrder !== b.zOrder) return a.zOrder - b.zOrder
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      return a.styleKey.localeCompare(b.styleKey)
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
    this.lastBuildCamera = {
      x: state.x,
      y: state.y,
      zoom: state.zoom,
      vw: state.viewportWidth,
      vh: state.viewportHeight,
    }
    this.lastSearchView = searchView
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

  /**
   * Document stack order for hit-testing / draw priority.
   * Matches RenderItem.zOrder: panel-top layers win; within a layer, lower stack index wins (front).
   */
  getStackOrder(id: EntityId): number {
    const entity = this.doc.getEntity(id)
    if (!entity) return 0
    const layerIndex = this.doc.getLayerIndex(entity.layerId)
    const layerBand =
      layerIndex < 0 ? 0 : (this.layerCountCache - 1 - layerIndex) * 1_000_000
    const idx = this.doc.getEntityStackIndex(id)
    const count = this.doc.getEntityOrderCount(entity.layerId)
    const within = idx < 0 || count <= 0 ? 0 : count - 1 - idx
    return layerBand + (within & 0xfffff)
  }

  /** Call after entity stack reorder (same invalidation as layer style changes). */
  notifyStackChanged(): void {
    this.notifyLayersChanged()
  }

  private resolveEntityPaint(entity: Entity): { stroke: string; fill?: string; strokeWidth: number } {
    const layer = this.doc.getLayer(entity.layerId)
    // Layer engraver mode: line → stroke only; fill → fill only (ignore the other).
    return resolveLayerAwarePaint(layer, entity.style)
  }

  private projectEntity(
    entity: Entity,
    bounds: AABB,
    pixelError: number,
    worldPerPixel: number,
    lod: number,
  ): RenderItem[] {
    const paint = this.resolveEntityPaint(entity)
    const styleKey = `${paint.stroke}|${paint.strokeWidth}|${paint.fill ?? ''}|${entity.layerId}`
    const pickId = this.pickIds.get(entity.id) ?? 0
    const hasHoles = entity.type === 'polyline' && !!entity.holes?.length
    const base = {
      id: entity.id,
      // Panel top (index 0) draws in front — see getStackOrder().
      zOrder: this.getStackOrder(entity.id),
      styleKey,
      stroke: paint.stroke,
      strokeWidth: paint.strokeWidth,
      // Holes need even-odd fill; until then stroke-only for compound paths.
      fill: hasHoles ? undefined : paint.fill,
      bounds,
      lod,
      pickId,
    }

    const m = resolveWorldMatrix(entity, (id) => this.doc.getEntity(id))
    const wp = (x: number, y: number) => transformPoint(m, { x, y })
    const packRing = (pts: Array<{ x: number; y: number }>, close: boolean): Float64Array => {
      const n = pts.length
      const coords = new Float64Array((n + (close && n >= 2 ? 1 : 0)) * 2)
      pts.forEach((p, i) => {
        const q = wp(p.x, p.y)
        coords[i * 2] = q.x
        coords[i * 2 + 1] = q.y
      })
      if (close && n >= 2) {
        const q = wp(pts[0]!.x, pts[0]!.y)
        coords[n * 2] = q.x
        coords[n * 2 + 1] = q.y
      }
      return coords
    }

    switch (entity.type) {
      case 'line': {
        const a = wp(entity.start.x, entity.start.y)
        const b = wp(entity.end.x, entity.end.y)
        return [
          {
            ...base,
            kind: 'line',
            coords: new Float64Array([a.x, a.y, b.x, b.y]),
          },
        ]
      }
      case 'polyline': {
        // Axis-aligned rects → compact GPU instances (huge win for million-square seeds).
        const rounded = entity.shape?.cornerRadii
        const hasRound =
          rounded != null &&
          (typeof rounded === 'number'
            ? rounded > 0
            : rounded.some((r) => (r ?? 0) > 0))
        if (
          entity.closed &&
          !entity.holes?.length &&
          !hasRound &&
          (entity.shape?.kind === 'rect' || entity.shape?.kind === undefined)
        ) {
          const inst = worldAxisAlignedRectInstance(entity.points, true, (x, y) => wp(x, y))
          if (inst) {
            return [{ ...base, kind: 'instance', coords: inst }]
          }
        }
        const items: RenderItem[] = [
          {
            ...base,
            kind: 'polyline',
            coords: packRing(entity.points, entity.closed && entity.points.length >= 2),
          },
        ]
        for (const hole of entity.holes ?? []) {
          if (hole.length < 2) continue
          items.push({
            ...base,
            kind: 'polyline',
            fill: undefined,
            coords: packRing(hole, true),
          })
        }
        return items
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
        return [{ ...base, kind: 'polyline', coords }]
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
        return [{ ...base, kind: 'circle', coords }]
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
        // Filled arcs → closed pie (center + rim) so fill survives circle→arc.
        if (base.fill && pts.length >= 2) {
          const coords = new Float64Array((pts.length + 2) * 2)
          coords[0] = center.x
          coords[1] = center.y
          pts.forEach((p, i) => {
            coords[(i + 1) * 2] = p.x
            coords[(i + 1) * 2 + 1] = p.y
          })
          coords[(pts.length + 1) * 2] = center.x
          coords[(pts.length + 1) * 2 + 1] = center.y
          return [{ ...base, kind: 'polyline', coords }]
        }
        const coords = new Float64Array(pts.length * 2)
        pts.forEach((p, i) => {
          coords[i * 2] = p.x
          coords[i * 2 + 1] = p.y
        })
        return [{ ...base, kind: 'arc', coords }]
      }
      case 'ellipse': {
        let sweep = entity.endAngle - entity.startAngle
        while (sweep <= 0) sweep += Math.PI * 2
        while (sweep > Math.PI * 2) sweep -= Math.PI * 2
        const full = sweep >= Math.PI * 2 - 1e-3
        const segments = Math.max(24, Math.ceil((full ? 64 : 64 * (sweep / (Math.PI * 2))) / Math.max(worldPerPixel, 1e-6)))
        const rimCount = segments + 1
        const cosR = Math.cos(entity.rotation)
        const sinR = Math.sin(entity.rotation)
        const rim = (t: number) => {
          const a = entity.startAngle + sweep * t
          const lx = entity.radiusX * Math.cos(a)
          const ly = entity.radiusY * Math.sin(a)
          return wp(
            entity.center.x + lx * cosR - ly * sinR,
            entity.center.y + lx * sinR + ly * cosR,
          )
        }
        if (!full && base.fill) {
          const center = wp(entity.center.x, entity.center.y)
          const coords = new Float64Array((rimCount + 2) * 2)
          coords[0] = center.x
          coords[1] = center.y
          for (let i = 0; i < rimCount; i++) {
            const q = rim(i / segments)
            coords[(i + 1) * 2] = q.x
            coords[(i + 1) * 2 + 1] = q.y
          }
          coords[(rimCount + 1) * 2] = center.x
          coords[(rimCount + 1) * 2 + 1] = center.y
          return [{ ...base, kind: 'polyline', coords }]
        }
        const coords = new Float64Array(rimCount * 2)
        for (let i = 0; i < rimCount; i++) {
          const q = rim(i / Math.max(segments, 1))
          coords[i * 2] = q.x
          coords[i * 2 + 1] = q.y
        }
        return [{ ...base, kind: 'polyline', coords }]
      }
      case 'text': {
        if (aabbWidth(bounds) / worldPerPixel < 4 || aabbHeight(bounds) / worldPerPixel < 4) {
          return []
        }
        // Vector glyph outlines → closed polylines (same hairline stroke / fill
        // path as other geometry). Empty while canvas/fonts unavailable.
        const outlines = textEntityToLocalOutlines(entity)
        if (!outlines.length) return []
        const items: RenderItem[] = []
        for (const contour of outlines) {
          const pts = contour.points
          if (pts.length < 2) continue
          let area = 0
          for (let i = 0, n = pts.length; i < n; i++) {
            const p = pts[i]!
            const q = pts[(i + 1) % n]!
            area += p.x * q.y - q.x * p.y
          }
          // Holes (negative area): stroke-only until even-odd fill exists.
          const isHole = area < 0
          const n = pts.length
          const coords = new Float64Array((n + 1) * 2)
          for (let i = 0; i < n; i++) {
            const q = wp(pts[i]!.x, pts[i]!.y)
            coords[i * 2] = q.x
            coords[i * 2 + 1] = q.y
          }
          const q0 = wp(pts[0]!.x, pts[0]!.y)
          coords[n * 2] = q0.x
          coords[n * 2 + 1] = q0.y
          items.push({
            ...base,
            kind: 'polyline',
            fill: isHole ? undefined : paint.fill,
            coords,
          })
        }
        return items
      }
      case 'image': {
        const o = wp(entity.origin.x, entity.origin.y)
        const tr = wp(entity.origin.x + entity.width, entity.origin.y)
        const br = wp(entity.origin.x + entity.width, entity.origin.y + entity.height)
        const bl = wp(entity.origin.x, entity.origin.y + entity.height)
        return [
          {
            ...base,
            kind: 'image',
            coords: new Float64Array([o.x, o.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]),
            uv: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]),
            assetId: entity.assetId ?? entity.href,
            filters: entity.filters,
          },
        ]
      }
      default:
        return []
    }
  }
}
