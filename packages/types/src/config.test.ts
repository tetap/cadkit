import { describe, expect, it } from 'vitest'
import { DEFAULT_EDITOR_CONFIG, mergeEditorConfig } from './config.js'
import { IDENTITY_TRANSFORM } from './entities.js'
import { createEntityId, asEntityId } from './ids.js'
import { worldPoint, screenPoint, vec2 } from './coordinates.js'

describe('config + ids + coordinates', () => {
  it('mergeEditorConfig deep-merges nested sections', () => {
    const cfg = mergeEditorConfig({
      theme: 'dark',
      document: { displayUnit: 'in' },
      guides: { rulers: false },
    })
    expect(cfg.theme).toBe('dark')
    expect(cfg.document.unit).toBe(DEFAULT_EDITOR_CONFIG.document.unit)
    expect(cfg.document.displayUnit).toBe('in')
    expect(cfg.guides.rulers).toBe(false)
    expect(cfg.guides.grid).toBe(true)
    expect(cfg.guides.workArea.mode).toBe('unbounded')
    expect(cfg.renderer).toBe('webgpu')

    const page = mergeEditorConfig({
      guides: { workArea: { mode: 'page', width: 100, height: 80 } },
    })
    expect(page.guides.workArea.mode).toBe('page')
    expect(page.guides.workArea.width).toBe(100)
    expect(page.guides.workArea.height).toBe(80)
    expect(page.guides.workArea.originX).toBe(0)
  })

  it('creates branded ids and points', () => {
    const a = createEntityId('e')
    const b = createEntityId('e')
    expect(a).not.toBe(b)
    expect(asEntityId('x')).toBe('x')
    expect(worldPoint(1, 2).__space).toBe('world')
    expect(screenPoint(3, 4).__space).toBe('screen')
    expect(vec2(5, 6)).toEqual({ x: 5, y: 6 })
    expect(IDENTITY_TRANSFORM).toEqual([1, 0, 0, 1, 0, 0])
  })
})
