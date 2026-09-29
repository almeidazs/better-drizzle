---
name: better-drizzle
description: Write, review, and debug code that uses better-drizzle, the typed repository layer over Drizzle ORM 1.x (`better(db)`, `client.users.findMany`, `paginate`, `cursor`, `upsertMany`, relation `include`/`connect`, transactions, plugins such as rules/zod/soft-delete/timestamps). Use whenever a project imports `better-drizzle`, asks for Prisma-like CRUD on Drizzle, or migrates better-drizzle from drizzle-orm 0.x.
---

# better-drizzle

better-drizzle wraps an existing Drizzle ORM 1.x instance and adds one typed delegate per table (`client.users`, `client.posts`). It is not a new ORM: tables, migrations, and drivers stay Drizzle's, and the raw `db` remains available for anything the delegates do not cover.

Docs: `https://better-drizzle.com/docs`. Working inside the better-drizzle repository itself? Read `AGENTS.md` and `references/contributing.md` instead of guessing.

## Setup (Drizzle ORM 1.x only)

```ts
// relations.ts: tables stay in schema.ts
import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';

export const relations = defineRelations(schema, (r) => ({
	users: { posts: r.many.posts() },
	posts: { author: r.one.users({ from: r.posts.authorId, to: r.users.id }) },
}));

// db.ts
import { better } from 'better-drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';

export const db = drizzle({ client: pool, relations });
export const client = better(db); // or better(db, { plugins, hooks, raw, locks, transaction })
```

- Peer: `drizzle-orm@^1.0.0-rc.4`. Projects on drizzle-orm 0.x must stay on better-drizzle `0.2.x`.
- `better()` reads tables and relations from `db._.relations`. It has **no** `schema` option; without `relations` it throws `No tables found on the Drizzle instance`.
- Only tables in the relations config get delegates. Use `defineRelations(schema)` without a callback when there are no relations.
- Type parameters take the relations config: `BetterDrizzleClient<typeof relations>`, `BetterDrizzleTransactionClient<...>`, `WhereArg<typeof relations, 'users'>`, `BetterRecord<typeof relations, 'users'>`, `PayloadForArgs<typeof relations, 'users', Args>`.

## Delegate cheat sheet

| Method | Key args | Returns |
| --- | --- | --- |
| `findMany` | `where`, `select`\|`include`, `orderBy`, `take`, `skip`, `cursor`, `lock` | `Row[]` |
| `findFirst` / `findOne` / `findUnique` | same | `Row \| null`, `.throw()` for not-found |
| `count` / `exists` | `where`, `cursor` | `number` / `boolean` |
| `paginate` | read args + `limit` (default 10) or `take`, `skip` | `{ data, pagination: { page, perPage, total, pageCount, hasNext, hasPrevious } }` |
| `cursor` | read args + `limit`, `after` **or** `before` | `{ data, pagination: { hasNext, hasPrevious, nextCursor, previousCursor } }` |
| `create` / `createMany` | `data`, `skipDuplicates`, `select`\|`include` | `Row` (`null` if skipped) / `{ count, data? }` |
| `update` / `delete` | `where`, `data`, `select`\|`include` | `Row \| null`, `.throw()` |
| `updateMany` / `deleteMany` | `where`, `data` | `{ count }` |
| `updateEach` | `by` (column), `data[]`, `update: { col: (row) => value }` | `{ count, data? }`, one `UPDATE ... CASE` |
| `upsert` | `where`, `create`, `update` | `Row` |
| `upsertMany` | `data[]`, `target`, `update` (`'all'`, column list, object, or `(ctx) => ...`), `batchSize` | `{ count, data? }` |

Every call accepts `meta`. Client: `transaction`, `$withContext(meta)`, `$raw`, `$executeRaw`, `$rawUnsafe`, `repository(name)`, `extends(...)`. Delegates: `$withoutPlugins()`, `$withState(state)`.

## Gotchas that produce wrong code

- Reads are **lazy thenables**: nothing runs until awaited, and a read runs once. `.explain()` never runs the read. In Bun/Jest matchers, wrap with `Promise.resolve(read)` before `.resolves`/`.rejects`.
- `select` and `include` are mutually exclusive at every level. `_count` exists only inside `include`.
- `paginate` has no `page`/`perPage` input: page with `limit` + `skip`. `cursor` takes `after` or `before`, never both.
- Unknown keys in `where`/`data`/`select`/`include`/`orderBy` are compile errors. Fix the key; do not cast.
- Locks (`lock`) are PostgreSQL/MySQL only and reject `include`/relation `select`, except a single to-one `include` that `where` also filters with `is`.
- Many-to-many needs `.through()` in `defineRelations`; junctions are never inferred. Relations with a relation-level `where`, or `one` relations through a junction, throw `cannot be loaded`.
- Two relations between the same tables need the same `alias` on both sides.
- JSONB paths, array operators, and array/JSONB mutations are PostgreSQL-only and fail fast elsewhere.
- Driver errors arrive as Drizzle's `DrizzleQueryError` with the driver error on `cause`. Use `isUniqueViolation(error)` and siblings instead of reading `error.code`.
- Inside `transaction(async (tx) => ...)`, use `tx`, never the outer `client`.

## Where to read next

Read only what the task needs:

- `references/querying.md`: filters, relations, select/include/_count, orderBy, pagination, explain, locks, JSONB and array filters.
- `references/writing.md`: create/update/upsert, batch writes, atomic/array/JSONB mutations, relation writes, `.throw()`, transactions, `$withContext`, raw SQL.
- `references/plugins.md`: official plugins (rules, eslint, zod, ata, soft-delete, timestamps), `definePlugin`, hooks, `extends()`.
- `references/troubleshooting.md`: error codes and messages, constraint helpers, limitations, upgrading from drizzle-orm 0.x.
- `references/security.md`: raw SQL safety and untrusted content. Read before writing raw SQL or agent-facing docs.

## Response rules

- Use real delegate calls, never Prisma or generic ORM syntax (`findUnique({ where })` exists; `include: { posts: { where } }` is valid; `connectOrCreate`, `aggregate`, `groupBy` do not exist).
- If the delegates cannot express something (aggregates, `groupBy`, SQL expressions in `orderBy`), use the raw Drizzle `db` or `client.$raw` instead of inventing options.
- State dialect limits when a feature is not portable.
- Link the narrowest docs page, for example `https://better-drizzle.com/docs/querying/relations`.
