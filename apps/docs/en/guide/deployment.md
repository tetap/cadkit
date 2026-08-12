# Deployment & Threads

## GitHub Pages (Playground)

Pushes to `main` trigger [Deploy Playground](https://github.com/tetap/cadkit/actions/workflows/deploy-playground.yml):

- URL: <https://tetap.github.io/cadkit/>
- Build uses `VITE_BASE=/cadkit/` (`apps/playground/vite.config.ts`)

First-time setup: repo **Settings → Pages → Build and deployment → Source** = **GitHub Actions**.

Local preview of the Pages build:

```bash
pnpm --filter @cadkit/playground build:pages
pnpm --filter @cadkit/playground preview
```

## Threads & isolation headers

SharedArrayBuffer / WASM threads require:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Playground Vite sets these in dev. GitHub Pages **cannot** set custom response headers, so the hosted demo falls back to transferable `ArrayBuffer` (`WORKER_ABI.channel`). WebGPU rendering is unaffected.
