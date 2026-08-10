import { describe, expect, it, vi, beforeEach } from 'vitest'
import { detectCapabilities, ensureEditorHost, resolveView } from './capabilities.js'

describe('platform-web', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('detectCapabilities without gpu → compat', async () => {
    vi.stubGlobal('navigator', { storage: {} })
    const caps = await detectCapabilities()
    expect(caps.webgpu).toBe(false)
    expect(caps.profile).toBe('compat')
    expect(caps.recommendedRenderer).toBe('webgpu')
    vi.unstubAllGlobals()
  })

  it('resolveView and ensureEditorHost', () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    expect(resolveView(canvas)).toBe(canvas)
    const host = ensureEditorHost(canvas)
    expect(host.contains(canvas)).toBe(true)
    expect(() => resolveView('#missing-canvas')).toThrow(/not found/)
  })
})
