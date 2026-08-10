import type { Editor } from '@cadkit/editor'
import type { Entity, EntityId, TextArcPath, TextEntity } from '@cadkit/types'
import { t } from '../i18n/index.js'
import { btnGhost, fieldControl, fieldLabel } from './tokens.js'

function defaultArc(fontSize: number): TextArcPath {
  return {
    kind: 'arc',
    radius: Math.max(20, fontSize * 4),
    startAngle: -Math.PI * 0.75,
    sweep: Math.PI * 1.5,
    baseline: 'outer',
  }
}

/**
 * Floating panel to enable / tune curve (arc) text for the selected TextEntity.
 */
export function openCurveTextDialog(
  host: HTMLElement,
  editor: Editor,
  entityId: EntityId,
  onDone: () => void,
): () => void {
  const root = document.createElement('div')
  root.id = 'curve-text-dialog'
  root.className =
    'absolute right-3 top-14 z-40 w-[280px] overflow-hidden rounded-xl border border-line bg-panel shadow-xl'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', t('curveText'))

  const readEntity = (): TextEntity | null => {
    const e = editor.document.getEntity(entityId)
    return e?.type === 'text' ? (e as TextEntity) : null
  }

  const applyPath = (path: TextArcPath | undefined) => {
    editor.updateEntity(entityId, { path } as Partial<Entity>, 'curve-text')
    // Keep selection frame in sync with arc glyph bounds.
    editor.requestRender()
  }

  const render = () => {
    const te = readEntity()
    if (!te) {
      root.remove()
      onDone()
      return
    }
    const arc = te.path?.kind === 'arc' ? te.path : null
    const enabled = !!arc
    const radius = arc?.radius ?? Math.max(20, te.fontSize * 4)
    const startDeg = arc ? ((arc.startAngle * 180) / Math.PI).toFixed(0) : '-135'
    const sweepDeg = arc ? ((arc.sweep * 180) / Math.PI).toFixed(0) : '270'
    const baseline = arc?.baseline ?? 'outer'

    root.innerHTML = `
      <header class="flex items-center justify-between border-b border-line px-3 py-2.5">
        <h3 class="font-display text-sm font-semibold text-ink">${t('curveText')}</h3>
        <button type="button" id="ct-close" class="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-soft" aria-label="${t('cancel')}">×</button>
      </header>
      <div class="space-y-3 px-3 py-3">
        <label class="flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" id="ct-enable" ${enabled ? 'checked' : ''} />
          ${t('curveTextEnable')}
        </label>
        <div id="ct-fields" class="${enabled ? 'space-y-3' : 'hidden space-y-3'}">
          <div>
            <div class="mb-1 flex items-center justify-between">
              <label class="${fieldLabel}" for="ct-r">${t('arcRadius')}</label>
              <input type="number" id="ct-r-num" class="${fieldControl} w-16" min="1" step="0.5" value="${radius.toFixed(1)}" />
            </div>
            <input type="range" id="ct-r" class="w-full accent-slate-800" min="5" max="${Math.max(80, radius * 2)}" step="0.5" value="${radius}" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label class="${fieldLabel} flex-col !items-stretch gap-1">
              ${t('arcStart')}
              <input type="number" id="ct-start" class="${fieldControl} w-full" step="1" value="${startDeg}" />
            </label>
            <label class="${fieldLabel} flex-col !items-stretch gap-1">
              ${t('arcSweep')}
              <input type="number" id="ct-sweep" class="${fieldControl} w-full" step="1" value="${sweepDeg}" />
            </label>
          </div>
          <label class="${fieldLabel}">
            ${t('arcBaseline')}
            <select id="ct-base" class="${fieldControl} w-full">
              <option value="outer" ${baseline === 'outer' ? 'selected' : ''}>${t('arcOuter')}</option>
              <option value="inner" ${baseline === 'inner' ? 'selected' : ''}>${t('arcInner')}</option>
            </select>
          </label>
          <p class="text-[11px] leading-snug text-muted">${t('curveTextHint')}</p>
        </div>
      </div>
      <footer class="flex justify-end gap-2 border-t border-line px-3 py-2.5">
        <button type="button" id="ct-done" class="${btnGhost}">${t('confirm')}</button>
      </footer>
    `

    const close = () => {
      root.remove()
      onDone()
    }
    root.querySelector('#ct-close')?.addEventListener('click', close)
    root.querySelector('#ct-done')?.addEventListener('click', close)

    const writeFromFields = () => {
      const te2 = readEntity()
      if (!te2) return
      const r = Number((root.querySelector('#ct-r-num') as HTMLInputElement | null)?.value)
      const start = Number((root.querySelector('#ct-start') as HTMLInputElement | null)?.value)
      const sweep = Number((root.querySelector('#ct-sweep') as HTMLInputElement | null)?.value)
      const base = ((root.querySelector('#ct-base') as HTMLSelectElement | null)?.value ??
        'outer') as 'outer' | 'inner'
      applyPath({
        kind: 'arc',
        radius: Number.isFinite(r) && r > 0 ? r : Math.max(20, te2.fontSize * 4),
        startAngle: (Number.isFinite(start) ? start : -135) * (Math.PI / 180),
        sweep: (Number.isFinite(sweep) ? sweep : 270) * (Math.PI / 180),
        baseline: base,
      })
    }

    root.querySelector('#ct-enable')?.addEventListener('change', (ev) => {
      const on = (ev.target as HTMLInputElement).checked
      const te2 = readEntity()
      if (!te2) return
      if (on) applyPath(te2.path?.kind === 'arc' ? te2.path : defaultArc(te2.fontSize))
      else applyPath(undefined)
      render()
    })

    const syncR = (v: number) => {
      if (!Number.isFinite(v) || v <= 0) return
      const range = root.querySelector<HTMLInputElement>('#ct-r')
      const num = root.querySelector<HTMLInputElement>('#ct-r-num')
      if (range) range.value = String(v)
      if (num) num.value = String(v)
      writeFromFields()
    }
    root.querySelector('#ct-r')?.addEventListener('input', (ev) => {
      syncR(Number((ev.target as HTMLInputElement).value))
    })
    root.querySelector('#ct-r-num')?.addEventListener('change', (ev) => {
      syncR(Number((ev.target as HTMLInputElement).value))
    })
    for (const key of ['#ct-start', '#ct-sweep', '#ct-base']) {
      root.querySelector(key)?.addEventListener('change', writeFromFields)
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
