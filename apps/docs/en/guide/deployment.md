# Deployment & Threads

## GitHub Pages (Playground)

Pushes to `main` trigger [Deploy Playground](https://github.com/tetap/cadkit/actions/workflows/deploy-playground.yml), which publishes to the **`gh-pages`** branch.

- URL: <https://tetap.github.io/cadkit/>
- Build uses `VITE_BASE=/cadkit/` (`apps/playground/vite.config.ts`)

### Enable Pages (Settings → Pages)

| Field | Value |
|-------|--------|
| **Source** | **Deploy from a branch** |
| **Branch** | **`gh-pages`** ← not `main` |
| **Folder** | **/ (root)** |

Click **Save**.

> ⚠️ Choosing **`main`** makes GitHub Jekyll-render the README (looks like a docs site), **not** the playground.  
> Correct page title is **CADKit Editor** with a tool rail and canvas.

If `gh-pages` is missing from the dropdown, wait for **Deploy Playground** to finish once (it creates the branch), then refresh the Pages settings page.

Local preview:

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
