import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const root = path.resolve(__dirname, '../..')

function pkg(name: string) {
  return path.resolve(root, `packages/${name}/src/index.ts`)
}

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@cadkit/editor': pkg('editor'),
      '@cadkit/assets': pkg('assets'),
      '@cadkit/types': pkg('types'),
      '@cadkit/geometry': pkg('geometry'),
      '@cadkit/document': pkg('document'),
      '@cadkit/spatial': pkg('spatial'),
      '@cadkit/commands': pkg('commands'),
      '@cadkit/scene': pkg('scene'),
      '@cadkit/render-core': pkg('render-core'),
      '@cadkit/render-webgpu': pkg('render-webgpu'),
      '@cadkit/interaction': pkg('interaction'),
      '@cadkit/guides': pkg('guides'),
      '@cadkit/text': pkg('text'),
      '@cadkit/io-svg': pkg('io-svg'),
      '@cadkit/io-dxf': pkg('io-dxf'),
      '@cadkit/platform-web': pkg('platform-web'),
      '@cadkit/worker-runtime': pkg('worker-runtime'),
      '@cadkit/wasm': pkg('wasm'),
    },
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
