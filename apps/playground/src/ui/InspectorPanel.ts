import type { Editor } from '@cadkit/editor'
import type { Entity, ImageEntity, TextEntity } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { refreshHotFromSelection } from '../bindEditorEvents.js'
import { t } from '../i18n/index.js'
import { fieldControl, hint, row, rowPair, sectionCard, sectionTitle } from './tokens.js'

export function mountInspectorPanel(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  const render = () => {
    const { selectionIds, hot } = store.get()
    if (selectionIds.length === 0) {
      el.innerHTML = `<p class="${hint} py-6 text-center">${t('inspectorEmpty')}</p>`
      return
    }
    if (selectionIds.length > 1) {
      el.innerHTML = `
        <div class="${sectionCard}">
          <h3 class="${sectionTitle}">${t('inspector')}</h3>
          <p class="${hint}">${selectionIds.length} ${t('selected')}</p>
        </div>
        <div class="${sectionCard}">
          <h3 class="${sectionTitle}">${t('style')}</h3>
          ${styleRows(hot.stroke, hot.fill, hot.opacity)}
        </div>`
      bindStyle(el, editor, store)
      return
    }

    const id = selectionIds[0]!
    const entity = editor.document.getEntity(id)
    if (!entity) {
      el.innerHTML = `<p class="${hint} py-6 text-center">${t('inspectorEmpty')}</p>`
      return
    }

    let extra = ''
    if (entity.type === 'text') {
      const te = entity as TextEntity
      const arc = te.path?.kind === 'arc' ? te.path : null
      const startDeg = arc ? ((arc.startAngle * 180) / Math.PI).toFixed(1) : '-90'
      const sweepDeg = arc ? ((arc.sweep * 180) / Math.PI).toFixed(1) : '180'
      extra = `
        <div class="${sectionCard}">
          <h3 class="${sectionTitle}">${t('text')}</h3>
          <div class="${row}"><label class="text-muted">${t('content')}</label>
            <textarea id="ins-text" rows="3" class="${fieldControl} h-auto min-h-20 resize-y py-2">${escapeAttr(te.content)}</textarea></div>
          <div class="${row}"><label class="text-muted">${t('fontSize')}</label>
            <input type="number" id="ins-fs" class="${fieldControl}" min="1" value="${te.fontSize}" /></div>
          <div class="${rowPair}"><label class="text-muted">XY</label>
            <input type="number" id="ins-x" class="${fieldControl}" step="0.1" value="${te.position.x}" />
            <input type="number" id="ins-y" class="${fieldControl}" step="0.1" value="${te.position.y}" /></div>
          <div class="${row}"><label class="text-muted">${t('arcText')}</label>
            <input type="checkbox" id="ins-arc" class="h-4 w-4" ${arc ? 'checked' : ''} /></div>
          <div id="ins-arc-fields" class="${arc ? 'space-y-2' : 'hidden space-y-2'}">
            <div class="${row}"><label class="text-muted">${t('arcRadius')}</label>
              <input type="number" id="ins-arc-r" class="${fieldControl}" min="1" step="1" value="${arc?.radius ?? Math.max(40, te.fontSize * 4)}" /></div>
            <div class="${rowPair}"><label class="text-muted">${t('arcStart')}</label>
              <input type="number" id="ins-arc-start" class="${fieldControl}" step="1" value="${startDeg}" />
              <label class="text-muted">${t('arcSweep')}</label>
              <input type="number" id="ins-arc-sweep" class="${fieldControl}" step="1" value="${sweepDeg}" /></div>
            <div class="${row}"><label class="text-muted">${t('arcBaseline')}</label>
              <select id="ins-arc-base" class="${fieldControl}">
                <option value="outer" ${(arc?.baseline ?? 'outer') === 'outer' ? 'selected' : ''}>${t('arcOuter')}</option>
                <option value="inner" ${arc?.baseline === 'inner' ? 'selected' : ''}>${t('arcInner')}</option>
              </select></div>
          </div>
        </div>`
    } else if (entity.type === 'image') {
      const img = entity as ImageEntity
      extra = `
        <div class="${sectionCard}">
          <h3 class="${sectionTitle}">${t('image')}</h3>
          <div class="${rowPair}"><label class="text-muted">XY</label>
            <input type="number" id="ins-x" class="${fieldControl}" step="0.1" value="${img.origin.x}" />
            <input type="number" id="ins-y" class="${fieldControl}" step="0.1" value="${img.origin.y}" /></div>
          <div class="${rowPair}"><label class="text-muted">${t('size')}</label>
            <input type="number" id="ins-w" class="${fieldControl}" min="0.01" step="0.1" value="${img.width}" />
            <input type="number" id="ins-h" class="${fieldControl}" min="0.01" step="0.1" value="${img.height}" /></div>
          <p class="${hint}">${img.naturalWidth ?? '?'}×${img.naturalHeight ?? '?'} px · ${escapeAttr(img.href.slice(0, 48))}</p>
        </div>`
    } else {
      extra = `
        <div class="${sectionCard}">
          <h3 class="${sectionTitle}">${t('transform')}</h3>
          <div class="${rowPair}"><label class="text-muted">XY</label>
            <input type="number" id="ins-x" class="${fieldControl}" step="0.1" value="${hot.x}" />
            <input type="number" id="ins-y" class="${fieldControl}" step="0.1" value="${hot.y}" /></div>
          <div class="${rowPair}"><label class="text-muted">${t('size')}</label>
            <input type="number" id="ins-w" class="${fieldControl}" step="0.1" value="${hot.width}" />
            <input type="number" id="ins-h" class="${fieldControl}" step="0.1" value="${hot.height}" /></div>
          <p class="${hint}">${t('boundsHint')}</p>
        </div>`
    }

    el.innerHTML = `
      <div class="${sectionCard}">
        <h3 class="${sectionTitle}">${t('inspector')}</h3>
        <p class="${hint}">${entity.type} · ${id}</p>
      </div>
      <div class="${sectionCard}">
        <h3 class="${sectionTitle}">${t('style')}</h3>
        ${styleRows(hot.stroke, hot.fill, hot.opacity)}
      </div>
      ${extra}`

    bindStyle(el, editor, store)

    el.querySelector('#ins-text')?.addEventListener('change', (ev) => {
      editor.updateEntity(id, { content: (ev.target as HTMLTextAreaElement).value } as Partial<Entity>)
      refreshHotFromSelection(editor, store)
    })
    el.querySelector('#ins-fs')?.addEventListener('change', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value)
      if (Number.isFinite(v)) {
        editor.updateEntity(id, { fontSize: v } as Partial<Entity>, 'ins-fontSize')
        refreshHotFromSelection(editor, store)
      }
    })

    const applyArcPath = () => {
      const e = editor.document.getEntity(id)
      if (!e || e.type !== 'text') return
      const enabled = (el.querySelector('#ins-arc') as HTMLInputElement | null)?.checked ?? false
      const fields = el.querySelector('#ins-arc-fields')
      if (fields) fields.classList.toggle('hidden', !enabled)
      if (!enabled) {
        editor.updateEntity(id, { path: undefined } as Partial<Entity>, 'ins-arc-off')
        refreshHotFromSelection(editor, store)
        return
      }
      const radius = Number((el.querySelector('#ins-arc-r') as HTMLInputElement | null)?.value)
      const startDeg = Number((el.querySelector('#ins-arc-start') as HTMLInputElement | null)?.value)
      const sweepDeg = Number((el.querySelector('#ins-arc-sweep') as HTMLInputElement | null)?.value)
      const baseline = ((el.querySelector('#ins-arc-base') as HTMLSelectElement | null)?.value ??
        'outer') as 'outer' | 'inner'
      const te = e as TextEntity
      editor.updateEntity(
        id,
        {
          path: {
            kind: 'arc',
            radius: Number.isFinite(radius) && radius > 0 ? radius : Math.max(40, te.fontSize * 4),
            startAngle: (Number.isFinite(startDeg) ? startDeg : -90) * (Math.PI / 180),
            sweep: (Number.isFinite(sweepDeg) ? sweepDeg : 180) * (Math.PI / 180),
            baseline,
          },
        } as Partial<Entity>,
        'ins-arc',
      )
      refreshHotFromSelection(editor, store)
    }
    el.querySelector('#ins-arc')?.addEventListener('change', applyArcPath)
    for (const key of ['#ins-arc-r', '#ins-arc-start', '#ins-arc-sweep', '#ins-arc-base']) {
      el.querySelector(key)?.addEventListener('change', applyArcPath)
    }

    const applyPosSize = () => {
      const x = Number((el.querySelector('#ins-x') as HTMLInputElement | null)?.value)
      const y = Number((el.querySelector('#ins-y') as HTMLInputElement | null)?.value)
      const w = Number((el.querySelector('#ins-w') as HTMLInputElement | null)?.value)
      const h = Number((el.querySelector('#ins-h') as HTMLInputElement | null)?.value)
      const e = editor.document.getEntity(id)
      if (!e) return
      if (e.type === 'text' && Number.isFinite(x) && Number.isFinite(y)) {
        editor.updateEntity(id, { position: { x, y } } as Partial<Entity>, 'ins-pos')
      } else if (e.type === 'image') {
        const patch: Partial<ImageEntity> = {}
        if (Number.isFinite(x) && Number.isFinite(y)) patch.origin = { x, y }
        if (Number.isFinite(w) && w > 0) patch.width = w
        if (Number.isFinite(h) && h > 0) patch.height = h
        editor.updateEntity(id, patch as Partial<Entity>, 'ins-image')
      }
      refreshHotFromSelection(editor, store)
    }
    for (const key of ['#ins-x', '#ins-y', '#ins-w', '#ins-h']) {
      el.querySelector(key)?.addEventListener('change', applyPosSize)
    }
  }

  return store.subscribeKeys(['hot', 'selectionIds', 'localeTick', 'uiEpoch'], render)
}

function styleRows(stroke: string, fill: string, opacity: number): string {
  return `
    <div class="${row}"><label class="text-muted">${t('stroke')}</label>
      <input type="color" id="ins-stroke" class="h-8 w-full cursor-pointer rounded border border-neutral-300 bg-white p-0.5" value="${toColor(stroke)}" /></div>
    <div class="${row}"><label class="text-muted">${t('fill')}</label>
      <input type="color" id="ins-fill" class="h-8 w-full cursor-pointer rounded border border-neutral-300 bg-white p-0.5" value="${toColor(fill)}" /></div>
    <div class="${row}"><label class="text-muted">${t('opacity')}</label>
      <input type="number" id="ins-opacity" class="${fieldControl}" min="0" max="1" step="0.05" value="${opacity}" /></div>`
}

function bindStyle(el: HTMLElement, editor: Editor, store: AppStore): void {
  const apply = (patch: Parameters<Editor['applyStyle']>[1]) => {
    for (const id of store.get().selectionIds) editor.applyStyle(id, patch)
    refreshHotFromSelection(editor, store)
  }
  el.querySelector('#ins-stroke')?.addEventListener('input', (ev) => {
    apply({ stroke: (ev.target as HTMLInputElement).value })
  })
  el.querySelector('#ins-fill')?.addEventListener('input', (ev) => {
    apply({ fill: (ev.target as HTMLInputElement).value })
  })
  el.querySelector('#ins-opacity')?.addEventListener('change', (ev) => {
    const v = Number((ev.target as HTMLInputElement).value)
    if (Number.isFinite(v)) apply({ opacity: v })
  })
}

function toColor(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7)
  return '#222222'
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
