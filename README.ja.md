<p align="center">
  <h1 align="center">CADKit</h1>
  <p align="center">
    <a href="https://github.com/tetap/cadkit/stargazers"><img src="https://img.shields.io/github/stars/tetap/cadkit?style=flat&color=f5a623" alt="GitHub stars" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://gpuweb.github.io/gpuweb/"><img src="https://img.shields.io/badge/WebGPU-first-4141E2" alt="WebGPU-first" /></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node >= 20" /></a>
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ja.md"><b>日本語</b></a> ·
    <a href="./README.ko.md">한국어</a>
  </p>
  <p align="center">
    <b>Web で製品を届けるための CAD キャンバスフレームワーク。</b><br />
    WebGPU 描画、Float64 ドキュメント、デザインツールに近い編集体験 — 必要なときに製造向け I/O。
  </p>
</p>

<p align="center">
  <a href="https://tetap.github.io/cadkit/"><b>ライブデモ →</b></a>
  &nbsp;·&nbsp;
  <a href="#クイックスタート">クイックスタート</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/tetap/cadkit/tree/main/apps/docs">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/tetap/cadkit/tree/main/apps/playground">Playground</a>
</p>

---

## 機能ハイライト

### WebGPU 無限キャンバス

ベクトルと画像を現代的な GPU パスで描画。主レンダラは Canvas2D ではありません。

[Docs →](./apps/docs/guide/rendering.md)

### CAD 級ドキュメント

Float64 権威モデル、レイヤー、グループ、穴付き複合パス、信頼できる Undo / Redo。

[Docs →](./apps/docs/guide/concepts.md)

### 邪魔にならないエディタ UX

オブジェクトモード変形、パラメトリック形状ハンドル（矩形 / 星）、弧テキスト、ルーラー、グリッド、整列・角度スナップ。

[Docs →](./apps/docs/guide/interaction.md)

### ブール・オフセット・パス編集

和 / 差 / 積 / XOR、輪郭オフセット（グループ展開）、パス編集での頂点選択と削除。

[Docs →](./apps/docs/guide/interaction.md)

### 加工向けレイヤー

線彫刻 / 塗り / 画像モード、パワー・速度・パス数、ハッチプレビュー、ドラッグ並べ替え。

[Docs →](./apps/docs/guide/io.md)

### あるものを入れ、切るものを出す

SVG · DXF · G-code · ラスタ入力；SVG · JSON · G-code 出力。インポート時の線溶接、エクスポート時の空走最適化。

[Docs →](./apps/docs/guide/io.md)

**そのほか:**

- **画像レイヤー** — ラスタは専用レイヤーへ。ベクトルと混在ドラッグしません。
- **カーブテキスト** — 弧 / パステキストと常駐半径ハンドル。
- **見えるスナップ** — 整列・グリッド・角度スナップにガイド表示。
- **空間パイプライン** — R-tree / BVH、表示リストキャッシュ、LOD、増分 WebGPU。
- **Playground** — 埋め込み前に試せるデスクトップ UI（zh-CN / en-US）。
- **継続出荷** — 早期 API（`v0.1`）。[コミット履歴](https://github.com/tetap/cadkit/commits/main)が生きた変更ログです。

---

## スタック概要

TypeScript **モノレポ** — パッケージ単位でも、エディタファサードからでも始められます。

| 層 | パッケージ |
|----|------------|
| **Public API** | `@cadkit/editor` · `@cadkit/types` |
| **Model** | `@cadkit/document` · `@cadkit/commands` · `@cadkit/geometry` |
| **View** | `@cadkit/scene` · `@cadkit/render-webgpu` · `@cadkit/guides` |
| **Input** | `@cadkit/interaction` · `@cadkit/text` |
| **I/O** | `@cadkit/io-svg` · `@cadkit/io-dxf` · `@cadkit/io-gcode` · `@cadkit/assets` |

[LeaferJS](https://github.com/leaferjs/leafer-ui) の増分 / ダーティ領域と [Fabric.js](https://fabricjs.com/) の扱いやすいハンドル API に着想 — CAD 規模と製造フロー向けに再設計。

---

## クイックスタート

```bash
# Node >= 20, pnpm 10+
pnpm install
pnpm build
pnpm playground:dev
pnpm docs:dev
```

```ts
import { createEditor } from '@cadkit/editor'

const editor = await createEditor({ view: canvas, theme: 'light' })
await editor.import.svg(svgText)
await editor.import.dxf(dxfFile)
await editor.import.gcode(gcodeText)
const nc = editor.export.gcode()
```

---

## 開発

```bash
pnpm install && pnpm build && pnpm test
```

Issue / アイデア: [github.com/tetap/cadkit](https://github.com/tetap/cadkit)。

---

## ライセンス

[MIT License](./LICENSE)
