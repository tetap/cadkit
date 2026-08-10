import type { Editor } from '@cadkit/editor'
import type { AppStore } from '../app/store.js'
import { t } from '../i18n/index.js'
import { ICONS } from './icons.js'

const iconBtn =
  'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-600 transition hover:bg-soft hover:text-ink disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-soft aria-pressed:text-ink [&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:stroke-current [&_svg]:fill-none [&_svg]:stroke-[1.75]'

/** Floating bottom chrome: undo/redo, zoom, layers toggle. */
export function mountViewBar(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  const render = () => {
    const { zoom, canUndo, canRedo, layersOpen } = store.get()
    const zoomPct = Math.round(zoom * 100)

    el.innerHTML = `
      <div class="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-neutral-200/90 bg-white/95 px-2.5 py-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.12)] backdrop-blur">
        <button type="button" id="vb-undo" class="${iconBtn}" title="${t('undo')}" aria-label="${t('undo')}" ${canUndo ? '' : 'disabled'}>
          ${ICONS.undo}
        </button>
        <button type="button" id="vb-redo" class="${iconBtn}" title="${t('redo')}" aria-label="${t('redo')}" ${canRedo ? '' : 'disabled'}>
          ${ICONS.redo}
        </button>
        <span class="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>
        <button type="button" id="vb-zoom-out" class="${iconBtn}" title="-">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>
        </button>
        <span class="inline-block min-w-[3.25rem] shrink-0 text-center text-xs font-semibold tabular-nums leading-none text-ink">${zoomPct}%</span>
        <button type="button" id="vb-zoom-in" class="${iconBtn}" title="+">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
        </button>
        <button type="button" id="vb-fit" class="h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium leading-none text-ink transition hover:bg-soft">${t('fit')}</button>
        <span class="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>
        <button type="button" id="vb-layers" class="${iconBtn}" title="${t('layers')}" aria-label="${t('layers')}" aria-pressed="${layersOpen}">
          ${ICONS.layers}
        </button>
      </div>
    `

    el.querySelector('#vb-undo')?.addEventListener('click', () => {
      editor.undo()
      store.set({ canUndo: editor.canUndo(), canRedo: editor.canRedo() })
    })
    el.querySelector('#vb-redo')?.addEventListener('click', () => {
      editor.redo()
      store.set({ canUndo: editor.canUndo(), canRedo: editor.canRedo() })
    })
    el.querySelector('#vb-zoom-in')?.addEventListener('click', () => editor.zoomTo(1.15))
    el.querySelector('#vb-zoom-out')?.addEventListener('click', () => editor.zoomTo(1 / 1.15))
    el.querySelector('#vb-fit')?.addEventListener('click', () => editor.fitView())
    el.querySelector('#vb-layers')?.addEventListener('click', () => {
      store.set({ layersOpen: !store.get().layersOpen })
    })
  }

  return store.subscribeKeys(['zoom', 'canUndo', 'canRedo', 'localeTick', 'layersOpen'], render)
}
