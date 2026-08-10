import {
  AssetError,
  createAssetId,
  type AssetId,
  type ImageAsset,
} from './types.js'

class SimpleBudget {
  private used = 0
  private readonly entries = new Map<string, number>()
  constructor(private budgetMB: number) {}
  track(key: string, bytes: number): void {
    const prev = this.entries.get(key) ?? 0
    this.used += bytes - prev
    this.entries.set(key, bytes)
  }
  release(key: string): void {
    const prev = this.entries.get(key) ?? 0
    this.used -= prev
    this.entries.delete(key)
  }
  shouldEvict(): boolean {
    return this.used / (1024 * 1024) >= this.budgetMB * 0.8
  }
}

export interface AssetRegistryOptions {
  budgetMB?: number
}

/**
 * Document-scoped image asset registry with decode, ref-count, and GPU-side budget hooks.
 */
export class AssetRegistry {
  private readonly assets = new Map<AssetId, ImageAsset>()
  private readonly hrefIndex = new Map<string, AssetId>()
  private readonly budget: SimpleBudget
  private gpuTextures = new Map<AssetId, { bytes: number; lastUsed: number }>()

  constructor(opts: AssetRegistryOptions = {}) {
    this.budget = new SimpleBudget(opts.budgetMB ?? 256)
  }

  get(id: AssetId): ImageAsset | undefined {
    const a = this.assets.get(id)
    if (a) a.lastUsed = performance.now()
    return a
  }

  getByHref(href: string): ImageAsset | undefined {
    const id = this.hrefIndex.get(href)
    return id ? this.get(id) : undefined
  }

  retain(id: AssetId): void {
    const a = this.assets.get(id)
    if (a) a.refCount++
  }

  release(id: AssetId): void {
    const a = this.assets.get(id)
    if (!a) return
    a.refCount = Math.max(0, a.refCount - 1)
    if (a.refCount === 0) this.maybeEvict()
  }

  async importFile(file: File | Blob, hrefHint?: string): Promise<ImageAsset> {
    const href =
      hrefHint ??
      (file instanceof File ? `file://${file.name}` : `blob:${createAssetId('blob')}`)
    try {
      const bitmap = await createImageBitmap(file)
      return this.registerBitmap(href, bitmap, file.type || undefined)
    } catch (err) {
      throw new AssetError('decode', 'Failed to decode image blob/file', err)
    }
  }

  async importUrl(url: string): Promise<ImageAsset> {
    const existing = this.getByHref(url)
    if (existing?.status === 'ready') {
      this.retain(existing.id)
      return existing
    }
    try {
      const res = await fetch(url)
      if (!res.ok) throw new AssetError('network', `HTTP ${res.status} for ${url}`)
      const blob = await res.blob()
      return this.importFile(blob, url)
    } catch (err) {
      if (err instanceof AssetError) throw err
      throw new AssetError('network', `Failed to fetch ${url}`, err)
    }
  }

  registerBitmap(href: string, bitmap: ImageBitmap, mimeType?: string): ImageAsset {
    const existing = this.getByHref(href)
    if (existing) {
      existing.bitmap?.close()
      existing.bitmap = bitmap
      existing.width = bitmap.width
      existing.height = bitmap.height
      existing.status = 'ready'
      existing.byteSize = bitmap.width * bitmap.height * 4
      existing.mimeType = mimeType ?? existing.mimeType
      this.retain(existing.id)
      this.budget.track(existing.id, existing.byteSize)
      this.maybeEvict()
      return existing
    }
    const id = createAssetId('img')
    const asset: ImageAsset = {
      id,
      href,
      mimeType,
      width: bitmap.width,
      height: bitmap.height,
      bitmap,
      status: 'ready',
      refCount: 1,
      byteSize: bitmap.width * bitmap.height * 4,
      lastUsed: performance.now(),
    }
    this.assets.set(id, asset)
    this.hrefIndex.set(href, id)
    this.budget.track(id, asset.byteSize)
    this.maybeEvict()
    return asset
  }

  /** Track a GPU texture allocation for LRU eviction decisions. */
  trackGpuTexture(id: AssetId, bytes: number): void {
    this.gpuTextures.set(id, { bytes, lastUsed: performance.now() })
    this.budget.track(`gpu:${id}`, bytes)
    this.maybeEvict()
  }

  releaseGpuTexture(id: AssetId): void {
    this.gpuTextures.delete(id)
    this.budget.release(`gpu:${id}`)
  }

  list(): ImageAsset[] {
    return [...this.assets.values()]
  }

  private maybeEvict(): void {
    if (!this.budget.shouldEvict()) return
    const candidates = [...this.assets.values()]
      .filter((a) => a.refCount === 0 && a.bitmap)
      .sort((a, b) => a.lastUsed - b.lastUsed)
    for (const a of candidates) {
      a.bitmap?.close()
      a.bitmap = null
      this.budget.release(a.id)
      this.releaseGpuTexture(a.id)
      if (!this.budget.shouldEvict()) break
    }
  }
}
