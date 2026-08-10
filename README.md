# CADKit

工业 CAD 无限画布编辑器框架。WebGPU 渲染、Float64 权威模型、Worker/WASM 计算与分块流式架构。

对象模式 AABB 变换、组矩阵、对齐/角度吸附、平移惯性、Figma 风格尺子网格（含 mid 线与工作区页模式）。

吸收 [LeaferJS](https://github.com/leaferjs/leafer-ui) 的增量更新与脏区思想，以及 [Fabric.js](https://fabricjs.com/) 的易用对象/控制柄 API。

## 仓库结构

```
apps/
  docs/          VitePress 文档
  playground/    单一完整桌面编辑器（Dev 菜单含百万实体/基准）
packages/
  types/         公开类型与扩展点
  geometry/      矩阵、包围盒、曲线、容差
  document/      Float64 权威模型
  spatial/       R-tree / BVH
  commands/      事务与 undo/redo（含 Group/Ungroup）
  scene/         文档 → 可缓存显示列表
  assets/        图片资产注册、滤镜契约
  render-core/   渲染抽象与资源预算
  render-webgpu/ WebGPU 后端（向量 + 图片 pass）
  interaction/   完整工具集、选择、捕捉、控制柄
  text/          IME + 字体 atlas
  io-svg/        SVG（含 image）
  io-dxf/        流式 DXF
  platform-web/  浏览器平台适配
  worker-runtime/ Worker 通信
  wasm/          WASM ABI 占位与 JS 后备实现
  editor/        公共门面
```

## 快速开始

```bash
pnpm install
pnpm build
pnpm playground:dev
pnpm docs:dev
```

## 性能目标（首版冻结）

| 场景 | 目标 |
|------|------|
| 千万总实体 | 分块加载，有界内存 |
| 百万简单可见实体 | 高端桌面争取 60 FPS，基准核显 30 FPS |
| 导航帧耗时 | 高端 p95 ≤ 16.7 ms；核显 ≤ 33 ms |
| 纯平移 geometry upload | &lt; 1 KB/frame（`pan-reuse`） |
| 点击反馈 | p95 ≤ 100 ms |
| 局部编辑首帧 | ≤ 100 ms |

复杂样条、填充与海量文本不承诺百万级全细节同屏，须经 LOD 与真实基准限定。

## License

MIT
