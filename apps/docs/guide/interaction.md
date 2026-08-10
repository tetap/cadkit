# 交互：工具、选择、组、吸附与平移

CADKit Playground 提供完整桌面编辑器壳：左侧工具轨、顶部上下文属性、右侧 Inspector/Effects、底部视图与状态栏。

## 工具

| 工具 | 快捷键 | 说明 |
|------|--------|------|
| 选择 | `V` | 对象模式 AABB 缩放/旋转；双击进矢量编辑 |
| 平移 | `H` / 空格 / 中键 | 带惯性阻尼 |
| 直线 | `L` | 两点创建线 |
| 矩形 | `R` | 闭合 polyline |
| 椭圆 | `O` | 拖拽对角线 |
| 圆 | `C` | 圆心+半径 |
| 多段线 | `W` | 点击加点，Enter/双击提交 |
| 钢笔 | `P` | 自由绘制 Bezier 控制点 |
| 文本 | `T` | IME textarea 输入后提交 TextEntity |
| 图片 | `I` | 点击放置 / 拖放文件；走 AssetRegistry |

撤销/重做：`Cmd/Ctrl+Z`、`Shift+Cmd/Ctrl+Z`。绘制中 `Escape` 取消预览。

## 选择命中模式

`interaction.selectionHitMode`：

| 值 | 行为 |
|----|------|
| `bounds`（默认） | 点击选中框内空白仍保持选中并可拖拽 |
| `geometry` | 仅几何命中才保留选中 |

```ts
editor.setSelectionHitMode('bounds')
editor.setSelectionHitMode('geometry')
```

旋转手柄拖拽时选框做 OBB 随转；松手后重算轴对齐 AABB。

## 打组与历史

```ts
const groupId = editor.group([idA, idB]) // 经 HistoryStack，可撤销
editor.ungroup(groupId) // 烘焙组矩阵到子节点，世界几何不跳变
```

- 对 Group 变换只乘算 `GroupEntity.transform`。
- 嵌套组世界平移会先把 delta 变换到父局部空间。
- 删除组使用子树快照，undo 可完整恢复。

## 吸附

| 字段 | 含义 |
|------|------|
| `snapEnabled` | 端点/网格等绘制吸附 |
| `alignEnabled` | 拖拽 AABB 对齐（最佳一条引导线） |
| `angleStepDeg` | 旋转步长（Shift=45°） |
| `panDamping` | 平移惯性阻尼 |

## 属性与滤镜 API

```ts
editor.updateEntity(id, patch)
editor.applyStyle(id, { stroke: '#f00', opacity: 0.8 })
editor.addImageFilter(id, { type: 'brightness', params: { amount: 1.2 } })
editor.setImageFilters(id, [])
editor.canUndo(); editor.canRedo(); editor.zoomTo(1.1)
```
