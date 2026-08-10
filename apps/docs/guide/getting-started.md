# 快速开始

## 安装

```bash
pnpm install
pnpm build
pnpm playground:dev
```

## 最小示例

```ts
import { createEditor } from '@cadkit/editor'

const editor = await createEditor({
  view: '#canvas',
  renderer: 'auto',
  document: { unit: 'mm', tolerance: 1e-6, schemaVersion: 1 },
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

## 仓库命令

| 命令 | 说明 |
|------|------|
| `pnpm build` | 构建全部包 |
| `pnpm test` | 运行单元测试 |
| `pnpm playground:dev` | 示例与基准 |
| `pnpm docs:dev` | VitePress 文档 |
| `pnpm benchmark` | 打开技术尖峰页 |
