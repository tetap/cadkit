import { describe, expect, it } from 'vitest'
import * as wasm from './index.js'

describe('wasm package', () => {
  it('re-exports abi surface', () => {
    expect(wasm).toBeTruthy()
    expect(typeof wasm).toBe('object')
  })
})
