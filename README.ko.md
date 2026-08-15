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
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ko.md"><b>한국어</b></a>
  </p>
  <p align="center">
    <b>레이저 조각과 펜 플로터를 위한 웹 소프트웨어.</b><br />
    CAD 캔버스에서 그리고, 레이어마다 파워 · 속도 · 패스를 설정한 뒤 GRBL G-code를 내보냅니다. 브라우저에서 설계부터 가공까지.
  </p>
</p>

<p align="center">
  <a href="https://tetap.github.io/cadkit/">
    <img src="./docs/images/playground-en.png" alt="CADKit Playground" width="920" />
  </a>
</p>

<p align="center">
  <a href="https://tetap.github.io/cadkit/"><b>라이브 Playground →</b></a>
  &nbsp;·&nbsp;
  <a href="#빠른-시작">빠른 시작</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/tetap/cadkit/tree/main/apps/docs">Docs</a>
</p>

---

## 왜 CADKit인가

대부분의 웹 캔버스는 「그리기」에서 끝납니다. CADKit은 **다이오드 / GRBL 레이저**와 **펜 플로터(필기 플로터)** 를 위해 만들어졌습니다. 편집 중인 문서가 곧 자르고, 새기고, 쓰는 작업입니다.

| 강점 | 내용 |
|------|------|
| **가공용 레이어** | 선 조각, 채우기(양방향 / 크로스해치), 이미지 스캔. 파워·속도·패스는 레이어 단위 |
| **사진 조각** | 그레이스케일 PWM, 임계값, Floyd → G-code의 `S` |
| **플로터용 경로** | 공이동 최적화, 선 용접, 점프가 적은 한 획 쓰기 |
| **진짜 원호** | 원과 피팅 곡선은 **G2 / G3**. G1 꺾은선 더미가 아님 |
| **디자인 툴급 UX** | 펜, 둥근 사각형, 불리언, 오프셋, 호 텍스트, 보이는 스냅 |
| **WebGPU + Float64** | GPU 캔버스와 CAD 정밀도. 주 렌더러는 Canvas2D가 아님 |
| **브라우저에서 완결** | 설치 불필요. `@cadkit/editor`를 임베드하거나 Playground를 사용 |

---

## 소프트웨어 설계

**캔버스 → 레이어 가공 파라미터 → GRBL 출력** 의 한 줄 흐름.

<p align="center">
  <img src="./docs/images/design-en.png" alt="CADKit software design" width="920" />
</p>

- **선** — 윤곽 조각 / 절단 / 펜 스트로크  
- **채우기** — 양방향 또는 크로스해치, 각도 지정  
- **이미지** — 래스터 스캔. 투명 부분만 공이동  
- **내보내기** — 경로 순서 최적화, `M3` / `M5`, G0, G1 / G2 / G3  

[I/O 가이드 →](./apps/docs/guide/io.md)

---

## 주요 기능

### WebGPU 무한 캔버스

벡터와 이미지를 현대 GPU 경로로 그립니다. 주 렌더러는 Canvas2D가 아닙니다.

[Docs →](./apps/docs/guide/rendering.md)

### CAD급 문서

Float64 권위 모델, 레이어, 그룹, 홀이 있는 복합 경로, 신뢰할 수 있는 Undo / Redo.

[Docs →](./apps/docs/guide/concepts.md)

### 방해하지 않는 에디터 UX

오브젝트 모드 변형, 파라메트릭 핸들(사각 / 별 / 모서리 반경), 호 텍스트, 눈금자·그리드, 정렬·각도 스냅.

[Docs →](./apps/docs/guide/interaction.md)

### 불리언 · 오프셋 · 경로 편집

합 / 차 / 교 / 배타, 윤곽 오프셋(그룹 전개), 경로 편집에서 정점 선택과 삭제.

### 가공을 위한 레이어

선 조각 / 채우기 / 이미지 모드, 파워 · 속도 · 패스, 해치 미리보기, 드래그 정렬.

### 있는 것은 넣고, 자를 것은 내보내기

SVG · DXF · G-code · 래스터 입력; SVG · JSON · G-code 출력. 가져오기 선 용접, 내보내기 공이동 최적화.

**그 외:**

- **이미지 레이어** — 래스터는 전용 레이어로. 벡터와 섞어 끌지 않습니다.
- **커브 텍스트** — 호 / 경로 텍스트와 상주 반경 핸들.
- **보이는 스냅** — 정렬·그리드·각도 스냅에 가이드 표시.
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

[LeaferJS](https://github.com/leaferjs/leafer-ui)의 증분 / 더티 영역과 [Fabric.js](https://fabricjs.com/)의 다루기 쉬운 핸들 API에서 영감 — 레이저, 플로터, CAD 규모에 맞게 재설계.

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

[Playground](https://tetap.github.io/cadkit/)를 열고 경로를 그린 뒤 레이어를 선 / 채우기로 설정하고, 레이저 또는 플로터용 G-code를 내보내세요.

---

## 개발

```bash
pnpm install && pnpm build && pnpm test
```

이슈 / 아이디어: [github.com/tetap/cadkit](https://github.com/tetap/cadkit).

---

## 라이선스

[MIT License](./LICENSE)
