# Vector Text

- JS shaping fallback (approximate Latin/CJK advances)
- Production path: HarfBuzz + FreeType WASM (`@cadkit/wasm` ABI)
- Render modes: `placeholder` / `msdf` / `outline`
- Editing: `ImeTextEditor` hidden textarea proxy with IME support
