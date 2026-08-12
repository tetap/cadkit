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
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ko.md"><b>한국어</b></a>
  </p>
  <p align="center">
    <b>웹에서 제품을 출시하는 팀을 위한 CAD 캔버스 프레임워크.</b><br />
    WebGPU 렌더링, Float64 문서 모델, 디자인 툴에 가까운 편집 경험 — 필요할 때 제조 I/O.
  </p>
</p>

<p align="center">
  <a href="https://tetap.github.io/cadkit/"><b>라이브 데모 →</b></a>
  &nbsp;·&nbsp;
  <a href="#빠른-시작">빠른 시작</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/tetap/cadkit/tree/main/apps/docs">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/tetap/cadkit/tree/main/apps/playground">Playground</a>
</p>

---

## 주요 기능

### WebGPU 무한 캔버스

벡터·이미지를 현대 GPU 경로로 그립니다. 주 렌더러는 Canvas2D가 아닙니다.

[Docs →](./apps/docs/guide/rendering.md)

### CAD급 문서

Float64 권위 모델, 레이어, 그룹, 홀이 있는 복합 경로, 신뢰할 수 있는 Undo / Redo.

[Docs →](./apps/docs/guide/concepts.md)

### 방해하지 않는 에디터 UX

오브젝트 모드 변형, 파라메트릭 도형 핸들(사각 / 별), 호 텍스트, 눈금자·그리드, 정렬·각도 스냅.

[Docs →](./apps/docs/guide/interaction.md)

### 불리언 · 오프셋 · 경로 편집

합/차/교/배타, 윤곽 오프셋(그룹 포함), 경로 편집에서 정점 선택·삭제.

[Docs →](./apps/docs/guide/interaction.md)

### 가공을 위한 레이어

선 조각 / 채우기 / 이미지 모드, 파워·속도·패스, 해치 미리보기, 드래그 정렬.

[Docs →](./apps/docs/guide/io.md)

### 있는 것은 넣고, 자를 것은 내보내기

SVG · DXF · G-code · 래스터 입력; SVG · JSON · G-code 출력. 가져오기 용접,보내기 공이동 최적화.

[Docs →](./apps/docs/guide/io.md)

**그 외:**

- **이미지 레이어** — 래스터는 전용 레이어로, 벡터와 섞어 끌지 않습니다.
- **커브 텍스트** — 호/경로 텍스트와 상주 반경 핸들.
- **보이는 스냅** — 정렬·그리드·각도 스냅 가이드.
- **공간 파이프라인** — R-tree / BVH, 디스플레이 리스트 캐시, LOD, 증분 WebGPU.
- **Playground** — 임베드 전에 써보는 데스크톱 UI (zh-CN / en-US).
- **계속 출시** — 초기 API(`v0.1`). [커밋 기록](https://github.com/tetap/cadkit/commits/main)이 살아있는 변경 로그입니다.

---

## 스택 한눈에

TypeScript **모노레포** — 패키지 단위로 쓰거나 에디터 파사드부터 시작하세요.

| 계층 | 패키지 |
|------|--------|
| **Public API** | `@cadkit/editor` · `@cadkit/types` |
| **Model** | `@cadkit/document` · `@cadkit/commands` · `@cadkit/geometry` |
| **View** | `@cadkit/scene` · `@cadkit/render-webgpu` · `@cadkit/guides` |
| **Input** | `@cadkit/interaction` · `@cadkit/text` |
| **I/O** | `@cadkit/io-svg` · `@cadkit/io-dxf` · `@cadkit/io-gcode` · `@cadkit/assets` |

[LeaferJS](https://github.com/leaferjs/leafer-ui)의 증분/더티 영역과 [Fabric.js](https://fabricjs.com/)의 친숙한 핸들 API에서 영감 — CAD 규모와 제조 워크플로에 맞게 재설계.

---

## 빠른 시작

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

---

## 개발

```bash
pnpm install && pnpm build && pnpm test
```

이슈 / 아이디어: [github.com/tetap/cadkit](https://github.com/tetap/cadkit).

---

## 라이선스

[MIT License](./LICENSE)
