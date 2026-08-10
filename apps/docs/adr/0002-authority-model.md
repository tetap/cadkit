# ADR 0002: Float64 Authority Model

## Status

Accepted

## Context

GPU 仅有 f32；大坐标工业图纸需要稳定测量与捕捉。

## Decision

- CPU/WASM Float64 文档为唯一事实源
- GPU 使用块原点 + Float32 相对坐标
- 渲染场景可丢弃

## Consequences

多一层投影成本，换取精度与可恢复性。
