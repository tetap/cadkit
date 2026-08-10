import type { CapabilityReport, PerformanceProfile, RendererKind } from '@cadkit/types'

type GpuNavigator = {
  gpu?: {
    requestAdapter: () => Promise<unknown>
  }
  deviceMemory?: number
  storage?: {
    getDirectory?: () => Promise<unknown>
  }
}

export async function detectCapabilities(): Promise<CapabilityReport> {
  const webgpu = await detectWebGPU()
  const offscreenCanvas = typeof OffscreenCanvas !== 'undefined'
  const sharedArrayBuffer =
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof crossOriginIsolated !== 'undefined' &&
    crossOriginIsolated
  const wasmThreads = sharedArrayBuffer
  const nav = navigator as unknown as GpuNavigator
  const opfs = !!nav.storage?.getDirectory
  const profile = pickProfile(webgpu)
  const recommendedRenderer: RendererKind = 'webgpu'

  return {
    webgpu,
    offscreenCanvas,
    sharedArrayBuffer,
    wasmThreads,
    opfs,
    maxGpuBufferSize: webgpu ? 256 * 1024 * 1024 : 0,
    recommendedRenderer,
    profile,
  }
}

async function detectWebGPU(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as unknown as GpuNavigator
  if (!nav.gpu) return false
  try {
    const adapter = await nav.gpu.requestAdapter()
    return !!adapter
  } catch {
    return false
  }
}

function pickProfile(webgpu: boolean): PerformanceProfile {
  if (!webgpu) return 'compat'
  const mem = (navigator as unknown as GpuNavigator).deviceMemory
  if (mem && mem <= 4) return 'desktop-integrated'
  return 'desktop-high'
}

export function resolveView(view?: HTMLCanvasElement | string | Window): HTMLCanvasElement {
  if (view instanceof HTMLCanvasElement) return view
  if (typeof view === 'string') {
    const el = document.querySelector(view)
    if (el instanceof HTMLCanvasElement) return el
    throw new Error(`Canvas not found: ${view}`)
  }
  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  document.body.appendChild(canvas)
  return canvas
}

/**
 * Ensure the canvas sits in a positioned host that can hold rulers / overlays.
 * Returns the host element (creates a wrapper when the canvas parent is unsuitable).
 */
export function ensureEditorHost(canvas: HTMLCanvasElement): HTMLElement {
  const parent = canvas.parentElement
  if (parent && getComputedStyle(parent).position !== 'static') {
    parent.style.position = parent.style.position || 'relative'
    return parent
  }
  const host = document.createElement('div')
  host.className = 'cadkit-host'
  Object.assign(host.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: '#e8e8e8',
  } as Partial<CSSStyleDeclaration>)
  if (parent) {
    parent.insertBefore(host, canvas)
    host.appendChild(canvas)
  } else {
    document.body.appendChild(host)
    host.appendChild(canvas)
  }
  return host
}
