# SVG / DXF / 图片

## SVG

基于 DOMParser + [`svg-pathdata`](https://github.com/nfroidure/svg-pathdata)：

- 支持 line / polyline / polygon / rect / circle / ellipse / text / **image**
- `path` 默认展开为 polyline + cubic bezier
- `<image href|xlink:href>`：保留 transform、`preserveAspectRatio`；无显式物理尺寸时按 **72 DPI user-unit**（1 user unit = 1/72 in）映射到文档 world 单位
- `use` / `filter` / `mask` 输出结构化 warning

```ts
await editor.import.svg(svgText)
const svg = editor.export.svg() // ImageEntity 输出 href/尺寸/transform
```

## DXF

基于 [`dxf-render/parser`](https://github.com/arbaev/dxf-kit)：

- LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / ELLIPSE / SPLINE / TEXT / MTEXT / INSERT
- 读取 `$INSUNITS` 并换算到文档单位

```ts
await editor.import.dxf(file)
```

## 图片资产

```ts
await editor.import.image(file)          // File | Blob
await editor.import.image('https://…')   // URL / data URL
```

- `@cadkit/assets`：`AssetRegistry` 负责解码（`createImageBitmap`）、引用计数、GPU 纹理 LRU
- `ImageEntity.assetId` 稳定引用；序列化保留 `href`，不依赖临时 blob URL
- Playground：AppBar 导入、工具栏 Image、画布拖放
