# ADR 0003: Worker ABI 0.1

## Status

Accepted (frozen by tech spike)

## Decision

```ts
WORKER_ABI = { major: 0, minor: 1, channel: 'shared-array-buffer' | 'transferable' }
```

消息信封：`{ id, session, type, payload }`。所有异步结果绑定 `SessionToken`，旧会话结果丢弃。

## Consequences

跨包升级需 bump ABI；测试覆盖协议兼容。
