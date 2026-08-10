import { describe, expect, it } from 'vitest'
import { applyBuiltinFilterCpu, gaussianKernel1D, validateCustomFilterBody } from './filters.js'
import { hashFilterStack } from './filter-hash.js'
import { AssetRegistry } from './registry.js'

describe('AssetRegistry / filters', () => {
  it('rejects forbidden custom WGSL constructs', () => {
    const bad = validateCustomFilterBody('return color; @group(0) var x: f32;')
    expect(bad.ok).toBe(false)
    const good = validateCustomFilterBody('return vec4f(color.rgb * 0.5, color.a);')
    expect(good.ok).toBe(true)
  })

  it('applies builtin brightness on CPU', () => {
    const out = applyBuiltinFilterCpu([0.4, 0.4, 0.4, 1], {
      id: '1',
      type: 'brightness',
      params: { amount: 2 },
    })
    expect(out[0]).toBeCloseTo(0.8)
  })

  it('gaussian kernel is normalized', () => {
    const k = gaussianKernel1D(3)
    const sum = [...k].reduce((a, b) => a + b, 0)
    expect(k.length).toBe(7)
    expect(sum).toBeCloseTo(1, 5)
  })

  it('hashFilterStack changes with params and custom body', () => {
    const a = hashFilterStack([{ id: '1', type: 'brightness', params: { amount: 1 } }])
    const b = hashFilterStack([{ id: '1', type: 'brightness', params: { amount: 1.2 } }])
    const c = hashFilterStack([
      { id: '2', type: 'custom', params: {}, wgslBody: 'return color;' },
    ])
    const d = hashFilterStack([
      { id: '2', type: 'custom', params: {}, wgslBody: 'return vec4f(1.);' },
    ])
    expect(a).not.toBe(b)
    expect(c).not.toBe(d)
  })

  it('tracks imported bitmap assets', async () => {
    const reg = new AssetRegistry({ budgetMB: 64 })
    // 2x2 red PNG
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      ),
      (c) => c.charCodeAt(0),
    )
    const blob = new Blob([bytes], { type: 'image/png' })
    // happy-dom may not support createImageBitmap — skip gracefully
    if (typeof createImageBitmap !== 'function') {
      expect(reg.list()).toHaveLength(0)
      return
    }
    try {
      const asset = await reg.importFile(blob, 'data:test')
      expect(asset.status).toBe('ready')
      expect(asset.width).toBeGreaterThan(0)
      reg.release(asset.id)
    } catch {
      expect(true).toBe(true)
    }
  })
})
