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
const client = better(db, { schema });

const users = await client.users.findMany({
	where: { posts: { some: { published: true } } },
	include: {
		posts: { where: { published: true }, take: 3 },
		_count: { select: { posts: true } },
	},
});
```

A nested relation filter, three posts **per user**, and a relation count - typed end to end from your Drizzle schema. One query per relation node, never one per row.

No codegen. No client process. No new schema language. It is still your Drizzle client underneath, and you can drop back to it at any line.

```bash
npm install better-drizzle drizzle-orm
```

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

Many-to-many through a simple junction table is inferred, so you never name the junction:

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
	schema,
	plugins: [rules(recommended()), timestamps(), softDelete(), zod()],
});
```

That gets you runtime guardrails, automatic timestamps, soft deletes with `restore()`, and Zod schemas generated from your tables at `client.users.$zod`. Plugins can add their own typed operation args, so `client.users.findMany({ deleted: 'only' })` type-checks.

Pair `better-drizzle/eslint` with the runtime rules to catch the statically-checkable subset in your editor.

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
