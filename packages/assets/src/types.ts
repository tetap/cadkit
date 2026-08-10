export type AssetId = string & { readonly __brand: 'AssetId' }

export function createAssetId(prefix = 'asset'): AssetId {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}` as AssetId
}

export type AssetErrorKind = 'decode' | 'network' | 'unsupported' | 'budget' | 'unknown'

export class AssetError extends Error {
  constructor(
    readonly kind: AssetErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'AssetError'
  }
}

export type AssetStatus = 'loading' | 'ready' | 'error'

export interface ImageAsset {
  id: AssetId
  href: string
  mimeType?: string
  width: number
  height: number
  bitmap: ImageBitmap | null
  status: AssetStatus
  error?: AssetError
  refCount: number
  byteSize: number
  lastUsed: number
}
