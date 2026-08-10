import type { Editor } from '@cadkit/editor'
import type { AppStore } from '../app/store.js'
import { t } from '../i18n/index.js'

export function mountStatusBar(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  const render = () => {
    const s = store.get()
    const m = s.metrics
    const parts = [
      s.status,
      `${t('metricsTool')} ${s.tool}`,
      `${t('metricsZoom')} ${(s.zoom * 100).toFixed(0)}%`,
      `${t('metricsUnit')} ${editor.getWorldUnit()} → ${s.displayUnit}`,
    ]
    if (m) {
      parts.push(
        `${t('metricsFrame')} ${m.frameMs.toFixed(2)}ms`,
        `${t('metricsVisible')} ${m.visibleCount}`,
        `${t('metricsDraws')} ${m.drawCalls}`,
        `${t('metricsUpload')} ${(m.uploadBytes / 1024).toFixed(1)}KB`,
      )
    }
    el.textContent = parts.join(' · ')
    el.title = parts.join('\n')
  }

  return store.subscribeKeys(
    ['status', 'tool', 'zoom', 'displayUnit', 'metrics', 'localeTick'],
    render,
  )
}
