import type { PerformanceProfile, RendererKind } from './lifecycle.js'

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'px' | 'pt'

export interface DocumentConfig {
  /** World / storage unit for entity coordinates */
  unit: LengthUnit
  /** Unit shown on rulers / grid labels (may differ from storage) */
  displayUnit: LengthUnit
  tolerance: number
  schemaVersion: number
}

/** Viewport background grid extent. */
export type WorkAreaMode = 'unbounded' | 'page'

/**
 * Work area / page used by guides.
 * - `unbounded`: infinite grid filling the viewport (CAD paperless mode)
 * - `page`: finite page rectangle in world units; grid only inside the page
 */
export interface WorkAreaConfig {
  mode: WorkAreaMode
  /** Page width in document/storage units */
  width: number
  /** Page height in document/storage units */
  height: number
  originX: number
  originY: number
}

export interface GuidesConfig {
  rulers: boolean
  grid: boolean
  rulerSize: number
  workArea: WorkAreaConfig
}

/** Object-mode empty-space hit testing relative to the selection AABB. */
export type SelectionHitMode = 'geometry' | 'bounds'

export interface InteractionConfig {
  /** `bounds` = click inside selection frame keeps selection; `geometry` = old pick-only behavior */
  selectionHitMode: SelectionHitMode
  /** Snap drawing / drag endpoints */
  snapEnabled: boolean
  pixelTolerance: number
  gridSize: number
  /** Element AABB alignment while dragging */
  alignEnabled: boolean
  /** Show spacing labels on active align guides */
  showDistances: boolean
  /** Rotate handle snaps to this step in degrees (0 = off) */
  angleStepDeg: number
  /** Pan tool inertia friction per second (higher = stops sooner), ~3–8 typical */
  panDamping: number
}

export const DEFAULT_INTERACTION_CONFIG: InteractionConfig = {
  selectionHitMode: 'bounds',
  snapEnabled: true,
  pixelTolerance: 8,
  gridSize: 10,
  alignEnabled: true,
  showDistances: true,
  angleStepDeg: 15,
  panDamping: 5,
}

export interface PerformanceConfig {
  profile: PerformanceProfile
  memoryBudgetMB: number
  lodNavigationPx: number
  lodStablePx: number
  textBudget: number
  maxDirtyRects: number
  dirtyMergeAreaRatio: number
}

export interface EditorConfig {
  view?: HTMLCanvasElement | string | Window
  /** WebGPU only — Canvas2D path removed for max performance */
  renderer: RendererKind
  document: DocumentConfig
  guides: GuidesConfig
  performance: PerformanceConfig
  interaction: InteractionConfig
  dpr?: number
  msaa?: 1 | 4 | 8
  workers?: number
  theme?: 'light' | 'dark'
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug'
  experimental?: Record<string, boolean>
}

export interface CapabilityReport {
  webgpu: boolean
  offscreenCanvas: boolean
  sharedArrayBuffer: boolean
  wasmThreads: boolean
  opfs: boolean
  maxGpuBufferSize: number
  recommendedRenderer: RendererKind
  profile: PerformanceProfile
}

export const DEFAULT_DOCUMENT_CONFIG: DocumentConfig = {
  unit: 'mm',
  displayUnit: 'mm',
  tolerance: 1e-6,
  schemaVersion: 1,
}

export const DEFAULT_WORK_AREA: WorkAreaConfig = {
  mode: 'unbounded',
  width: 210,
  height: 297,
  originX: 0,
  originY: 0,
}

export const DEFAULT_GUIDES_CONFIG: GuidesConfig = {
  rulers: true,
  grid: true,
  rulerSize: 24,
  workArea: DEFAULT_WORK_AREA,
}

export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  profile: 'auto',
  memoryBudgetMB: 1024,
  lodNavigationPx: 0.75,
  lodStablePx: 0.35,
  textBudget: 2000,
  maxDirtyRects: 8,
  dirtyMergeAreaRatio: 0.6,
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  renderer: 'webgpu',
  document: DEFAULT_DOCUMENT_CONFIG,
  guides: DEFAULT_GUIDES_CONFIG,
  performance: DEFAULT_PERFORMANCE_CONFIG,
  interaction: DEFAULT_INTERACTION_CONFIG,
  dpr: typeof globalThis !== 'undefined' && 'devicePixelRatio' in globalThis
    ? (globalThis as { devicePixelRatio: number }).devicePixelRatio
    : 1,
  msaa: 4,
  workers: 4,
  theme: 'light',
  logLevel: 'warn',
  experimental: {},
}

export type EditorConfigPatch = Omit<
  Partial<EditorConfig>,
  'document' | 'guides' | 'performance' | 'interaction'
> & {
  document?: Partial<DocumentConfig>
  guides?: Omit<Partial<GuidesConfig>, 'workArea'> & { workArea?: Partial<WorkAreaConfig> }
  performance?: Partial<PerformanceConfig>
  interaction?: Partial<InteractionConfig>
}

export function mergeEditorConfig(partial?: EditorConfigPatch): EditorConfig {
  return {
    ...DEFAULT_EDITOR_CONFIG,
    ...partial,
    document: { ...DEFAULT_DOCUMENT_CONFIG, ...partial?.document },
    guides: {
      ...DEFAULT_GUIDES_CONFIG,
      ...partial?.guides,
      workArea: { ...DEFAULT_WORK_AREA, ...partial?.guides?.workArea },
    },
    performance: { ...DEFAULT_PERFORMANCE_CONFIG, ...partial?.performance },
    interaction: { ...DEFAULT_INTERACTION_CONFIG, ...partial?.interaction },
    experimental: { ...DEFAULT_EDITOR_CONFIG.experimental, ...partial?.experimental },
  }
}
