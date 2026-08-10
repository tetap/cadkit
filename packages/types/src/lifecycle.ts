export type EditorLifecycle =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'suspended'
  | 'disposing'
  | 'disposed'

export type DocumentSessionState =
  | 'empty'
  | 'loading'
  | 'active'
  | 'saving'
  | 'error'
  | 'closed'

export type FramePhase =
  | 'beforeUpdate'
  | 'update'
  | 'bounds'
  | 'index'
  | 'cull'
  | 'prepare'
  | 'render'
  | 'afterRender'

/** Only WebGPU is supported for maximum performance. */
export type RendererKind = 'webgpu'

export type PerformanceProfile = 'auto' | 'desktop-high' | 'desktop-integrated' | 'compat'
