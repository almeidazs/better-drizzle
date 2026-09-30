<p align="center">
  <img src="https://raw.githubusercontent.com/almeidazs/better-drizzle/main/assets/logo.png" alt="better-drizzle" width="520" />
</p>

<br/>

<h3 align="center">Drizzle ORM, but better 🚀</h3>

<p align="center">
  <a href="https://npmjs.com/package/better-drizzle"><img src="https://img.shields.io/npm/v/better-drizzle?color=c5f74f&label=npm" alt="npm version" /></a>
  <a href="https://npmjs.com/package/better-drizzle"><img src="https://img.shields.io/badge/dependencies-0-c5f74f" alt="zero dependencies" /></a>
  <a href="https://github.com/almeidazs/better-drizzle/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/better-drizzle?color=c5f74f" alt="license" /></a>
</p>

<div align="center">

Type-safe repository helpers for [Drizzle ORM](https://orm.drizzle.team).

Keep Drizzle's type-safety. Drop the query glue you rewrite in every service.

## Sponsors

<p align="center">
  <a href="https://neon.com">
    <img src="https://neon.com/brand/neon-logomark-dark-color.svg" width="48" alt="Neon" />
  </a>
</p>

<p align="center">
  <strong>Sponsored by <a href="https://neon.com">Neon</a></strong>
</p>

<p align="center">
  Neon is the serverless Postgres platform built for modern developer workflows.
</p>

</div>

## The whole idea

```ts
const client = better(drizzle({ client: pool, relations }));

const users = await client.users.findMany({
	where: { posts: { some: { published: true } } },
	include: {
		posts: { where: { published: true }, take: 3 },
		_count: { select: { posts: true } },
	},
});
```

A nested relation filter, three posts **per user**, and a relation count - typed end to end from your Drizzle schema and `defineRelations(...)` config. One query per relation node, never one per row.

No codegen. No client process. No new schema language. It is still your Drizzle client underneath, and you can drop back to it at any line.

```bash
npm install better-drizzle drizzle-orm@^1.0.0-rc.4
```

> [!IMPORTANT]
> better-drizzle supports **only Drizzle ORM 1.x** (`drizzle-orm@^1.0.0-rc.4`, including the 1.0 release candidates) and its `defineRelations(...)` API. **`drizzle-orm` 0.x is not supported** - projects on 0.x must stay on better-drizzle `0.2.x`. Install `drizzle-orm` with the explicit range: until Drizzle 1.0 is tagged `latest`, a plain install resolves to 0.x. See [upgrading](https://better-drizzle.com/docs/guides/upgrading#moving-to-drizzle-orm-1x).

## Setup

Tables live in your schema, relations are declared with Drizzle's `defineRelations`, and the Drizzle instance receives them. `better()` reads tables and relations from that instance.

```ts
// schema.ts
import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	id: integer().primaryKey(),
	email: text().notNull(),
});

export const posts = pgTable('posts', {
	id: integer().primaryKey(),
	userId: integer('user_id').notNull().references(() => users.id),
	title: text().notNull(),
});

// relations.ts
import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';

export const relations = defineRelations(schema, (r) => ({
	users: { posts: r.many.posts() },
	posts: { author: r.one.users({ from: r.posts.userId, to: r.users.id }) },
}));

// db.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { better } from 'better-drizzle';
import { relations } from './relations';

export const client = better(drizzle({ connection: process.env.DATABASE_URL!, relations }));
```

With no relations, pass `defineRelations(schema)` without a callback.

## What you stop writing

| | Raw Drizzle | better-drizzle |
| --- | --- | --- |
| Point lookups | `db.select().from().where(eq(...))` + unwrap | `findUnique({ where: { email } })` |
| Relation loading | manual joins, or `db.query` config | `include` / `select`, payload inferred |
| Nested relation filters | hand-built `exists` subqueries | `some` / `every` / `none` / `is` |
| Pagination | rebuild metadata and cursors every time | `paginate()` / `cursor()` → `{ data, pagination }` |
| Not-found handling | check for `undefined` everywhere | nullable result **or** `.throw()` |
| Cross-cutting concerns | sprinkled through call sites | hooks and plugins |
| Timestamps / soft delete | repeated in every write | official plugins |

## Relations you write, not assemble

Describe the link. It resolves the rows and runs the writes in one transaction.

```ts
await client.posts.create({
	data: {
		title: 'Hello',
		author: { connect: { email: 'alice@example.com' } },
	},
});
```

`connect`, `disconnect`, and `set` work on create, update, and both branches of `upsert`.

Many-to-many is declared once in `defineRelations` with `.through()`, and after that you never name the junction in a query:

```ts
// relations.ts
users: {
	groups: r.many.groups({
		from: r.users.id.through(r.memberships.userId),
		to: r.groups.id.through(r.memberships.groupId),
	}),
},
```

```ts
const users = await client.users.findMany({
	include: { groups: true },
});
```

## Pagination that returns its own metadata

```ts
const page = await client.users.paginate({
	limit: 20,
	skip: 40,
	orderBy: [{ id: 'asc' }],
	where: { active: true },
});
```

`page.pagination` carries `total`, `pageCount`, `hasNext`, and `hasPrevious`. Use `cursor()` instead for feed-style navigation and you get `nextCursor` and `previousCursor` computed for you.

`orderBy` accepts a field map or an array. Specify `{ direction, nulls }` when NULL placement matters: `orderBy: { lastSeenAt: { direction: 'desc', nulls: 'last' } }`.

## Not-found, handled honestly

Operations that can legitimately match nothing say so in the type - and let you opt into throwing when it is genuinely exceptional.

```ts
const user = await client.users.findUnique({ where: { id } });
//    ^? User | null

const user = await client.users.findUnique({ where: { id } }).throw();
//    ^? User
```

## JSONB that the compiler understands

Declare the shape with Drizzle's `$type<T>()` and every scalar leaf becomes a typed dot path. PostgreSQL.

```ts
const referrals = await client.accounts.findMany({
	where: {
		settings: { json: { referrer: { endsWith: '@acme.com' } } },
	},
});
```

Paths and values are bound parameters, and the generated predicate is guarded by `jsonb_typeof`, so one row with the wrong type cannot break the cast.

The same dot paths work for partial updates through `jsonb_set`, leaving the rest of the document untouched:

```ts
await client.accounts.update({
	where: { id },
	data: { settings: { 'plan.tier': 'pro' } },
});
```

On typed JSONB columns, dotted paths and the `{ json: ... }` wrapper both check paths and values against `$type<T>()`; use the wrapper for single-level keys. Path updates create missing object ancestors, treat SQL `NULL` and non-object JSONB roots as `{}`, and preserve existing object ancestors and unrelated keys. A scalar, array, or JSON `null` at an intermediate path is replaced with `{}`. Duplicate or ancestor/descendant paths are rejected, as are values containing nested `undefined`. Untyped JSONB columns keep open path names and JSON-encodable values.

## Row locks with guardrails

```ts
const users = await client.users.findMany({
	where: { active: true },
	lock: {
		mode: 'update',
		skipLocked: true,
	},
});
```

PostgreSQL and MySQL. SQLite fails fast instead of silently dropping the lock, and `locks: { transactionsOnly: true }` enforces that locked reads only run inside a transaction.

## Transactions

The callback receives a full client bound to the transaction, so delegates, plugins, hooks, and nested savepoints all keep working.

```ts
await client.transaction(async (tx) => {
	const user = await tx.users.create({
		data: { name: 'Alice', email: 'alice@example.com' },
	});

	tx.afterCommit(() => sendWelcomeEmail(user.email));
});
```

Also available: automatic retries on deadlock and serialization failures, `afterRollback`, and isolation levels where the dialect supports them.

## Plugins

Package setup, transforms, and typed extensions once, instead of wrapping `better(...)` yourself.

```ts
import { recommended, rules } from 'better-drizzle/rules';
import { softDelete } from 'better-drizzle/soft-delete';
import { timestamps } from 'better-drizzle/timestamps';
import { zod } from 'better-drizzle/zod';

const client = better(db, {
	plugins: [rules(recommended()), timestamps(), softDelete(), zod()],
});
```

That gets you runtime guardrails, automatic timestamps, soft deletes with `restore()`, and Zod schemas generated from your tables at `client.users.$zod`. Plugins can add their own typed operation args, so `client.users.findMany({ deleted: 'only' })` type-checks.

Pair `better-drizzle/eslint` with the runtime rules to catch the statically-checkable subset in your editor.

`better-drizzle/cache` caches the reads you opt into, and `better-drizzle/cache/redis` stores them in the Redis client you already have. Observed writes invalidate declared dependencies after they commit, including included relations and declared foreign-key cascades. Commit and invalidation are separate operations; concurrent reads and store failures can leave stale results cached, so use database reads when consistency must be exact. No Redis key is ever scanned. Raw Drizzle writes still need a manual `$cache.invalidate()`.

```ts
import { cache } from 'better-drizzle/cache';
import { redis } from 'better-drizzle/cache/redis';

const client = better(db, {
	plugins: [cache({ store: redis({ client: redisClient }), ttl: '5m' })],
});

const user = await client.users.findUnique({ where: { id }, cache: true });
```

## Performance

Measured against raw Drizzle doing the same work and returning the same shape - not against a lower-level query that does less.

- **9.1× faster relation loading** (10.24 ms → 1.12 ms), and the gap widens with the number of parent rows
- every other read within **~9%**, writes within **~5%**
- **zero runtime dependencies**

Relation loading wins because the batched loader issues one query per relation node instead of the per-row work the equivalent hand-written code ends up doing. Numbers are SQLite in-memory to isolate wrapper overhead from I/O; reproduce them with `bun run bench:report`.

Full tables, methodology, and the cases where the wrapper costs you: [benchmarks](https://better-drizzle.com/docs/performance/benchmarks).

## There is more

[`.explain()`](https://better-drizzle.com/docs/querying/explain) on any read without running it · [`updateEach`](https://better-drizzle.com/docs/writing/crud) for per-row batch updates in one statement · [`upsertMany`](https://better-drizzle.com/docs/writing/crud) · [`$withContext`](https://better-drizzle.com/docs/guides/multi-tenancy) for request-scoped metadata · [`extends()`](https://better-drizzle.com/docs/guides/client-extensions) for your own helpers · [raw SQL](https://better-drizzle.com/docs/advanced/raw-sql) with its own hooks · [lifecycle hooks](https://better-drizzle.com/docs/advanced/hooks) for auditing and tracing.

## AI agents

better-drizzle ships a first-party [skill pack](https://github.com/almeidazs/better-drizzle/tree/main/skills/better-drizzle) - `SKILL.md` plus task references - for coding agents that need accurate API guidance and review guardrails. Zero scripts, zero network. See the [AI docs](https://better-drizzle.com/docs/ai).

## Docs

[Getting started](https://better-drizzle.com/docs/getting-started) · [Querying](https://better-drizzle.com/docs/querying/reads) · [Writing](https://better-drizzle.com/docs/writing/crud) · [Plugins](https://better-drizzle.com/docs/plugins/overview) · [Why better-drizzle?](https://better-drizzle.com/docs/why) · [Limitations](https://better-drizzle.com/docs/guides/limitations)

## Contributors

<a href="https://github.com/almeidazs/better-drizzle/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=almeidazs/better-drizzle" alt="contributors" />
</a>

## License

[Apache-2.0](https://github.com/almeidazs/better-drizzle/blob/main/LICENSE)
