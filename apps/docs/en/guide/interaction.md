# Interaction: tools, selection, groups, snapping

The CADKit Playground is a single desktop editor shell: tool rail, context bar, Inspector/Effects, view/status bars.

## Tools

| Tool | Shortcut | Notes |
|------|----------|--------|
| Select | `V` | Object-mode AABB scale/rotate; double-click for edit mode |
| Pan | `H` / Space / MMB | Inertia damping |
| Line | `L` | Two-point line |
| Rectangle | `R` | Closed polyline |
| Ellipse | `O` | Drag diagonal |
| Circle | `C` | Center + radius |
| Polyline | `W` | Click to add; Enter/double-click commit |
| Pen | `P` | Freehand Bezier control points |
| Text | `T` | IME textarea → TextEntity |
| Image | `I` | Click-to-place / drag-drop via AssetRegistry |

Undo/redo: `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`. `Escape` cancels in-progress previews.

## Groups & history

```ts
const groupId = editor.group([idA, idB]) // HistoryStack
editor.ungroup(groupId) // bake group matrix into children
```

Nested group world translation converts the world delta into parent-local space. Removing a group snapshots the full subtree for undo.

## Style / filters

```ts
editor.updateEntity(id, patch)
editor.applyStyle(id, { stroke: '#f00' })
editor.addImageFilter(id, { type: 'brightness', params: { amount: 1.2 } })
```
