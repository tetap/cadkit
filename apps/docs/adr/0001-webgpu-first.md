# ADR 0001: WebGPU Only

## Status

Accepted（已移除 Canvas2D 路径）

## Context

千万总实体 / 百万简单可见实体目标下，Canvas2D 逐实体绘制不现实；WebGPU 具备实例化与批处理优势。

## Decision

- WebGPU 为唯一渲染后端
- 保留共享 `RendererBackend` 协议以便扩展
- 无 WebGPU 时快速失败，不再提供 Canvas2D 降级

## Consequences

需要设备丢失恢复与 GPU 一致性测试；编辑器路径不再维护双后端。
