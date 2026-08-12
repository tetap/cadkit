# 部署与线程

## GitHub Pages（Playground）

`main` 推送后由 [Deploy Playground](https://github.com/tetap/cadkit/actions/workflows/deploy-playground.yml) 构建，并推到 **`gh-pages`** 分支。

- 地址：<https://tetap.github.io/cadkit/>
- 构建时 `VITE_BASE=/cadkit/`（见 `apps/playground/vite.config.ts`）

### 如何启用（Settings → Pages）

在仓库打开：`Settings` → `Pages`，按下面选：

| 项 | 选择 |
|----|------|
| **Source** | **Deploy from a branch** |
| **Branch** | **`gh-pages`** |
| **Folder** | **/ (root)** |

点 **Save**。  
若下拉里还没有 `gh-pages`：先等 Actions 里 **Deploy Playground** 跑成功一次（会自动创建该分支），再刷新 Pages 设置页。

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
