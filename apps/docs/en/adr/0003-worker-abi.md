# ADR 0003: Worker ABI 0.1

## Status

Accepted (frozen by tech spike)

## Decision

```ts
WORKER_ABI = { major: 0, minor: 1, channel: 'shared-array-buffer' | 'transferable' }
```

Message envelope: `{ id, session, type, payload }`. All async results bind to `SessionToken`; stale session results are dropped.

## Consequences

Cross-package upgrades must bump ABI; tests cover protocol compatibility.
