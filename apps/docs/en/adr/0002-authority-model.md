# ADR 0002: Float64 Authority Model

## Status

Accepted

## Context

GPUs only expose f32; industrial drawings with large coordinates need stable measure and snap.

## Decision

- CPU/WASM Float64 document is the single source of truth
- GPU uses chunk origin + Float32 relative coordinates
- Render scene is disposable

## Consequences

Extra projection cost in exchange for precision and recoverability.
