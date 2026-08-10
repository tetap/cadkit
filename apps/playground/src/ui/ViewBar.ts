import type { Editor } from '@cadkit/editor'
import type { AppStore } from '../app/store.js'
import { t } from '../i18n/index.js'

const iconBtn =
  'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-600 transition hover:bg-soft hover:text-ink aria-pressed:bg-soft aria-pressed:text-ink [&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:stroke-current [&_svg]:fill-none [&_svg]:stroke-[1.75]'

/** Floating bottom chrome: zoom only (document settings live in Settings dialog). */
export function mountViewBar(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  const render = () => {
    const zoomPct = Math.round(store.get().zoom * 100)

    el.innerHTML = `
      <div class="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-neutral-200/90 bg-white/95 px-2.5 py-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.12)] backdrop-blur">
        <button type="button" id="vb-zoom-out" class="${iconBtn}" title="-">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>
        </button>
        <span class="inline-block min-w-[3.25rem] shrink-0 text-center text-xs font-semibold tabular-nums leading-none text-ink">${zoomPct}%</span>
        <button type="button" id="vb-zoom-in" class="${iconBtn}" title="+">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
        </button>
        <button type="button" id="vb-fit" class="h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium leading-none text-ink transition hover:bg-soft">${t('fit')}</button>
      </div>
    `

    el.querySelector('#vb-zoom-in')?.addEventListener('click', () => editor.zoomTo(1.15))
    el.querySelector('#vb-zoom-out')?.addEventListener('click', () => editor.zoomTo(1 / 1.15))
    el.querySelector('#vb-fit')?.addEventListener('click', () => editor.fitView())
  }

  return store.subscribeKeys(['zoom', 'localeTick'], render)
}
