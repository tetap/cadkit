import { describe, expect, it } from 'vitest'
import { asEntityId } from '@cadkit/types'
import { SelectionSet } from './selection.js'

describe('SelectionSet', () => {
  it('set/add/toggle/remove/clear', () => {
    const s = new SelectionSet()
    const a = asEntityId('a')
    const b = asEntityId('b')
    s.set([a])
    expect(s.has(a)).toBe(true)
    s.add(b)
    expect(s.size).toBe(2)
    s.toggle(a)
    expect(s.has(a)).toBe(false)
    s.remove(b)
    expect(s.size).toBe(0)
    s.set([a, b])
    s.clear()
    expect(s.toArray()).toEqual([])
    expect(s.asReadonly().size).toBe(0)
  })
})
