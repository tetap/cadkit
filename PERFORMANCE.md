# Performance Spike Freeze

- Browser GPU spike: Playground `#/benchmark`
- Headless CPU spike: `pnpm spike:cpu` → `scripts/spike-report.json`

## Frozen targets

| Key | Target |
|-----|--------|
| nav-desktop-high-p95 | ≤ 16.7ms |
| nav-integrated-p95 | ≤ 33ms |
| click-p95 | ≤ 100ms |
| edit-first-correct-frame | ≤ 100ms |
| simple-visible-1m | 60fps high-end / 30fps integrated (LOD-qualified) |
| total-entities-10m | chunked out-of-core, bounded memory |

## Worker ABI (frozen)

```
major: 0
minor: 1
channel: shared-array-buffer | transferable
```

Envelope: `{ id, session, type, payload }` with session invalidation on document switch.

## Headless baseline (CPU display-list)

Captured on local Node after LOD fix (max-edge pixel cull):

- 10k lines: build p95 should stay interactive
- 100k lines: requires viewport culling + batching
- 1M lines: must rely on spatial query + LOD; full-scene CPU project is not a frame budget path

## Notes

- Complex splines / hatches / dense labels are **not** committed to million-entity full-detail 60 FPS.
- Canvas2D is compatibility / mid-size; WebGPU is the scale path.
- Re-run GPU spike on target devices before tightening CI gates.
