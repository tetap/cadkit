# 生命周期与配置

## Editor

`created → initializing → ready → running ↔ suspended → disposing → disposed`

## Document session

`empty → loading → active → saving/error → closed`

## Frame phases

`beforeUpdate → update → bounds → index → cull → prepare → render → afterRender`

插件不得在不可重入阶段直接改模型。

## 配置层级

`defaults → capability profile → app config → document config`

交互相关默认值在 `DEFAULT_INTERACTION_CONFIG`（`selectionHitMode`、`alignEnabled`、`angleStepDeg`、`panDamping` 等），可通过 `createEditor({ interaction })` 或 `editor.setInteraction` 覆盖。详见 [交互与吸附](/guide/interaction)。
