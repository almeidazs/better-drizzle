# Troubleshooting

Docs: `/docs/guides/troubleshooting`, `/docs/reference/errors`, `/docs/guides/limitations`, `/docs/reference/support-matrix`, `/docs/guides/upgrading` (all under `https://better-drizzle.com`).

## Errors

Library errors are `BetterDrizzleError` with `code`, HTTP-like `status`, and metadata (`table`, `column`, `constraint`, `operation`, `details`, `cause`).

```ts
import { BetterDrizzleError, BetterDrizzleErrorCode, isUniqueViolation } from 'better-drizzle';

try {
	await client.users.create({ data });
} catch (error) {
	if (isUniqueViolation(error, 'users_email_key')) return conflict();
	if (BetterDrizzleError.is(error) && error.code === BetterDrizzleErrorCode.ResultNotFound) return notFound();
	throw error;
}
```

- Driver errors arrive as Drizzle 1.x `DrizzleQueryError` ("Failed query: ...") with the driver error on `cause`. `isUniqueViolation`, `isForeignKeyViolation`, `isNotNullViolation`, `isCheckViolation`, and `getDatabaseErrorInfo` unwrap it, including when a transaction or hook wraps it again in `BetterDrizzleError`. Do not read `error.code` directly.

| Code | Meaning / fix |
| --- | --- |
| `RESULT_NOT_FOUND` (404) | `.throw()` found no row |
| `TRANSACTION_ROLLBACK` (409) | `tx.rollback()` was called |
| `LOCK_NOT_SUPPORTED` | lock on SQLite, `count`/`exists`, or with relation loading |
| `LOCK_REQUIRES_TRANSACTION` | `locks.transactionsOnly` and no transaction |
| `JSONB_QUERY_UNSUPPORTED` / `JSONB_MUTATION_UNSUPPORTED` | JSONB path filter or mutation outside PostgreSQL |
| `ARRAY_QUERY_UNSUPPORTED` / `ARRAY_MUTATION_UNSUPPORTED` | array operator outside PostgreSQL |
| `RAW_DISABLED` / `RAW_UNSAFE_DISABLED` / `RAW_COMMENT_REQUIRED` | `raw` options gate the call |
| `REPOSITORY_NOT_FOUND` | `repository(name)` matched no table key or table name |
| `AFTER_COMMIT_OUTSIDE_TRANSACTION` | `afterCommit` called on the root client |
| `PLUGIN_*` | plugin config invalid at `better()` time |
| `OPERATION_ERROR` (500) | invalid input or a wrapped failure; read `message` and `cause` |

## Messages and fixes

- `No tables found on the Drizzle instance`: pass `relations` to `drizzle({ client, relations })`.
- A relation is missing from `include`/`where` types: it is not declared in `defineRelations`, or the table is not in the config.
- `Relation "x" on "t" cannot be loaded/filtered`: relation-level `where` or `one` through a junction. Declare a plain relation and filter in `include: { x: { where } }`, or use Drizzle's `db.query`.
- `select and include cannot be used at the same query level`: pick one per level.
- `JSON path filters require a jsonb column`: the column is `json`, not `jsonb`.
- Wrong or empty results from dotted keys on SQLite/MySQL: shorthand paths are PostgreSQL `jsonb` only.
- A test hangs or `expect(read).rejects` fails: reads are lazy thenables, so use `expect(Promise.resolve(read))`.
- Type instantiation is excessively deep: very large schemas or deep nested literals. Split the query, or annotate with exported types (`WhereArg`, `PayloadForArgs`).

## Not supported (use raw Drizzle or `$raw`)

Aggregates beyond `count` and `_count`, `groupBy`, `distinct`, ordering by expressions or relation columns, nested `create`/`connectOrCreate`, relation includes in `upsertMany`/`updateEach`, and locks combined with general relation loading.

## Upgrading from drizzle-orm 0.x (better-drizzle 0.2 to 0.3)

1. `drizzle-orm@^1.0.0-rc.4` and `better-drizzle@^0.3.0`.
2. Replace per-table `relations(table, ...)` with one `defineRelations(schema, (r) => ...)`. `fields/references` become `from/to`, and `relationName` becomes `alias`.
3. `drizzle({ client, relations })`, then `better(db, options)` without `schema`.
4. `typeof schema` becomes `typeof relations` in every exported type.
5. Remove `relations: { manyToMany, inferManyToMany }` and declare `.through()` relations instead.
6. Custom plugins: `ctx.schema` is the relations config, `dataType` is `"<type> <constraint>"`, and PG arrays expose `dimensions` instead of a `PgArray` class.
7. Behavior changes: reads are lazy, unknown keys are compile errors, timestamps write ISO strings to text columns, and an `afterCommit` failure no longer triggers rollback.
