import type { Editor, ToolName } from '@cadkit/editor'
import type { AppStore } from '../app/store.js'
import { t, type MessageKey } from '../i18n/index.js'
import { ICONS, type IconName } from './icons.js'
import { btnIcon } from './tokens.js'

interface ToolDef {
  name: ToolName
  icon: IconName
  labelKey: MessageKey
  tipKey: MessageKey
  shortcut: string
}

const TOOLS: ToolDef[] = [
  { name: 'select', icon: 'select', labelKey: 'toolSelect', tipKey: 'tipSelect', shortcut: 'V' },
  { name: 'pan', icon: 'pan', labelKey: 'toolPan', tipKey: 'tipPan', shortcut: 'H' },
  { name: 'line', icon: 'line', labelKey: 'toolLine', tipKey: 'tipLine', shortcut: 'L' },
  { name: 'rectangle', icon: 'rectangle', labelKey: 'toolRect', tipKey: 'tipRect', shortcut: 'R' },
  { name: 'ellipse', icon: 'ellipse', labelKey: 'toolEllipse', tipKey: 'tipEllipse', shortcut: 'O' },
  { name: 'circle', icon: 'circle', labelKey: 'toolCircle', tipKey: 'tipCircle', shortcut: 'C' },
  { name: 'polyline', icon: 'polyline', labelKey: 'toolPolyline', tipKey: 'tipPolyline', shortcut: 'P' },
  { name: 'pen', icon: 'pen', labelKey: 'toolPen', tipKey: 'tipPen', shortcut: 'B' },
  { name: 'brush', icon: 'brush', labelKey: 'toolBrush', tipKey: 'tipBrush', shortcut: 'W' },
  { name: 'text', icon: 'text', labelKey: 'toolText', tipKey: 'tipText', shortcut: 'T' },
]

const LOGO = `<svg viewBox="0 0 24 24" class="h-5 w-5 text-white" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M7 7h10v10H7z"/><path d="M12 4v16M4 12h16"/></svg>`

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

let tipEl: HTMLDivElement | null = null

function ensureTooltip(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement('div')
    tipEl.className = 'tool-tooltip'
    tipEl.setAttribute('role', 'tooltip')
    tipEl.hidden = true
    document.body.appendChild(tipEl)
  }
  return tipEl
}

function hideTooltip(): void {
  if (tipEl) tipEl.hidden = true
}

function bindTooltip(btn: HTMLButtonElement, label: string, body: string): void {
  const show = () => {
    const tip = ensureTooltip()
    tip.innerHTML = `<strong>${escapeAttr(label)}</strong><span>${escapeAttr(body)}</span>`
    tip.hidden = false
    const r = btn.getBoundingClientRect()
    const tipW = tip.offsetWidth
    const tipH = tip.offsetHeight
    let left = r.right + 10
    let top = r.top + r.height / 2 - tipH / 2
    if (left + tipW > window.innerWidth - 8) left = r.left - tipW - 10
    if (top < 8) top = 8
    if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
  }
  btn.addEventListener('mouseenter', show)
  btn.addEventListener('focus', show)
  btn.addEventListener('mouseleave', hideTooltip)
  btn.addEventListener('blur', hideTooltip)
}

function iconBtn(
  attrs: string,
  icon: string,
  label: string,
  body: string,
  pressed = false,
): string {
  return `<button type="button" class="${btnIcon}" ${attrs} aria-label="${escapeAttr(label)}" aria-pressed="${pressed}" data-label="${escapeAttr(label)}" data-body="${escapeAttr(body)}">${icon}</button>`
}

export function mountToolRail(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  const render = () => {
    const { tool } = store.get()

    const toolBtns = TOOLS.map((def) => {
      const label = `${t(def.labelKey)} (${def.shortcut})`
      return iconBtn(
        `data-tool="${def.name}"`,
        ICONS[def.icon],
        label,
        t(def.tipKey),
        def.name === tool,
      )
    }).join('')

    el.innerHTML = `
      <div class="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-3">
        <div class="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-brand shadow-sm shadow-brand/30" title="${escapeAttr(t('appTitle'))}" aria-hidden="true">${LOGO}</div>
        <div class="mb-1 h-px w-7 bg-neutral-300"></div>
        ${toolBtns}
      </div>
    `

    el.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
      const label = btn.dataset.label ?? ''
      const body = btn.dataset.body ?? ''
      if (label) bindTooltip(btn, label, body)
    })

    el.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        hideTooltip()
        editor.setTool(btn.dataset.tool as ToolName)
      })
    })
  }

  return store.subscribeKeys(['tool', 'localeTick'], render)
}
