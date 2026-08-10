import { describe, expect, it } from 'vitest'
import { WebGPURenderer } from './webgpu-renderer.js'

describe('WebGPURenderer', () => {
  it('reports unsupported without navigator.gpu', async () => {
    const prev = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    })
    expect(await WebGPURenderer.isSupported()).toBe(false)
    Object.defineProperty(globalThis, 'navigator', {
      value: prev,
      configurable: true,
    })
  })

  it('render before initialize returns empty metrics', () => {
    const r = new WebGPURenderer()
    expect(r.kind).toBe('webgpu')
    const m = r.render({
      camera: {
        getWorldToScreen: () => [1, 0, 0, 1, 0, 0],
      } as never,
      items: [],
      selected: new Set(),
    })
    expect(m.drawCalls).toBe(0)
    r.dispose()
    r.dispose()
  })
})
