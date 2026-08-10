# 部署与线程

启用 SharedArrayBuffer / WASM threads 需要：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Playground Vite 已默认配置。缺失时自动退化到 transferable `ArrayBuffer` 通道（见 `WORKER_ABI.channel`）。
