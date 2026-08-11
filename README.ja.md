# CADKit

[English](./README.md) | [简体中文](./README.zh-CN.md) | **日本語** | [한국어](./README.ko.md)

Web 向けの**産業用 CAD 無限キャンバス・エディタフレームワーク** — WebGPU 描画、Float64 ドキュメントモデル、大規模エンティティ向けのモジュール型モノレポ。

CADKit は、本番品質のインタラクション（選択・変形・スナップ・レイヤー）と、拡張可能なシーンパイプライン（空間インデックス、LOD、ダーティ更新）を組み合わせます。[LeaferJS](https://github.com/leaferjs/leafer-ui) の増分／ダーティ領域の考え方と、[Fabric.js](https://fabricjs.com/) の扱いやすいオブジェクト／ハンドル API から着想を得ています。

> **ステータス：** 初期オープンソース（`v0.1`）。API は変更される可能性があります。コントリビュート歓迎です。

---

## CADKit を選ぶ理由

| | |
|---|---|
| **WebGPU 優先** | ベクトル＋画像パスを現代的 GPU 経路で処理（主レンダラは Canvas2D ではない） |
| **CAD 級モデル** | Float64 権威ドキュメント、レイヤー、グループ、Undo / Redo |
| **エディタ UX** | オブジェクトモード AABB 変形、Figma 風ルーラー／グリッド、整列・角度スナップ |
| **製造向けフック** | レイヤー単位の GRBL / G-code 彫刻パラメータ（エクスポート向け。画面描画には未使用） |
| **スケール目標** | チャンク読み込み、有界メモリ、百万エンティティ級ナビゲーション |

---

## キャンバスのコア機能

### 描画と編集
- **ツール：** 選択 (V)、パン、直線、矩形、楕円、円、ポリライン、ペン（ベジェ）、ブラシ、テキスト、画像
- **変形：** 拡大縮小／回転ハンドル、グループ化・解除、Undo / Redo
- **テキスト：** 直線テキスト＋**円弧／カーブテキスト**（キャンバス上の半径ハンドル）
- **ブール演算：** 和・差・積・排他的論理和（複数選択）
- **オフセット：** 輪郭オフセットと結合スタイル。複数選択時は重なりをユニオン
- **画像：** インポート、配置、任意のフィルタスタック

### ドキュメントとレイヤー
- 可視性・色付きマルチレイヤー
- レイヤーの**ドラッグ並べ替え**、エンティティの**他レイヤーへのドロップ**
- レイヤースタックが描画順を決定（パネル上部＝前面）
- **レイヤー単位 GRBL パラメータ**（レイヤー選択時に右サイドバー）：
  - 彫刻モード：**線彫刻** / **塗り彫刻**
  - 塗り：線間隔＋スタイル — Bi-directional、Cross-Hatch、Fill Shapes Individually、Offset Fill
  - パワー、速度、パス回数  
  *（将来の G-code エクスポート用。キャンバス描画には影響しません。要素単体の機械パラメータはありません。）*

### ビューとガイド
- ズーム／パン付き無限キャンバス（慣性あり）
- ルーラー、主／副／中間グリッド、**ページ作業領域**モード
- 整列スナップと角度スナップ
- 選択ヒットモード（バウンディングボックス／幾何）

### 相互運用
- **インポート：** SVG、DXF（ストリーミング）、ラスター画像
- **エクスポート：** SVG、JSON ドキュメント
- ドキュメント単位（例：mm）、表示単位、インポート DPI

### アーキテクチャ
- パッケージ：`document` · `geometry` · `scene` · `interaction` · `render-webgpu` · `editor` · …
- 空間インデックス（R-tree / BVH）、ディスプレイリストキャッシュ、LOD
- Worker / WASM 拡張ポイント

---

## クイックスタート

```bash
# Node >= 20、pnpm 10+
pnpm install
pnpm build
pnpm playground:dev    # フルデスクトップエディタ
pnpm docs:dev          # VitePress ドキュメント
```

Playground で描画ツールとレイヤーパネルを試し、レイヤーを選ぶと右側で G-code パラメータを編集できます。

---

## リポジトリ構成

```
apps/
  docs/          VitePress ドキュメント
  playground/    フルエディタ（Dev メニュー：負荷／シード／ベンチ）
packages/
  types/         公開型と拡張点
  geometry/      行列、境界、曲線、ブール、オフセット、テキストレイアウト
  document/      Float64 権威モデル＋レイヤー（gcode 含む）
  spatial/       R-tree / BVH
  commands/      トランザクションと Undo/Redo
  scene/         ドキュメント → キャッシュ可能な表示リスト
  assets/        画像レジストリとフィルタ契約
  render-core/   レンダラ抽象と予算
  render-webgpu/ WebGPU バックエンド
  interaction/   ツール、選択、スナップ、ハンドル、テキストオーバーレイ
  text/          IME と shaping
  guides/        グリッド／ルーラー幾何
  io-svg/        SVG（image 含む）
  io-dxf/        ストリーミング DXF
  platform-web/  ブラウザ能力
  worker-runtime/ Worker 通信
  wasm/          WASM ABI プレースホルダ＋ JS フォールバック
  editor/        公開ファサード（`createEditor`）
```

---

## パフォーマンス目標（v1 凍結）

| シナリオ | 目標 |
|----------|------|
| 千万級エンティティ | チャンク読み込み、有界メモリ |
| 約 100 万の単純可視エンティティ | ハイエンドで 60 FPS 目指す／iGPU で約 30 FPS |
| ナビフレーム時間 | ハイエンド p95 ≤ 16.7 ms、iGPU ≤ 33 ms |
| 純パン時 geometry upload | &lt; 1 KB/frame（`pan-reuse`） |
| クリック応答 | p95 ≤ 100 ms |
| 局所編集の初フレーム | ≤ 100 ms |

複雑なスプライン、塗り、大量テキストは、100 万同画面のフルディテールを保証しません。LOD と実ベンチが前提です。

---

## Playground の UI 言語

Playground シェルは現在 **zh-CN** と **en-US** の UI 文字列を提供します。  
本リポジトリのドキュメントは**中・英・日・韓**に対応しています（先頭のリンク参照）。追加の UI ロケールは PR 歓迎です。

---

## コントリビュート

1. `pnpm install && pnpm build && pnpm test`
2. 変更は焦点を絞り、既存の TypeScript／パッケージ境界に合わせる
3. geometry / document / interaction の挙動にテストを追加・更新
4. 要約とテスト計画付きで PR を作成

Issue・機能提案は [github.com/tetap/cadkit](https://github.com/tetap/cadkit) へ。

---

## ライセンス

[MIT](./LICENSE)
