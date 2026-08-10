# Deployment & Threads

SharedArrayBuffer / WASM threads require:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Playground Vite enables these by default. Without them the runtime falls back to transferable `ArrayBuffer` (`WORKER_ABI.channel`).
