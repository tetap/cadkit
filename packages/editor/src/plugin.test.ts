import { describe, expect, it, vi } from 'vitest'
import { PluginHost, type EditorPlugin } from './plugin.js'
import type { Editor } from './Editor.js'

describe('PluginHost', () => {
  it('enforces uniqueness and dependencies, runs cleanup', () => {
    const host = new PluginHost({} as Editor)
    const cleanup = vi.fn()
    const a: EditorPlugin = { name: 'a', setup: () => cleanup }
    const b: EditorPlugin = { name: 'b', dependencies: ['a'], setup: () => undefined }
    expect(() => host.use({ name: 'b', dependencies: ['missing'], setup: () => undefined })).toThrow(
      /dependency/,
    )
    host.use(a)
    host.use(b)
    expect(() => host.use(a)).toThrow(/already installed/)
    host.dispose()
    expect(cleanup).toHaveBeenCalled()
  })
})
