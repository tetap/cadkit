# 导入 / 导出

CADKit 通过 `@cadkit/io-*` 包与编辑器门面统一 I/O：

| 格式 | 包 | 导入 | 导出 |
|------|-----|------|------|
| SVG | `@cadkit/io-svg` | ✓ | ✓ |
| DXF | `@cadkit/io-dxf` | ✓ | — |
| G-code / NC | `@cadkit/io-gcode` | ✓ | ✓ |
| 光栅图 | `@cadkit/assets` | ✓ | （随 SVG / JSON 引用） |
| JSON 文档 | `@cadkit/editor` | — | ✓ |

```ts
await editor.import.svg(svgText)
await editor.import.dxf(file)
await editor.import.gcode(ncText)   // .nc / .gcode / .ngc
await editor.import.image(file)

const svg = editor.export.svg()
const json = editor.export.json()
const gcode = await editor.export.gcode()
```

---

## SVG

基于 DOMParser + [`svg-pathdata`](https://github.com/nfroidure/svg-pathdata)：

- 支持 line / polyline / polygon / rect / circle / ellipse / text / **image**
- `path` 默认展开为 polyline + cubic bezier
- `<image href|xlink:href>`：保留 transform、`preserveAspectRatio`；无显式物理尺寸时按 **72 DPI user-unit**（1 user unit = 1/72 in）映射到文档 world 单位
- `use` / `filter` / `mask` 输出结构化 warning

```ts
await editor.import.svg(svgText)
const svg = editor.export.svg() // ImageEntity 输出 href / 尺寸 / transform
```

---

## DXF

基于 [`dxf-render/parser`](https://github.com/arbaev/dxf-kit)：

- LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / ELLIPSE / SPLINE / TEXT / MTEXT / INSERT
- 读取 `$INSUNITS` 并换算到文档单位
- 导入后对碎线段做 **路径焊接**（与 G-code 共用 `@cadkit/geometry` 的 `optimizeImportPaths`）

```ts
await editor.import.dxf(file)
```

---

## G-code

包：`@cadkit/io-gcode`。面向 GRBL 风格激光 / 雕刻机。

### 导入

解析常见运动与状态：

- `G0` / `G1` 直线，`G2` / `G3` 圆弧
- `G20` / `G21` 单位，`G90` / `G91` 绝对 / 增量
- `M3` / `M5` 激光开 / 关（切段边界）

默认：

- `flipY: true` — 机床原点左下 ↔ 画布 Y 向下
- `optimize: true` — 焊接碎线 / 自闭合 / 共线简化

```ts
await editor.import.gcode(source, {
  flipY: true,
  optimize: true,
})
```

Playground 支持拖入 / 打开 `.nc` · `.gcode` · `.ngc`。

### 导出

按**图层**读取加工参数，生成刀路计划再 emit GRBL：

| 图层模式 | 行为 |
|----------|------|
| `line` | 描边轮廓 |
| `fill` | 填充扫描线（双向 / 交叉） |
| `image` | **跳过**（不参与刀路） |

图层参数（`Layer.gcode`）：

- `mode` · `fillStyle`（`bidirectional` | `crossHatch`）· `fillAngle`（度；交叉 = 角度 + 90°）
- `lineSpacing` · `power` · `speed` · `passes`

导出默认开启 **空走优化**（蛇形续接 → 最近邻含闭环入口 / 反向 → 2-opt），不改变切削几何长度，只重排顺序与方向。

```ts
const gcode = await editor.export.gcode({
  travelSpeed: 3000,
  flipY: true,
  optimizeOrder: true,
  start: { x: 0, y: 0 },
})
```

Playground 右侧图层面板可编辑参数；可打开刀路预览查看 travel / cut。

底层也可直接使用：

```ts
import { importGcode, exportGcode, buildToolpaths } from '@cadkit/io-gcode'
```

---

## 图片资产与图像图层

```ts
await editor.import.image(file)          // File | Blob
await editor.import.image('https://…')   // URL / data URL
```

- `@cadkit/assets`：`AssetRegistry` 负责解码（`createImageBitmap`）、引用计数、GPU 纹理 LRU
- `ImageEntity.assetId` 稳定引用；序列化保留 `href`，不依赖临时 blob URL
- 导入图片会创建或复用 **图像图层**（`gcode.mode === 'image'`），不抢占当前矢量活动层
- 图像层与线 / 填充层 **禁止互拖实体**；G-code 导出跳过图像层与图像实体
- Playground：AppBar 导入、工具栏 Image、画布拖放

---

## 导入路径优化

DXF / G-code 导入共用 `optimizeImportPaths`（`@cadkit/geometry`）：

1. **端点焊接** — 容差内合并碎线段  
2. **自闭合** — 首尾接近则闭合并成环  
3. **共线简化** — 丢掉直线上的中间点  

`stats.before` / `after` 只统计参与焊接的 open path；圆、弧等非路径实体原样透传。
