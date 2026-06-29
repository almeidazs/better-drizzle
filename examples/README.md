<div align="center">

# Better Drizzle Examples

A rich Markdown catalog for `better-drizzle`, organized the way people actually learn a data layer:
setup first, queries second, transactions and hooks after that, plugins when the core API is clear, and performance once behavior is settled.

</div>

<div align="center">

This directory is intentionally documentation-only.
There are no demo apps here, only copyable examples, patterns, and feature coverage.

For the docs site version of this material, see:

- https://better-drizzle.vercel.app/docs
- https://better-drizzle.vercel.app/docs/reference/support-matrix
- https://better-drizzle.vercel.app/docs/guides/migrating-from-drizzle

</div>

## Reading paths

### Start here

1. [`basics/getting-started.md`](./basics/getting-started.md)
2. [`basics/reads-and-filters.md`](./basics/reads-and-filters.md)
3. [`basics/crud.md`](./basics/crud.md)
4. [`basics/transactions.md`](./basics/transactions.md)

### If you care about plugins

1. [`plugins/official-plugins.md`](./plugins/official-plugins.md)
2. [`plugins/timestamps.md`](./plugins/timestamps.md)
3. [`plugins/soft-delete.md`](./plugins/soft-delete.md)
4. [`plugins/plugin-lifecycle.md`](./plugins/plugin-lifecycle.md)
5. [`plugins/custom-plugin.md`](./plugins/custom-plugin.md)

### If you are comparing with raw Drizzle

1. [`performance/benchmarking.md`](./performance/benchmarking.md)
2. [`performance/overhead-and-parity.md`](./performance/overhead-and-parity.md)
3. [`performance/hot-path-guidelines.md`](./performance/hot-path-guidelines.md)

## Directory map

| Folder | Purpose | Good files to start with |
| --- | --- | --- |
| [`basics`](./basics/README.md) | Full API surface: setup, reads, writes, pagination, transactions, raw SQL, hooks, throwing helpers | `getting-started.md`, `reads-and-filters.md`, `transactions.md` |
| [`frameworks`](./frameworks/README.md) | How the client usually fits into Bun, Express, Fastify, and Next.js | `bun-sqlite.md`, `express-postgres.md` |
| [`plugins`](./plugins/README.md) | Official plugins, plugin lifecycle, typed operation args, state, extensions | `official-plugins.md`, `custom-plugin.md` |
| [`performance`](./performance/README.md) | Benchmark interpretation, parity rules, overhead reasoning | `benchmarking.md` |
| [`cookbook`](./cookbook/README.md) | Reusable patterns for real services and repositories | `service-patterns.md`, `plugin-bypass-and-state.md` |

## Feature coverage map

| Feature | Where to read |
| --- | --- |
| `better(db, { schema })` bootstrap | [`basics/getting-started.md`](./basics/getting-started.md) |
| `findMany`, `findFirst`, `findOne`, `findUnique` | [`basics/reads-and-filters.md`](./basics/reads-and-filters.md) |
| `create`, `createMany`, `update`, `updateMany`, `updateEach`, `delete`, `deleteMany`, `upsert`, `upsertMany` | [`basics/crud.md`](./basics/crud.md) |
| `select`, `include`, nested relation filters | [`basics/relations.md`](./basics/relations.md) |
| `paginate`, offset, cursor, backwards navigation | [`basics/pagination.md`](./basics/pagination.md) |
| `transaction`, nested savepoints, retries, rollback hooks | [`basics/transactions.md`](./basics/transactions.md) |
| row locks: `FOR UPDATE`, `FOR SHARE`, `skipLocked`, `noWait`, `tables`, `transactionsOnly` | [`basics/locks.md`](./basics/locks.md) |
| `$raw`, `$executeRaw`, `$rawUnsafe` | [`basics/raw-sql.md`](./basics/raw-sql.md) |
| client hooks | [`basics/hooks.md`](./basics/hooks.md) |
| `.throw()` helpers | [`basics/throwing-results.md`](./basics/throwing-results.md) |
| `repository(name)` | [`cookbook/dynamic-repositories.md`](./cookbook/dynamic-repositories.md) |
| `$withState` and `$withoutPlugins` | [`cookbook/plugin-bypass-and-state.md`](./cookbook/plugin-bypass-and-state.md) |
| timestamps plugin | [`plugins/timestamps.md`](./plugins/timestamps.md) |
| soft delete plugin | [`plugins/soft-delete.md`](./plugins/soft-delete.md) |
| `definePlugin(...)` and plugin lifecycle | [`plugins/custom-plugin.md`](./plugins/custom-plugin.md), [`plugins/plugin-lifecycle.md`](./plugins/plugin-lifecycle.md) |

## Design notes for these examples

- The snippets stay close to the exported API in `packages/core/src/types`.
- The examples prefer explicit schemas and small query fragments over framework-heavy boilerplate.
- The performance examples follow the repository rule that comparisons must be parity-equivalent.
- When an example depends on dialect behavior, the page calls that out directly.
