import type { Editor } from './Editor.js'

export interface EditorPlugin {
  name: string
  dependencies?: string[]
  setup(editor: Editor): void | (() => void)
}

export class PluginHost {
  private installed = new Map<string, () => void>()

  constructor(private readonly editor: Editor) {}

  use(plugin: EditorPlugin): void {
    if (this.installed.has(plugin.name)) {
      throw new Error(`Plugin already installed: ${plugin.name}`)
    }
    for (const dep of plugin.dependencies ?? []) {
      if (!this.installed.has(dep)) throw new Error(`Missing plugin dependency: ${dep}`)
    }
    const cleanup = plugin.setup(this.editor)
    this.installed.set(plugin.name, cleanup ?? (() => undefined))
  }

  dispose(): void {
    for (const cleanup of this.installed.values()) cleanup()
    this.installed.clear()
  }
}
