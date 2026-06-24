<div align="center">

# Cookbook

Practical patterns for service code, runtime lookup, plugin bypass, request metadata, and keeping repository calls small without hiding Drizzle.

</div>

## Files

| File | Focus |
| --- | --- |
| [`dynamic-repositories.md`](./dynamic-repositories.md) | Using `repository(name)` safely |
| [`select-include-and-where.md`](./select-include-and-where.md) | Choosing the right query shape |
| [`error-handling.md`](./error-handling.md) | Nullable reads, `.throw()`, boundary mapping |
| [`plugin-bypass-and-state.md`](./plugin-bypass-and-state.md) | `$withState(...)` and `$withoutPlugins()` |
| [`multi-tenant-and-meta.md`](./multi-tenant-and-meta.md) | Request metadata and tenant-aware hooks |
| [`service-patterns.md`](./service-patterns.md) | A small service-layer style that fits the library |
