# Plugins

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

Plugins install per Editor instance and clean up on `dispose`.
