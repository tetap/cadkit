export interface ImeEditorOptions {
  container?: HTMLElement
  onCommit: (text: string) => void
  onChange?: (text: string) => void
  onCancel?: () => void
  /** Fired when caret / selection changes (hidden IME → canvas caret). */
  onSelectionChange?: (sel: { start: number; end: number; text: string }) => void
}

export interface ImeTextStyle {
  fontFamily?: string
  color?: string
  width?: number
  textAlign?: 'left' | 'center' | 'right'
}

export interface ImeSelection {
  start: number
  end: number
}

/**
 * Fabric-style IME proxy: keeps a focused but visually hidden textarea so
 * composition works, while the canvas/TextOverlay shows the draft + caret.
 */
export class ImeTextEditor {
  private textarea: HTMLTextAreaElement | null = null
  private active = false
  private suppressBlur = false
  private blurTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: ImeEditorOptions) {}

  /**
   * @param clientX viewport X near the caret (for IME candidate window)
   * @param clientY viewport Y near the caret baseline
   */
  start(
    initial: string,
    clientX: number,
    clientY: number,
    fontSize: number,
    textStyle: ImeTextStyle = {},
    selection?: ImeSelection,
  ): void {
    this.ensure()
    const el = this.textarea!
    el.value = initial
    const size = Math.max(12, fontSize)
    Object.assign(el.style, {
      left: `${Math.max(0, clientX)}px`,
      top: `${Math.max(0, clientY - size)}px`,
      width: '2px',
      height: `${size}px`,
      minWidth: '2px',
      minHeight: `${size}px`,
      fontSize: `${size}px`,
      lineHeight: `${size}px`,
      opacity: '0',
      pointerEvents: 'none',
      color: 'transparent',
      caretColor: 'transparent',
      background: 'transparent',
      border: 'none',
      borderRadius: '0',
      padding: '0',
      boxSizing: 'border-box',
      boxShadow: 'none',
      resize: 'none',
      overflow: 'hidden',
      fontFamily: textStyle.fontFamily ?? 'ui-sans-serif, system-ui, sans-serif',
      textAlign: textStyle.textAlign ?? 'left',
    } as Partial<CSSStyleDeclaration>)
    this.active = true
    const len = initial.length
    const start = Math.max(0, Math.min(selection?.start ?? len, len))
    const end = Math.max(0, Math.min(selection?.end ?? start, len))
    this.emitSelection()
    this.options.onChange?.(initial)
    // Defer focus so it wins over canvas pointer capture / tool handlers.
    requestAnimationFrame(() => {
      if (!this.active || !this.textarea) return
      this.textarea.focus({ preventScroll: true })
      this.textarea.setSelectionRange(start, end)
      this.emitSelection()
    })
  }

  /** Move the invisible IME hit-target near the on-canvas caret. */
  moveTo(clientX: number, clientY: number, fontSize: number): void {
    if (!this.textarea || !this.active) return
    const size = Math.max(12, fontSize)
    this.textarea.style.left = `${Math.max(0, clientX)}px`
    this.textarea.style.top = `${Math.max(0, clientY - size)}px`
    this.textarea.style.height = `${size}px`
  }

  /**
   * Keep IME focused across canvas pointer events (click-to-caret / drag-select).
   * Without this, textarea blur would commit the edit immediately.
   */
  retainFocus(): void {
    if (!this.active || !this.textarea) return
    this.suppressBlur = true
    if (this.blurTimer) {
      clearTimeout(this.blurTimer)
      this.blurTimer = null
    }
    requestAnimationFrame(() => {
      if (!this.active || !this.textarea) {
        this.suppressBlur = false
        return
      }
      this.textarea.focus({ preventScroll: true })
      this.suppressBlur = false
    })
  }

  setSelection(start: number, end: number): void {
    if (!this.textarea || !this.active) return
    const len = this.textarea.value.length
    const a = Math.max(0, Math.min(start, len))
    const b = Math.max(0, Math.min(end, len))
    this.retainFocus()
    this.textarea.setSelectionRange(a, b)
    this.emitSelection()
  }

  stop(commit: boolean): void {
    if (!this.textarea || !this.active) return
    const value = this.textarea.value
    this.active = false
    this.suppressBlur = true
    if (this.blurTimer) {
      clearTimeout(this.blurTimer)
      this.blurTimer = null
    }
    this.textarea.style.pointerEvents = 'none'
    this.textarea.style.opacity = '0'
    this.textarea.blur()
    this.suppressBlur = false
    if (commit) this.options.onCommit(value)
    else this.options.onCancel?.()
  }

  isActive(): boolean {
    return this.active
  }

  getValue(): string {
    return this.textarea?.value ?? ''
  }

  getSelection(): { start: number; end: number } {
    if (!this.textarea) return { start: 0, end: 0 }
    return {
      start: this.textarea.selectionStart ?? 0,
      end: this.textarea.selectionEnd ?? 0,
    }
  }

  dispose(): void {
    if (this.blurTimer) {
      clearTimeout(this.blurTimer)
      this.blurTimer = null
    }
    this.textarea?.remove()
    this.textarea = null
    this.active = false
  }

  private emitSelection(): void {
    if (!this.textarea) return
    this.options.onSelectionChange?.({
      start: this.textarea.selectionStart ?? 0,
      end: this.textarea.selectionEnd ?? 0,
      text: this.textarea.value,
    })
  }

  private ensure(): void {
    if (this.textarea) return
    const el = document.createElement('textarea')
    el.className = 'cadkit-ime'
    el.setAttribute('autocomplete', 'off')
    el.setAttribute('autocorrect', 'off')
    el.setAttribute('autocapitalize', 'off')
    el.setAttribute('aria-label', 'Text input')
    el.spellcheck = false
    el.rows = 1
    Object.assign(el.style, {
      position: 'fixed',
      zIndex: '10000',
      margin: '0',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      opacity: '0',
    } as Partial<CSSStyleDeclaration>)
    el.addEventListener('input', () => {
      this.options.onChange?.(el.value)
      this.emitSelection()
    })
    el.addEventListener('keyup', (e) => {
      e.stopPropagation()
      this.emitSelection()
    })
    el.addEventListener('click', () => this.emitSelection())
    el.addEventListener('select', () => this.emitSelection())
    el.addEventListener('compositionupdate', () => {
      this.options.onChange?.(el.value)
      this.emitSelection()
    })
    el.addEventListener('compositionend', () => {
      this.options.onChange?.(el.value)
      this.emitSelection()
    })
    // Clicking elsewhere finishes the in-place edit (deferred so retainFocus can win).
    el.addEventListener('blur', () => {
      if (this.suppressBlur || !this.active) return
      if (this.blurTimer) clearTimeout(this.blurTimer)
      this.blurTimer = setTimeout(() => {
        this.blurTimer = null
        if (this.suppressBlur || !this.active) return
        if (document.activeElement === this.textarea) return
        this.stop(true)
      }, 0)
    })
    el.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        this.stop(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.stop(false)
      } else {
        // Arrow / shift selection updates after the key applies.
        requestAnimationFrame(() => this.emitSelection())
      }
    })
    el.addEventListener('keypress', (e) => e.stopPropagation())
    ;(this.options.container ?? document.body).appendChild(el)
    this.textarea = el
  }
}
