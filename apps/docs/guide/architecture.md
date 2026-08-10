# 架构

## 分层

```
UI / Playground
    ↓
@cadkit/editor          公共门面
    ↓
interaction / scene / commands
    ↓
document (Float64 SoA 权威)  ←→  spatial (R-tree)
    ↓
render-core ← render-webgpu
    ↓
platform-web / worker-runtime / wasm
```

## 原则

1. **文档是唯一事实源**：渲染对象可丢弃，禁止把 GPU 顶点当权威数据。
2. **统一 Backend 协议**：业务不依赖 WebGPU 细节；渲染后端仅 WebGPU。
3. **增量失效**：变更同时携带 `beforeBounds/afterBounds`，驱动索引与脏区。
4. **扁平显示列表**：按 `pass → primitive → style` 排序批处理。
5. **实例级插件**：禁止全局可变注册表。

## 与 Leafer / Fabric 的关系

| 来源 | 吸纳 | 不照搬 |
|------|------|--------|
| LeaferJS | 脏区、生命周期、分层、平台适配 | 线性树命中、单一大脏矩形 |
| Fabric.js | 门面 API、控制柄策略、事件 disposer、SVG DX | 每对象离屏缓存作主路径、作为 CAD 模型 |
