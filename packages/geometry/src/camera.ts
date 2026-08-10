import type { AABB, ScreenPoint, WorldPoint } from '@cadkit/types'
import { screenPoint, worldPoint } from '@cadkit/types'
import {
  type Matrix3,
  IDENTITY,
  invert,
  multiply,
  transformPoint,
  translate,
  scale,
  rotate,
  cloneMatrix,
} from './matrix.js'

export interface CameraState {
  x: number
  y: number
  zoom: number
  rotation: number
  viewportWidth: number
  viewportHeight: number
}

export class Camera2D {
  private x = 0
  private y = 0
  private zoom = 1
  private rotation = 0
  private viewportWidth = 800
  private viewportHeight = 600
  private minZoom = 1e-6
  private maxZoom = 1e6
  private version = 0
  private cachedWorldToScreen: Matrix3 = cloneMatrix(IDENTITY)
  private cachedScreenToWorld: Matrix3 = cloneMatrix(IDENTITY)
  private cacheVersion = -1

  getVersion(): number {
    return this.version
  }

  getState(): CameraState {
    return {
      x: this.x,
      y: this.y,
      zoom: this.zoom,
      rotation: this.rotation,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
    }
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = width
    this.viewportHeight = height
    this.version++
  }

  setZoomRange(min: number, max: number): void {
    this.minZoom = min
    this.maxZoom = max
  }

  pan(dxScreen: number, dyScreen: number): void {
    const inv = this.getScreenToWorld()
    const origin = transformPoint(inv, { x: 0, y: 0 })
    const moved = transformPoint(inv, { x: dxScreen, y: dyScreen })
    this.x -= moved.x - origin.x
    this.y -= moved.y - origin.y
    this.version++
  }

  zoomAt(screen: ScreenPoint, factor: number): void {
    const before = this.screenToWorld(screen)
    const next = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor))
    this.zoom = next
    this.version++
    this.invalidateCache()
    const after = this.screenToWorld(screen)
    this.x += before.x - after.x
    this.y += before.y - after.y
    this.version++
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom))
    this.version++
  }

  setCenter(world: WorldPoint): void {
    this.x = world.x - this.viewportWidth / (2 * this.zoom)
    this.y = world.y - this.viewportHeight / (2 * this.zoom)
    this.version++
  }

  fitBounds(bounds: AABB, padding = 40): void {
    const w = bounds.maxX - bounds.minX
    const h = bounds.maxY - bounds.minY
    if (w <= 0 || h <= 0) return
    const availableW = Math.max(1, this.viewportWidth - padding * 2)
    const availableH = Math.max(1, this.viewportHeight - padding * 2)
    this.zoom = Math.min(availableW / w, availableH / h)
    this.x = bounds.minX - (availableW / this.zoom - w) / 2 - padding / this.zoom
    this.y = bounds.minY - (availableH / this.zoom - h) / 2 - padding / this.zoom
    this.version++
  }

  worldToScreen(world: WorldPoint): ScreenPoint {
    const p = transformPoint(this.getWorldToScreen(), world)
    return screenPoint(p.x, p.y)
  }

  screenToWorld(screen: ScreenPoint): WorldPoint {
    const p = transformPoint(this.getScreenToWorld(), screen)
    return worldPoint(p.x, p.y)
  }

  getWorldToScreen(): Matrix3 {
    this.ensureCache()
    return this.cachedWorldToScreen
  }

  getScreenToWorld(): Matrix3 {
    this.ensureCache()
    return this.cachedScreenToWorld
  }

  /** Visible world AABB for culling. */
  getVisibleWorldBounds(): AABB {
    const tl = this.screenToWorld(screenPoint(0, 0))
    const tr = this.screenToWorld(screenPoint(this.viewportWidth, 0))
    const bl = this.screenToWorld(screenPoint(0, this.viewportHeight))
    const br = this.screenToWorld(screenPoint(this.viewportWidth, this.viewportHeight))
    return {
      minX: Math.min(tl.x, tr.x, bl.x, br.x),
      minY: Math.min(tl.y, tr.y, bl.y, br.y),
      maxX: Math.max(tl.x, tr.x, bl.x, br.x),
      maxY: Math.max(tl.y, tr.y, bl.y, br.y),
    }
  }

  private ensureCache(): void {
    if (this.cacheVersion === this.version) return
    // world → screen: translate(-x,-y) → rotate → scale(zoom) → translate(viewport/2 for rotation center optional)
    // Simpler orthographic: screen = (world - camera) * zoom
    const m = multiply(
      scale(this.zoom, this.zoom),
      multiply(rotate(this.rotation), translate(-this.x, -this.y)),
    )
    this.cachedWorldToScreen = m
    const inv = invert(m)
    this.cachedScreenToWorld = inv ?? cloneMatrix(IDENTITY)
    this.cacheVersion = this.version
  }

  private invalidateCache(): void {
    this.cacheVersion = -1
  }
}
