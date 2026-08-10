import { describe, expect, it, vi } from 'vitest'
import { ImeTextEditor } from './ime.js'

describe('ImeTextEditor', () => {
  it('starts hidden, commits on Enter, cancels on Escape', async () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const onChange = vi.fn()
    const onSelectionChange = vi.fn()
    const ime = new ImeTextEditor({ onCommit, onCancel, onChange, onSelectionChange })
    ime.start('hi', 10, 20, 14)
    expect(ime.isActive()).toBe(true)
    const el = document.querySelector('textarea.cadkit-ime') as HTMLTextAreaElement
    expect(el).toBeTruthy()
    expect(el.style.opacity).toBe('0')
    expect(onChange).toHaveBeenCalledWith('hi')
    el.value = 'hello'
    el.dispatchEvent(new Event('input'))
    expect(onChange).toHaveBeenCalledWith('hello')
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onCommit).toHaveBeenCalledWith('hello')
    expect(ime.isActive()).toBe(false)

    ime.start('x', 0, 0, 12)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalled()
    ime.dispose()
    expect(document.querySelector('textarea.cadkit-ime')).toBeNull()
  })

  it('moveTo parks the IME near the caret', () => {
    const ime = new ImeTextEditor({ onCommit: () => {} })
    ime.start('', 0, 0, 12)
    ime.moveTo(40, 80, 16)
    const el = document.querySelector('textarea.cadkit-ime') as HTMLTextAreaElement
    expect(el.style.left).toBe('40px')
    expect(el.style.top).toBe('64px')
    ime.dispose()
  })
})
