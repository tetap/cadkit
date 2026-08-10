import { describe, expect, it } from 'vitest'
import { LINE_SHADER, PICK_SHADER } from './shaders.js'

describe('shaders', () => {
  it('exports WGSL entry points', () => {
    expect(LINE_SHADER).toContain('vsMain')
    expect(LINE_SHADER).toContain('fsMain')
    expect(PICK_SHADER).toContain('vsMain')
    expect(PICK_SHADER).toContain('fsMain')
  })
})
