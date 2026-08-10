# Lifecycle & Config

## Editor

`created → initializing → ready → running ↔ suspended → disposing → disposed`

## Document session

`empty → loading → active → saving/error → closed`

## Frame phases

`beforeUpdate → update → bounds → index → cull → prepare → render → afterRender`

Plugins must not mutate the model during non-reentrant phases.

## Config layers

`defaults → capability profile → app config → document config`

Interaction defaults live in `DEFAULT_INTERACTION_CONFIG` (`selectionHitMode`, `alignEnabled`, `angleStepDeg`, `panDamping`, …). Override via `createEditor({ interaction })` or `editor.setInteraction`. See [Interaction & Snapping](/en/guide/interaction).
