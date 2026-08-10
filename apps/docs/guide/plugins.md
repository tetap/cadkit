# 插件开发

```ts
editor.use({
  name: 'my-plugin',
  dependencies: [],
  setup(editor) {
    const off = editor.on('selection:change', ({ ids }) => console.log(ids))
    return () => off()
  },
})
```

插件按 Editor 实例安装，`dispose` 时清理。
