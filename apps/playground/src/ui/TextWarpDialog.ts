import type { Editor } from '@cadkit/editor'
import { defaultTextWarp, normalizeTextWarp, TEXT_WARP_STYLES } from '@cadkit/geometry'
import type { Entity, EntityId, TextEntity, TextWarp, TextWarpStyle } from '@cadkit/types'
import { t, type MessageKey } from '../i18n/index.js'
import { btnGhost, fieldControl, fieldLabel } from './tokens.js'

const STYLE_LABEL: Record<TextWarpStyle, MessageKey> = {
  arc: 'textWarpArc',
  arcLower: 'textWarpArcLower',
  arcUpper: 'textWarpArcUpper',
  arch: 'textWarpArch',
  bulge: 'textWarpBulge',
  shell: 'textWarpShell',
  flag: 'textWarpFlag',
  wave: 'textWarpWave',
}

function pct(n: number | undefined): string {
  return String(Math.round((n ?? 0) * 100))
}

function fromPct(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(-100, Math.min(100, n)) / 100
}

/**
 * Floating panel: Photoshop-style text envelope (fan / crown / wave + perspective).
 */
export function openTextWarpDialog(
  host: HTMLElement,
  editor: Editor,
  entityId: EntityId,
  onDone: () => void,
): () => void {
  const root = document.createElement('div')
  root.id = 'text-warp-dialog'
  root.className =
    'absolute right-3 top-14 z-40 w-[300px] overflow-hidden rounded-xl border border-line bg-panel shadow-xl'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', t('textWarp'))

  const readEntity = (): TextEntity | null => {
    const e = editor.document.getEntity(entityId)
    return e?.type === 'text' ? (e as TextEntity) : null
  }

  const writeWarp = (warp: TextWarp | undefined) => {
    editor.updateEntity(entityId, { warp } as Partial<Entity>, 'text-warp')
    editor.requestRender()
  }

  const render = () => {
    const te = readEntity()
    if (!te) {
      root.remove()
      onDone()
      return
    }
    const enabled = !!te.warp
    const warp = te.warp ? normalizeTextWarp(te.warp) : defaultTextWarp('arc')

    const styleOpts = TEXT_WARP_STYLES.map(
      (s) =>
        `<option value="${s}" ${warp.style === s ? 'selected' : ''}>${t(STYLE_LABEL[s])}</option>`,
    ).join('')

    root.innerHTML = `
      <header class="flex items-center justify-between border-b border-line px-3 py-2.5">
        <h3 class="font-display text-sm font-semibold text-ink">${t('textWarp')}</h3>
        <button type="button" id="tw-close" class="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-soft" aria-label="${t('cancel')}">×</button>
      </header>
      <div class="space-y-3 px-3 py-3">
        <label class="flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" id="tw-enable" ${enabled ? 'checked' : ''} />
          ${t('textWarpEnable')}
        </label>
        <div id="tw-fields" class="${enabled ? 'space-y-3' : 'hidden space-y-3'}">
          <div class="grid grid-cols-2 gap-2">
            <label class="${fieldLabel} flex-col !items-stretch gap-1">
              ${t('textWarpStyle')}
              <select id="tw-style" class="${fieldControl} w-full">${styleOpts}</select>
            </label>
            <label class="${fieldLabel} flex-col !items-stretch gap-1">
              ${t('textWarpDir')}
              <select id="tw-dir" class="${fieldControl} w-full">
                <option value="horizontal" ${warp.direction !== 'vertical' ? 'selected' : ''}>${t('textWarpDirH')}</option>
                <option value="vertical" ${warp.direction === 'vertical' ? 'selected' : ''}>${t('textWarpDirV')}</option>
              </select>
            </label>
          </div>
          ${sliderRow('tw-bend', t('textWarpBend'), pct(warp.bend))}
          ${sliderRow('tw-dh', t('textWarpDistortH'), pct(warp.distortH))}
          ${sliderRow('tw-dv', t('textWarpDistortV'), pct(warp.distortV))}
        </div>
      </div>
      <footer class="flex justify-end gap-2 border-t border-line px-3 py-2.5">
        <button type="button" id="tw-release" class="${btnGhost}" ${enabled ? '' : 'disabled'}>${t('textWarpRelease')}</button>
        <button type="button" id="tw-done" class="${btnGhost}">${t('confirm')}</button>
      </footer>
    `

    const close = () => {
      root.remove()
      onDone()
    }
    root.querySelector('#tw-close')?.addEventListener('click', close)
    root.querySelector('#tw-done')?.addEventListener('click', close)

    root.querySelector('#tw-enable')?.addEventListener('change', (ev) => {
      const on = (ev.target as HTMLInputElement).checked
      if (on) writeWarp(te.warp ? normalizeTextWarp(te.warp) : defaultTextWarp('arc'))
      else writeWarp(undefined)
      render()
    })

    root.querySelector('#tw-release')?.addEventListener('click', () => {
      writeWarp(undefined)
      render()
    })

    const readFields = (): TextWarp => ({
      style: ((root.querySelector('#tw-style') as HTMLSelectElement | null)?.value ??
        'arc') as TextWarpStyle,
      direction:
        (root.querySelector('#tw-dir') as HTMLSelectElement | null)?.value === 'vertical'
          ? 'vertical'
          : 'horizontal',
      bend: fromPct((root.querySelector('#tw-bend') as HTMLInputElement | null)?.value ?? '50'),
      distortH: fromPct((root.querySelector('#tw-dh') as HTMLInputElement | null)?.value ?? '0'),
      distortV: fromPct((root.querySelector('#tw-dv') as HTMLInputElement | null)?.value ?? '0'),
    })

    const syncPair = (prefix: string, value: string) => {
      const range = root.querySelector<HTMLInputElement>(`#${prefix}`)
      const num = root.querySelector<HTMLInputElement>(`#${prefix}-num`)
      if (range) range.value = value
      if (num) num.value = value
    }

    const applyFields = () => {
      if (!readEntity()?.warp && !enabled) return
      writeWarp(normalizeTextWarp(readFields()))
    }

    root.querySelector('#tw-style')?.addEventListener('change', applyFields)
    root.querySelector('#tw-dir')?.addEventListener('change', applyFields)

    for (const id of ['tw-bend', 'tw-dh', 'tw-dv']) {
      root.querySelector(`#${id}`)?.addEventListener('input', (ev) => {
        const v = (ev.target as HTMLInputElement).value
        syncPair(id, v)
        applyFields()
      })
      root.querySelector(`#${id}-num`)?.addEventListener('change', (ev) => {
        const v = String(
          Math.max(-100, Math.min(100, Number((ev.target as HTMLInputElement).value) || 0)),
        )
        syncPair(id, v)
        applyFields()
      })
    }
  }

  const section = host.closest('section') ?? host.parentElement ?? document.body
  if (getComputedStyle(section).position === 'static') {
    ;(section as HTMLElement).style.position = 'relative'
  }
  section.appendChild(root)
  render()

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      root.remove()
      onDone()
    }
  }
  document.addEventListener('keydown', onKey)
  return () => {
    document.removeEventListener('keydown', onKey)
    root.remove()
  }
}

function sliderRow(id: string, label: string, value: string): string {
  return `
    <div>
      <div class="mb-1 flex items-center justify-between gap-2">
        <label class="${fieldLabel}" for="${id}">${label}</label>
        <input type="number" id="${id}-num" class="${fieldControl} w-16" min="-100" max="100" step="1" value="${value}" />
      </div>
      <input type="range" id="${id}" class="w-full accent-brand" min="-100" max="100" step="1" value="${value}" />
    </div>
  `
}
