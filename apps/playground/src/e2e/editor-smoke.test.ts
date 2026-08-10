/**
 * Lightweight smoke for playground contracts (tools list + filter WGSL).
 * Full browser E2E (PNG drag / WebGPU) is manual via `pnpm playground:dev`.
 */
import { describe, expect, it } from 'vitest'
import { validateCustomFilterBody, applyBuiltinFilterCpu, gaussianKernel1D } from '@cadkit/assets'

describe('playground editor smoke', () => {
  it('validates custom WGSL filter contract', () => {
    expect(validateCustomFilterBody('return color;').ok).toBe(true)
    expect(validateCustomFilterBody('@group(0) var x: f32; return color;').ok).toBe(false)
  })

  it('builtin filter math + blur kernel', () => {
    const out = applyBuiltinFilterCpu([1, 0, 0, 1], {
      id: '1',
      type: 'invert',
      params: {},
    })
    expect(out[0]).toBeCloseTo(0)
    const k = gaussianKernel1D(2)
    expect(k.length).toBe(5)
    expect([...k].reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })
})
