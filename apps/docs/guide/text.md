# 矢量文本

- JS shaping 后备（Latin/CJK 近似 advance）
- 生产路径：HarfBuzz + FreeType WASM（`@cadkit/wasm` ABI）
- 渲染模式：`placeholder` / `msdf` / `outline`
- 编辑：`ImeTextEditor` 隐藏 textarea 代理，支持 IME
- 包络变形（扇形 / 花冠 / 波浪等）：见 [文字变形](./text-warp.md)
