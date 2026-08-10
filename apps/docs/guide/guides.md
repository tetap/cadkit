# 尺子与网格

CADKit 提供 Figma 风格的标尺与网格，均与 `Camera2D` 缩放/平移联动，并支持单位切换。

## 单位

文档存储单位：`document.unit`（世界坐标）  
标尺显示单位：`document.displayUnit`

```ts
editor.setDisplayUnit('in') // 仅改标尺/网格标注，不改写几何
```

支持：`mm | cm | m | in | ft | px | pt`

刻度采用 1/2/5×10ⁿ 美观步长，主刻度约每 80 CSS 像素一条。网格线包含 **major / mid / minor** 三级，避免 mid 刻度被过滤导致「缺一条线」。

## 工作区

- `unbounded`：视口铺满无限网格
- `page`：有限页矩形；页外灰底，网格裁剪在页内并强制绘制页边

```ts
editor.setWorkAreaMode('page')
editor.setWorkAreaSize(210, 297)
```

## API

```ts
editor.setGridVisible(true)
editor.setRulersVisible(true)
```

- 尺子：DOM 叠加层（保证文字锐利）
- 网格：WebGPU screen-space overlay pass（平移缩放保持 1px 线宽）
