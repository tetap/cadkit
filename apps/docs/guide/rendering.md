# 渲染与增量更新

CADKit **仅 WebGPU**。Canvas/OffscreenCanvas 只用于生成字体 atlas 或解码辅助，不作画布后端。

## 帧流水线

文档变更 → 空间索引增量 → Scene 几何缓存 →（可选）纯平移复用 → pack/upload → vector pass → image/text pass → overlay → metrics

## 增量路径（已接入）

| 模式 | 行为 |
|------|------|
| `full` | 场景变更后重建可见 DisplayList，上传向量缓冲 |
| `pan-reuse` | 纯平移：复用上一帧 DisplayList + GPU 顶点，只更新相机 uniform；geometry upload ≈ 0 |
| `zoom-bin` | 缩放跨 LOD bin 时重细分圆弧等 |

- Scene 缓存键：`(entityId, entity.version, lodBin)`
- Grid：按 viewport / zoom-bin / 单位 / 工作区 / 主题缓存；小幅平移可偏移屏幕网格顶点
- HandleOverlay：DOM 元素池，避免 pointermove 销毁重建
- `DirtyRegionTracker` / `consumeDirtyMeta()`：文档变更写入失效 bounds，为后续 dirty-rect 合成保留接口（本轮不做高风险持久帧缓冲）

## 图片与滤镜

- Image pass：alpha 混合 triangle-list，纹理 bind group，占位/错误色块
- 内置滤镜：brightness / contrast / saturation / grayscale / invert / opacity；blur 设计为横纵 separable 双 pass
- 自定义 WGSL：**仅函数体**契约  
  `filter(color: vec4f, uv: vec2f, params) -> vec4f`  
  禁止额外 `@group` / storage / atomic / external texture / 无限 loop；编译失败回退 identity

## FrameMetrics

除 `frameMs` / `uploadBytes` 外，可选 `sceneBuildMs`、`packMs`、`uploadMs`、`submitMs`、`geometryUploadBytes`、`mode`。

## LOD

几何屏幕误差细分、亚像素密度抽样、文本远距跳过；`textBudget` 配置保留给后续字形配额。
