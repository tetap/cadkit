import type { EntityId } from './ids.js'
import type { ScreenPoint, WorldPoint } from './coordinates.js'
import type { DocumentSessionState, EditorLifecycle, FramePhase } from './lifecycle.js'

export type Disposer = () => void

export interface EditorEvents {
  'lifecycle:change': { from: EditorLifecycle; to: EditorLifecycle }
  'document:session': { state: DocumentSessionState; reason?: string }
  'selection:change': { ids: EntityId[] }
  'camera:change': { zoom: number; center: WorldPoint }
  'tool:change': { tool: string }
  'pointer:down': { screen: ScreenPoint; world: WorldPoint; button: number }
  'pointer:move': { screen: ScreenPoint; world: WorldPoint }
  'pointer:up': { screen: ScreenPoint; world: WorldPoint; button: number }
  'frame:phase': { phase: FramePhase; dt: number }
  'metrics': {
    frameMs: number
    drawCalls: number
    visibleCount: number
    uploadBytes: number
    memoryMB: number
  }
  'import:progress': { loaded: number; total?: number; warnings: number }
  'error': { message: string; cause?: unknown }
}

export type EventName = keyof EditorEvents

export interface EventBus {
  on<K extends EventName>(name: K, handler: (payload: EditorEvents[K]) => void): Disposer
  once<K extends EventName>(name: K, handler: (payload: EditorEvents[K]) => void): Disposer
  off<K extends EventName>(name: K, handler: (payload: EditorEvents[K]) => void): void
  emit<K extends EventName>(name: K, payload: EditorEvents[K]): void
}

export function createEventBus(): EventBus {
  const map = new Map<EventName, Set<(payload: never) => void>>()

  const on = <K extends EventName>(name: K, handler: (payload: EditorEvents[K]) => void): Disposer => {
    let set = map.get(name)
    if (!set) {
      set = new Set()
      map.set(name, set)
    }
    set.add(handler as (payload: never) => void)
    return () => off(name, handler)
  }

  const once = <K extends EventName>(name: K, handler: (payload: EditorEvents[K]) => void): Disposer => {
    const dispose = on(name, (payload) => {
      dispose()
      handler(payload)
    })
    return dispose
  }

  const off = <K extends EventName>(name: K, handler: (payload: EditorEvents[K]) => void): void => {
    map.get(name)?.delete(handler as (payload: never) => void)
  }

  const emit = <K extends EventName>(name: K, payload: EditorEvents[K]): void => {
    const set = map.get(name)
    if (!set) return
    for (const handler of [...set]) {
      ;(handler as (payload: EditorEvents[K]) => void)(payload)
    }
  }

  return { on, once, off, emit }
}
