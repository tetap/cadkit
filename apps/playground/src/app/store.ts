import type { EntityId, LayerId, LengthUnit } from '@cadkit/types'
import type { ToolName } from '@cadkit/editor'

export interface HotProps {
  stroke: string
  fill: string
  opacity: number
  strokeWidth: number
  x: number
  y: number
  width: number
  height: number
  text: string
  fontSize: number
  entityType: string | null
  /** TextEntity has arc path. */
  arcText: boolean
}

export interface MetricsSnapshot {
  frameMs: number
  visibleCount: number
  drawCalls: number
  uploadBytes: number
}

export interface AppState {
  tool: ToolName
  selectionIds: EntityId[]
  canUndo: boolean
  canRedo: boolean
  zoom: number
  displayUnit: LengthUnit
  gridVisible: boolean
  rulersVisible: boolean
  status: string
  metrics: MetricsSnapshot | null
  hot: HotProps
  localeTick: number
  /** Bumped on document mutations from UI so panels can refresh. */
  uiEpoch: number
  /** Bumped when layers are added/edited so the layers panel refreshes. */
  layerEpoch: number
  /** Left floating layers dock visibility. */
  layersOpen: boolean
  /** Right floating image-filters dock visibility. */
  effectsOpen: boolean
  /**
   * Layer whose G-code / engraver params are shown in the right sidebar.
   * Defaults to the active layer; updated when selecting objects or clicking a layer.
   */
  inspectedLayerId: LayerId | null
}

export type AppStore = {
  get(): AppState
  set(patch: Partial<AppState>): void
  subscribe(fn: () => void): () => void
  /** Re-render only when one of the listed keys changes (reference equality). */
  subscribeKeys(keys: (keyof AppState)[], fn: () => void): () => void
}

export const DEFAULT_HOT: HotProps = {
  stroke: '#222222',
  fill: '#222222',
  opacity: 1,
  strokeWidth: 1,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  text: '',
  fontSize: 16,
  entityType: null,
  arcText: false,
}

export function createAppStore(initial?: Partial<AppState>): AppStore {
  let state: AppState = {
    tool: 'select',
    selectionIds: [],
    canUndo: false,
    canRedo: false,
    zoom: 1,
    displayUnit: 'mm',
    gridVisible: true,
    rulersVisible: true,
    status: 'Ready',
    metrics: null,
    hot: { ...DEFAULT_HOT },
    localeTick: 0,
    uiEpoch: 0,
    layerEpoch: 0,
    layersOpen: false,
    effectsOpen: false,
    inspectedLayerId: null,
  }
  if (initial) {
    state = {
      ...state,
      ...initial,
      hot: initial.hot ? { ...state.hot, ...initial.hot } : state.hot,
    }
  }
  const listeners = new Set<() => void>()

  return {
    get: () => state,
    set(patch) {
      state = {
        ...state,
        ...patch,
        hot: patch.hot ? { ...state.hot, ...patch.hot } : state.hot,
      }
      for (const fn of listeners) fn()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    subscribeKeys(keys, fn) {
      let prev = state
      fn()
      return this.subscribe(() => {
        const next = state
        const changed = keys.some((k) => prev[k] !== next[k])
        prev = next
        if (changed) fn()
      })
    },
  }
}
