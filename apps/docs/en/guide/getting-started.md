# Getting Started

## Install

```bash
pnpm install
pnpm build
pnpm playground:dev
```

## Minimal example

```ts
import { createEditor } from '@cadkit/editor'

const editor = await createEditor({
  view: '#canvas',
  renderer: 'webgpu',
  document: { unit: 'mm', displayUnit: 'mm', tolerance: 1e-6, schemaVersion: 1 },
  performance: {
    profile: 'auto',
    memoryBudgetMB: 1024,
    lodNavigationPx: 0.75,
    lodStablePx: 0.35,
    textBudget: 2000,
    maxDirtyRects: 8,
    dirtyMergeAreaRatio: 0.6,
  },
})

editor.tools.activate('line')
editor.on('metrics', (m) => console.log(m.frameMs))
```

## Repository scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run unit tests |
| `pnpm playground:dev` | Examples & benchmarks |
| `pnpm docs:dev` | VitePress docs |
| `pnpm benchmark` | Open spike benchmark page |
