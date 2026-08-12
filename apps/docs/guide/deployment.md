# 部署与线程

## GitHub Pages（Playground）

`main` 推送后由 [Deploy Playground](https://github.com/tetap/cadkit/actions/workflows/deploy-playground.yml) 自动构建并发布：

- 地址：<https://tetap.github.io/cadkit/>
- 构建时 `VITE_BASE=/cadkit/`（见 `apps/playground/vite.config.ts`）

首次部署会通过 `actions/configure-pages`（`enablement: true`）自动启用 Pages。  
若仍报 `HttpError: Not Found`，请手动打开仓库 **Settings → Pages → Build and deployment → Source**，选 **GitHub Actions**，再 **Re-run** 失败的 workflow。

本地预览 Pages 产物：

```bash
pnpm --filter @cadkit/playground build:pages
pnpm --filter @cadkit/playground preview
```

## 线程与隔离头

启用 SharedArrayBuffer / WASM threads 需要：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Playground Vite 开发服已默认配置。GitHub Pages **无法**自定义这两项响应头，因此线上演示走 transferable `ArrayBuffer` 退化通道（见 `WORKER_ABI.channel`）；WebGPU 主渲染不受影响。