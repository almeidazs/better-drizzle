<div align="center">

# Plugins

Plugins are the mutation and extension layer of Better Drizzle.
They are where you add behavior once and keep repository calls small.

</div>

## Files

| File | Focus |
| --- | --- |
| [`official-plugins.md`](./official-plugins.md) | What the maintained plugins solve |
| [`timestamps.md`](./timestamps.md) | Automatic `createdAt` / `updatedAt` handling |
| [`soft-delete.md`](./soft-delete.md) | Visibility filters, soft delete behavior, restore helpers |
| [`plugin-lifecycle.md`](./plugin-lifecycle.md) | Order, setup, transforms, extensions, transaction hooks |
| [`custom-plugin.md`](./custom-plugin.md) | Writing your own plugin with `definePlugin(...)` |

## Plugin mental model

- client hooks observe
- plugins can transform and extend
- plugin order matters
- setup runs once per Better client bootstrap
