# CADKit

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | **한국어**

웹용 **산업용 CAD 무한 캔버스 에디터 프레임워크** — WebGPU 렌더링, Float64 문서 모델, 대량 엔티티를 위한 모듈형 모노레포.

CADKit는 프로덕션급 인터랙션(선택, 변형, 스냅, 레이어)과 확장 가능한 씬 파이프라인(공간 인덱스, LOD, 더티 업데이트)을 결합합니다. [LeaferJS](https://github.com/leaferjs/leafer-ui)의 증분/더티 영역 아이디어와 [Fabric.js](https://fabricjs.com/)의 친숙한 객체/핸들 API에서 영감을 받았습니다.

> **상태:** 초기 오픈소스(`v0.1`). API는 변경될 수 있습니다. 기여와 피드백을 환영합니다.

---

## CADKit를 선택하는 이유

| | |
|---|---|
| **WebGPU 우선** | 벡터 + 이미지 패스를 현대 GPU 경로로 처리 (주 렌더러는 Canvas2D가 아님) |
| **CAD급 모델** | Float64 권위 문서, 레이어, 그룹, 실행 취소 / 다시 실행 |
| **에디터 UX** | 오브젝트 모드 AABB 변형, Figma 스타일 눈금자/그리드, 정렬·각도 스냅 |
| **제조 연동 훅** | 레이어별 GRBL / G-code 조각 파라미터 (내보내기용, 화면 렌더와 무관) |
| **스케일 목표** | 청크 로딩, 유계 메모리, 백만 엔티티급 내비게이션 |

---

## 캔버스 핵심 기능

### 그리기 & 편집
- **도구:** 선택(V), 팬, 직선, 사각형, 타원, 원, 폴리라인, 펜(베지어), 브러시, 텍스트, 이미지
- **변형:** 스케일/회전 핸들, 그룹/해제, 실행 취소/다시 실행
- **텍스트:** 직선 텍스트 + **원호/곡선 텍스트**(캔버스 반경 핸들)
- **불리언:** 합집합, 차집합, 교집합, 배타(다중 선택)
- **오프셋:** 윤곽 오프셋과 조인 스타일; 다중 선택 시 겹침 결과 유니온
- **이미지:** 가져오기, 배치, 선택적 필터 스택

### 문서 & 레이어
- 가시성·색상을 지원하는 다중 레이어
- 레이어 **드래그 정렬**, 엔티티를 **다른 레이어로 드롭**
- 레이어 스택이 그리기 순서를 결정(패널 위 = 앞)
- **레이어별 GRBL 파라미터**(레이어 선택 시 우측 사이드바):
  - 조각 모드: **선 조각** / **채우기 조각**
  - 채우기: 선 간격 + 스타일 — Bi-directional, Cross-Hatch, Fill Shapes Individually, Offset Fill
  - 출력, 속도, 패스 횟수  
  *(향후 G-code 내보내기용. 캔버스 렌더에 영향 없음. 요소 개별 장비 파라미터 없음.)*

### 뷰 & 가이드
- 줌/팬이 있는 무한 캔버스(관성 포함)
- 눈금자, 주/부/중간 그리드, **페이지 작업 영역** 모드
- 정렬 스냅 및 각도 스냅
- 선택 히트 모드(바운딩 박스 / 지오메트리)

### 상호운용
- **가져오기:** SVG, DXF(스트리밍), 래스터 이미지
- **내보내기:** SVG, JSON 문서
- 문서 단위(예: mm), 표시 단위, 가져오기 DPI

### 아키텍처
- 패키지: `document` · `geometry` · `scene` · `interaction` · `render-webgpu` · `editor` · …
- 공간 인덱스(R-tree / BVH), 디스플레이 리스트 캐시, LOD
- Worker / WASM 확장 포인트

---

## 빠른 시작

```bash
# Node >= 20, pnpm 10+
pnpm install
pnpm build
pnpm playground:dev    # 전체 데스크톱 에디터 플레이그라운드
pnpm docs:dev          # VitePress 문서
```

플레이그라운드에서 그리기 도구와 레이어 패널을 사용해 보세요. 레이어를 선택하면 오른쪽에서 G-code 파라미터를 편집할 수 있습니다.

---

## 저장소 구조

```
apps/
  docs/          VitePress 문서
  playground/    전체 에디터 (Dev 메뉴: 스트레스 / 시드 / 벤치)
packages/
  types/         공개 타입 및 확장점
  geometry/      행렬, 경계, 곡선, 불리언, 오프셋, 텍스트 레이아웃
  document/      Float64 권위 모델 + 레이어(gcode 포함)
  spatial/       R-tree / BVH
  commands/      트랜잭션 및 undo/redo
  scene/         문서 → 캐시 가능한 디스플레이 리스트
  assets/        이미지 레지스트리 및 필터 계약
  render-core/   렌더러 추상화 및 예산
  render-webgpu/ WebGPU 백엔드
  interaction/   도구, 선택, 스냅, 핸들, 텍스트 오버레이
  text/          IME 및 shaping
  guides/        그리드 / 눈금자 기하
  io-svg/        SVG(image 포함)
  io-dxf/        스트리밍 DXF
  platform-web/  브라우저 기능
  worker-runtime/ Worker 통신
  wasm/          WASM ABI 플레이스홀더 + JS 폴백
  editor/        공개 파사드(`createEditor`)
```

---

## 성능 목표 (v1 고정)

| 시나리오 | 목표 |
|----------|------|
| 천만 급 엔티티 | 청크 로딩, 유계 메모리 |
| 약 100만 단순 가시 엔티티 | 하이엔드 60 FPS 목표 / iGPU 약 30 FPS |
| 내비게이션 프레임 시간 | 하이엔드 p95 ≤ 16.7 ms, iGPU ≤ 33 ms |
| 순수 팬 geometry upload | &lt; 1 KB/frame (`pan-reuse`) |
| 클릭 반응 | p95 ≤ 100 ms |
| 국소 편집 첫 프레임 | ≤ 100 ms |

복잡한 스플라인, 채우기, 대량 텍스트는 100만 동시 화면 풀 디테일을 보장하지 않습니다. LOD와 실제 벤치가 전제입니다.

---

## Playground UI 언어

Playground 셸은 현재 **zh-CN**과 **en-US** UI 문자열을 제공합니다.  
이 저장소 문서는 **중/영/일/한**을 지원합니다(상단 링크). 추가 UI 로케일은 PR을 환영합니다.

---

## 기여하기

1. `pnpm install && pnpm build && pnpm test`
2. 변경은 초점을 유지하고 기존 TypeScript / 패키지 경계를 따릅니다
3. geometry, document, interaction 동작에 대한 테스트를 추가·갱신합니다
4. 요약과 테스트 계획이 있는 PR을 엽니다

이슈와 기능 제안은 [github.com/tetap/cadkit](https://github.com/tetap/cadkit)으로 보내 주세요.

---

## 라이선스

[MIT](./LICENSE)
