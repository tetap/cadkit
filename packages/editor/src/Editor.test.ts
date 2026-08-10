import { describe, expect, it, vi, beforeEach } from 'vitest'
import { IDENTITY_TRANSFORM, createEntityId } from '@cadkit/types'

vi.mock('@cadkit/platform-web', () => ({
  detectCapabilities: vi.fn(async () => ({
    webgpu: true,
    offscreenCanvas: true,
    sharedArrayBuffer: false,
    wasmThreads: false,
    opfs: false,
    maxGpuBufferSize: 256 * 1024 * 1024,
    recommendedRenderer: 'webgpu' as const,
    profile: 'desktop-high' as const,
  })),
  resolveView: (view?: HTMLCanvasElement | string) => {
    if (view instanceof HTMLCanvasElement) return view
    const c = document.createElement('canvas')
    document.body.appendChild(c)
    return c
  },
  ensureEditorHost: (canvas: HTMLCanvasElement) => {
    const host = document.createElement('div')
    host.style.position = 'relative'
    canvas.parentElement?.insertBefore(host, canvas)
    host.appendChild(canvas)
    return host
  },
}))

vi.mock('@cadkit/render-webgpu', () => {
  class FakeWebGPU {
    kind = 'webgpu' as const
    static async isSupported() {
      return true
    }
    async initialize() {}
    resize() {}
    render() {
      return {
        frameMs: 1,
        drawCalls: 1,
        visibleCount: 0,
        uploadBytes: 0,
        memoryMB: 1,
        backend: 'webgpu' as const,
      }
    }
    dispose() {}
  }
  return { WebGPURenderer: FakeWebGPU }
})

describe('Editor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('creates, edits, switches units/guides, and disposes', async () => {
    const { createEditor } = await import('./Editor.js')
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const editor = await createEditor({
      view: canvas,
      renderer: 'webgpu',
      guides: { rulers: true, grid: true, rulerSize: 24 },
      document: { unit: 'mm', displayUnit: 'mm', tolerance: 1e-6, schemaVersion: 1 },
    })

    expect(['ready', 'running']).toContain(editor.getLifecycle())
    const id = createEntityId('line')
    editor.add({
      id,
      type: 'line',
      layerId: editor.document.getDefaultLayerId(),
      style: { stroke: '#0f0' },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    expect(editor.document.count()).toBe(1)
    editor.select([id])
    expect(editor.selection.has(id)).toBe(true)
    editor.setDisplayUnit('in')
    expect(editor.getDisplayUnit()).toBe('in')
    editor.setGridVisible(false)
    editor.setRulersVisible(false)
    editor.fitView()
    editor.undo()
    editor.redo()
    await editor.dispose()
    expect(editor.getLifecycle()).toBe('disposed')
  })
})
