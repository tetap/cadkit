# Performance Targets

Frozen by the Playground tech spike:

| Metric | Target |
|--------|--------|
| Nav high-end desktop p95 | ≤ 16.7 ms |
| Nav integrated GPU p95 | ≤ 33 ms |
| Click p95 | ≤ 100 ms |
| First correct frame after local edit | ≤ 100 ms |
| 1M simple visibles | 60 FPS high-end / 30 FPS integrated (LOD-qualified) |
| 10M total entities | Chunked, bounded memory |

Run:

```bash
pnpm playground:dev
# Open Performance → Spike Benchmark
```
