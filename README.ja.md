<p align="center">
  <h1 align="center">CADKit</h1>
  <p align="center">
    <a href="https://github.com/tetap/cadkit/stargazers"><img src="https://img.shields.io/github/stars/tetap/cadkit?style=flat&color=f5a623" alt="GitHub stars" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://gpuweb.github.io/gpuweb/"><img src="https://img.shields.io/badge/WebGPU-first-4141E2" alt="WebGPU-first" /></a>
    <img src="https://img.shields.io/badge/laser-engraving-22c55e" alt="Laser engraving" />
    <img src="https://img.shields.io/badge/pen-plotter-3b82f6" alt="Pen plotter" />
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ja.md"><b>日本語</b></a> ·
    <a href="./README.ko.md">한국어</a>
  </p>
  <p align="center">
    <b>レーザー彫刻とペンプロッターのための Web ソフトウェア。</b><br />
    CAD キャンバスで描き、レイヤーごとにパワー・速度・パス数を設定し、GRBL G-code を書き出す。ブラウザで設計から加工まで。
  </p>
</p>

<p align="center">
  <a href="https://tetap.github.io/cadkit/">
    <img src="./docs/images/playground-en.png" alt="CADKit Playground" width="920" />
  </a>
</p>

<p align="center">
  <a href="https://tetap.github.io/cadkit/"><b>ライブ Playground →</b></a>
  &nbsp;·&nbsp;
  <a href="#クイックスタート">クイックスタート</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/tetap/cadkit/tree/main/apps/docs">Docs</a>
</p>

---

## なぜ CADKit か

多くの Web キャンバスは「描く」で終わります。CADKit は **ダイオード / GRBL レーザー** と **ペンプロッター** 向けです。編集しているドキュメントが、そのまま切る・彫る・書くジョブになります。

| 強み | 内容 |
|------|------|
| **加工向けレイヤー** | 線彫刻、塗り（双方向 / クロスハッチ）、画像スキャン。パワー・速度・パス数はレイヤー単位 |
| **写真彫刻** | グレースケール PWM、しきい値、Floyd → G-code の `S` |
| **プロッター向けパス** | 空走最適化、線の溶接、少ないジャンプの一筆書き |
| **本物の円弧** | 円とフィット曲線は **G2 / G3**。G1 の折れ線だらけにしない |
| **デザインツール級 UX** | ペン、角丸、ブール、オフセット、弧テキスト、見えるスナップ |
| **WebGPU + Float64** | GPU キャンバスと CAD 精度。主レンダラは Canvas2D ではない |
| **ブラウザで完結** | インストール不要。`@cadkit/editor` を埋め込むか Playground を使う |

---

## ソフトウェア設計

**キャンバス → レイヤー加工パラメータ → GRBL 出力** の一本道。

<p align="center">
  <img src="./docs/images/design-en.png" alt="CADKit software design" width="920" />
</p>

- **線** — 輪郭の彫刻 / 切断 / ペンストローク  
- **塗り** — 双方向またはクロスハッチ、角度指定  
- **画像** — ラスタスキャン。透明部分だけ空走  
- **書き出し** — 経路順最適化、`M3` / `M5`、G0、G1 / G2 / G3  

[I/O ガイド →](./apps/docs/guide/io.md)

---

## 機能ハイライト

### WebGPU 無限キャンバス

ベクトルと画像を現代的な GPU パスで描画。主レンダラは Canvas2D ではありません。

[Docs →](./apps/docs/guide/rendering.md)

### CAD 級ドキュメント

Float64 権威モデル、レイヤー、グループ、穴付き複合パス、信頼できる Undo / Redo。

[Docs →](./apps/docs/guide/concepts.md)

### 邪魔にならないエディタ UX

オブジェクトモード変形、パラメトリックハンドル（矩形 / 星 / 角丸）、弧テキスト、ルーラー、グリッド、整列・角度スナップ。

[Docs →](./apps/docs/guide/interaction.md)

### ブール・オフセット・パス編集

和 / 差 / 積 / XOR、輪郭オフセット（グループ展開）、パス編集での頂点選択と削除。

### 加工向けレイヤー

線彫刻 / 塗り / 画像モード、パワー・速度・パス数、ハッチプレビュー、ドラッグ並べ替え。

### あるものを入れ、切るものを出す

SVG · DXF · G-code · ラスタ入力；SVG · JSON · G-code 出力。インポート時の線溶接、エクスポート時の空走最適化。

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

[LeaferJS](https://github.com/leaferjs/leafer-ui) の増分 / ダーティ領域と [Fabric.js](https://fabricjs.com/) の扱いやすいハンドル API に着想 — レーザー、プロッター、CAD 規模向けに再設計。

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
const nc = await editor.export.gcode()
```

[Playground](https://tetap.github.io/cadkit/) を開き、パスを描いてレイヤーを線 / 塗りに設定し、レーザーまたはプロッター用 G-code を書き出してください。

---

## 開発

```bash
pnpm install && pnpm build && pnpm test
```

Issue / アイデア: [github.com/tetap/cadkit](https://github.com/tetap/cadkit)。

---

## ライセンス

[MIT License](./LICENSE)
