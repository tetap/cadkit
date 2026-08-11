# CADKit

[English](./README.md) | **简体中文** | [日本語](./README.ja.md) | [한국어](./README.ko.md)

面向 Web 的**工业 CAD 无限画布编辑器框架** —— WebGPU 渲染、Float64 权威文档模型，以及为高实体量设计的模块化 monorepo。

CADKit 把生产级交互（选择、变换、吸附、图层）与可扩展场景管线（空间索引、LOD、脏区更新）结合在一起。吸收了 [LeaferJS](https://github.com/leaferjs/leafer-ui) 的增量 / 脏区思路，以及 [Fabric.js](https://fabricjs.com/) 易用的对象与控制柄 API。

> **状态：** 早期开源（`v0.1`），API 可能演进。欢迎贡献与反馈。

---

## 为什么选择 CADKit？

| | |
|---|---|
| **WebGPU 优先** | 向量 + 图片通道走现代 GPU 路径（不以 Canvas2D 作为主渲染器） |
| **CAD 级模型** | Float64 权威文档、图层、编组、撤销 / 重做 |
| **编辑器体验** | 对象模式 AABB 变换、类 Figma 尺规网格、对齐与角度吸附 |
| **制造向扩展点** | 图层级 GRBL / G-code 雕刻参数（面向导出；不参与屏幕绘制） |
| **规模目标** | 分块加载、有界内存、百万级导航性能目标 |

---

## 画布核心功能

### 绘制与编辑
- **工具：** 选择 (V)、平移、直线、矩形、椭圆、圆、多段线、钢笔（贝塞尔）、笔刷、文字、图片
- **变换：** 缩放 / 旋转手柄、编组与解组、撤销 / 重做
- **文字：** 直线文字 + **圆弧 / 曲线文字**（画布半径手柄）
- **布尔运算：** 并集、差集、交集、异或（多选）
- **偏移：** 轮廓偏移与拐角样式；多选时对重叠结果做并集
- **图片：** 导入、放置、可选滤镜栈

### 文档与图层
- 多图层：可见性、颜色
- **拖拽排序**图层；将**实体拖到其他图层**
- 图层栈决定绘制顺序（面板上方为前景）
- **图层级 GRBL 参数**（选中图层后在右侧边栏编辑）：
  - 雕刻方式：**线雕刻** / **填充雕刻**
  - 填充：线间距 + 样式 —— 双向填充、交叉网格、单独填充图形、偏移填充
  - 功率、速度、次数  
  *（供后续 G-code 导出；不影响画布渲染。元素不可单独设置机床参数。）*

### 视图与辅助
- 无限画布缩放 / 平移（含惯性）
- 标尺、主/次/中线网格、**工作区页模式**
- 对齐吸附与角度吸附
- 选择命中模式（包围盒 / 几何）

### 互操作
- **导入：** SVG、DXF（流式）、光栅图
- **导出：** SVG、JSON 文档
- 文档单位（如 mm）、显示单位与导入 DPI 设置

### 架构要点
- 包划分：`document` · `geometry` · `scene` · `interaction` · `render-webgpu` · `editor` · …
- 空间索引（R-tree / BVH）、显示列表缓存、LOD
- Worker / WASM 扩展点（重计算可外置）

---

## 快速开始

```bash
# Node >= 20，pnpm 10+
pnpm install
pnpm build
pnpm playground:dev    # 完整桌面编辑器 playground
pnpm docs:dev          # VitePress 文档
```

打开 playground 后可试用绘制工具、图层面板；点击图层即可在右侧编辑 G-code 参数。

---

## 仓库结构

```
apps/
  docs/          VitePress 文档
  playground/    完整桌面编辑器（Dev 菜单：压测 / 种子 / 基准）
packages/
  types/         公开类型与扩展点
  geometry/      矩阵、包围盒、曲线、布尔、偏移、文本布局
  document/      Float64 权威模型 + 图层（含 gcode 参数）
  spatial/       R-tree / BVH
  commands/      事务与 undo/redo（含编组）
  scene/         文档 → 可缓存显示列表
  assets/        图片资产与滤镜契约
  render-core/   渲染抽象与预算
  render-webgpu/ WebGPU 后端（向量 + 图片）
  interaction/   工具、选择、吸附、手柄、文字浮层
  text/          IME 与 shaping
  guides/        网格 / 标尺几何
  io-svg/        SVG（含 image）
  io-dxf/        流式 DXF
  platform-web/  浏览器能力探测
  worker-runtime/ Worker 通信
  wasm/          WASM ABI 占位与 JS 后备
  editor/        公共门面（`createEditor`）
```

---

## 性能目标（首版冻结）

| 场景 | 目标 |
|------|------|
| 千万级总实体 | 分块加载，有界内存 |
| 约百万简单可见实体 | 高端桌面争取 60 FPS；核显约 30 FPS |
| 导航帧耗时 | 高端 p95 ≤ 16.7 ms；核显 ≤ 33 ms |
| 纯平移 geometry upload | &lt; 1 KB/frame（`pan-reuse`） |
| 点击反馈 | p95 ≤ 100 ms |
| 局部编辑首帧 | ≤ 100 ms |

复杂样条、填充与海量文本不承诺百万级全细节同屏，须经 LOD 与真实基准限定。

---

## Playground 界面语言

Playground 壳层目前提供 **zh-CN** 与 **en-US** UI 文案。  
本仓库文档支持**中 / 英 / 日 / 韩**（见文首链接）。欢迎 PR 增加更多 UI 语言。

---

## 参与贡献

1. `pnpm install && pnpm build && pnpm test`
2. 变更保持聚焦，遵循现有 TypeScript / 包边界
3. 为 geometry、document、interaction 行为补充或更新测试
4. 提交 PR 时写清摘要与测试计划

Issue 与功能建议欢迎到 [github.com/tetap/cadkit](https://github.com/tetap/cadkit)。

---

## 许可证

[MIT](./LICENSE)
