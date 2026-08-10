# ADR 0001: WebGPU First

## Status

Accepted (updated: Canvas2D path removed)

## Context

At 10M total / 1M simple-visible entities, per-entity Canvas2D drawing is unrealistic. WebGPU enables instancing and batching; text/curve complexity and browser support remain constraints.

## Decision

- WebGPU is the sole render backend
- Shared `RendererBackend` protocol remains for future backends
- Capability detection fails fast when WebGPU is unavailable

## Consequences

Requires device-lost recovery and GPU-focused consistency tests. No Canvas2D fallback ships in the editor path.
