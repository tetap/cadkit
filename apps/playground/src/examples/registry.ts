import type { MessageKey } from '../i18n/index.js'

export type ExampleCategory =
  | 'Editing'
  | 'Guides'
  | 'Camera'
  | 'Groups'
  | 'SVG'
  | 'DXF'
  | 'Text'
  | 'Geometry'
  | 'Performance'

export interface ExampleDef {
  id: string
  category: ExampleCategory
  titleKey: MessageKey
  descKey: MessageKey
}

export const EXAMPLES: ExampleDef[] = [
  { id: 'basic', category: 'Editing', titleKey: 'ex.basic.title', descKey: 'ex.basic.desc' },
  { id: 'guides', category: 'Guides', titleKey: 'ex.guides.title', descKey: 'ex.guides.desc' },
  { id: 'camera', category: 'Camera', titleKey: 'ex.camera.title', descKey: 'ex.camera.desc' },
  { id: 'groups', category: 'Groups', titleKey: 'ex.groups.title', descKey: 'ex.groups.desc' },
  { id: 'svg', category: 'SVG', titleKey: 'ex.svg.title', descKey: 'ex.svg.desc' },
  { id: 'dxf', category: 'DXF', titleKey: 'ex.dxf.title', descKey: 'ex.dxf.desc' },
  { id: 'text', category: 'Text', titleKey: 'ex.text.title', descKey: 'ex.text.desc' },
  {
    id: 'large-coords',
    category: 'Geometry',
    titleKey: 'ex.large-coords.title',
    descKey: 'ex.large-coords.desc',
  },
  {
    id: 'million-lines',
    category: 'Performance',
    titleKey: 'ex.million-lines.title',
    descKey: 'ex.million-lines.desc',
  },
  {
    id: 'million-squares',
    category: 'Performance',
    titleKey: 'ex.million-squares.title',
    descKey: 'ex.million-squares.desc',
  },
  {
    id: 'benchmark',
    category: 'Performance',
    titleKey: 'ex.benchmark.title',
    descKey: 'ex.benchmark.desc',
  },
]

export function categoryKey(category: ExampleCategory): MessageKey {
  return `cat.${category}` as MessageKey
}
