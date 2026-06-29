<div align="center">

# Basics

The full day-one API surface.
If someone understands this folder, they can already use most of `better-drizzle` well.

</div>

## Files

| File | Focus |
| --- | --- |
| [`getting-started.md`](./getting-started.md) | Minimal setup, schema wiring, first repository calls |
| [`reads-and-filters.md`](./reads-and-filters.md) | `find*`, `count`, `exists`, scalar filters, logical operators |
| [`crud.md`](./crud.md) | Create, update, delete, batch operations, updateEach, upsert, upsertMany |
| [`relations.md`](./relations.md) | `select`, `include`, relation filters, payload shaping |
| [`pagination.md`](./pagination.md) | Offset `paginate()` plus cursor-based `cursor()` metadata |
| [`transactions.md`](./transactions.md) | Nested transactions, retries, rollback, callbacks |
| [`raw-sql.md`](./raw-sql.md) | Safe and unsafe raw SQL, row mapping, options |
| [`hooks.md`](./hooks.md) | Client hooks across reads, writes, raw SQL, and transactions |
| [`throwing-results.md`](./throwing-results.md) | `.throw()` helpers for nullable operations |

## Suggested order

1. `getting-started.md`
2. `reads-and-filters.md`
3. `crud.md`
4. `relations.md`
5. `transactions.md`
6. `hooks.md`

## Mental model

The core client is still a Drizzle client at heart.
`better-drizzle` adds a consistent delegate layer, typed query inputs, plugin support, and a few workflow helpers without trying to become a second ORM.
