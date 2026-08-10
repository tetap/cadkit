import { describe, expect, it } from 'vitest'
import { jsWasmFallback } from './abi.js'

describe('wasm js fallback', () => {
  it('tessellates arcs in batch', () => {
    const out = jsWasmFallback.tessellateArcs(
      new Float64Array([0, 0]),
      new Float64Array([10]),
      new Float64Array([0]),
      new Float64Array([Math.PI]),
      0.5,
      1,
    )
    expect(out[0]).toBeGreaterThan(2)
  })
})
