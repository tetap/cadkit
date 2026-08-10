import { beforeEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale, t } from './index.js'

describe('playground i18n', () => {
  beforeEach(() => {
    setLocale('zh-CN')
  })

  it('translates zh and en', () => {
    expect(t('toolSelect')).toBe('选择')
    setLocale('en-US')
    expect(t('toolSelect')).toBe('Select')
    expect(t('appTitle')).toBe('CADKit Editor')
  })

  it('persists locale', () => {
    setLocale('en-US')
    expect(getLocale()).toBe('en-US')
    expect(localStorage.getItem('cadkit.playground.locale')).toBe('en-US')
  })
})
