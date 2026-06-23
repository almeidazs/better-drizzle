<p align="center">
  <img src="./assets/logo.png" alt="better-drizzle" width="520" />
</p>

<br/>

<h3 align="center">Drizzle ORM, but better 🚀</h3>

<div align="center">

Minimal, type-safe repository helpers for [Drizzle ORM](https://orm.drizzle.team).

[better-drizzle](https://npmjs.com/package/better-drizzle) wraps an existing Drizzle client and gives each table a small, consistent API for reads, writes, pagination, nested filters, relation loading, and optional hooks. The goal is simple: keep Drizzle's type-safety, remove repetitive query glue, and stay close enough to the metal that performance still matters.

</div>

```bash
npm install better-drizzle drizzle-orm
```

<div align="center">

## Why

Drizzle is excellent when you want explicit SQL-first control.

It gets repetitive when every service ends up re-writing the same patterns:

</div>

- point lookups
- relation includes
- pagination payloads
- existence checks
- count helpers
- CRUD return shapes
- nested `where` filters

<div align="center">

[better-drizzle](https://npmjs.com/package/better-drizzle) packages those patterns into a small repository-style API without trying to replace Drizzle itself.

## What it improves

</div>

- Less repeated query code for common CRUD flows
- Nested relation filters with Drizzle-backed typing
- `include` and `select` support with typed payload inference
- Unified pagination return shape
- Optional lifecycle hooks for cross-cutting behavior
- First-class plugins with setup, transforms, and client/model extensions
- Fast paths for simple reads and writes to reduce wrapper overhead
- Consistent table delegates: `findMany`, `findFirst`, `create`, `update`, `delete`, `paginate`, `count`, `exists`, `upsert`

<h2 align="center">Querying your database with Better client</h2>

```ts
import { better } from 'better-drizzle';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const db = drizzle(sqlite, { schema });

const client = better(db, { schema });

const user = await client.users.findFirst({
	where: { id: 1 },
});

const posts = await client.posts.findMany({
	where: {
		published: true,
		author: {
			is: {
				active: true,
			},
		},
	},
	include: {
		author: true,
	},
	orderBy: [{ id: 'desc' }],
	take: 20,
});
```

<div align="center">

**Check whether a user exists or not and count after it.**

</div>

```ts
const exists = await client.users.exists({
	where: { id: 123 },
});

const count = await client.users.count({
	where: {
		name: { contains: 'drizzle-orm' },
	},
});
```

<div align="center">

**Create and update the user.**

</div>

```ts
const someUser = await client.users.create({
	data: {
		id: 123,
		name: 'better',
	},
});

const user = await client.users.update({
	data: {
		name: 'better-drizzle',
	},
	where: { id: someUser.id },
});
```

<div align="center">

**You can also resolve repositories dynamically.**

</div>

```ts
const users = client.repository('users');
```

<div align="center">

The repository name can be the TypeScript schema key or the database table name.

## Plugins

Plugins let you package setup logic, query transforms, and reusable client/model extensions without wrapping `better(...)` yourself.

```ts
import { better } from 'better-drizzle';
import { timestamps } from '@better-drizzle/timestamps';
import { softDelete } from '@better-drizzle/soft-delete';

const client = better(drizzle, {
	schema,
	plugins: [
		timestamps({
			createdAt: 'createdAt',
			updatedAt: 'updatedAt',
			mode: 'app',
		}),
		softDelete(),
	],
});
```

Now you can soft delete rows easily and also have timestamps fields injected automatically.

</div>

```ts
import { better } from 'better-drizzle';
```

<div align="center">

## Hooks

The client accepts optional hooks through `better(db, options)`. This is useful for auditing, tracing, metrics, authorization, and other cross-cutting concerns that you do not want duplicated in every repository call.

The hook layer is optional. If you do not need it, do not pass it.

**Always assign a random UUID in the user before creating it.**

</div>

```ts
const client = better(drizzle, {
	schema,
	hooks: {
		beforeCreate({ data: user }) {
			user.organizationId = randomUUID();
		},
	},
});
```

<div align="center">

## Performance

This library is not trying to beat raw Drizzle at being raw Drizzle.

It is trying to stay close while giving you a higher-level API.

Current benchmarks in [`benchmark/`](/benchmark) are split into two views:

</div>

- `api parity`: raw Drizzle does the same work and returns the same shape as `better-drizzle`
- `manual drizzle reference`: lower-level Drizzle queries that intentionally do less work

<div align="center">

That distinction matters. Comparing a repository helper that returns nested typed payloads against a flat hand-written join is not a fair comparison.

### Latency (time benchmark)

Ran on AMD Ryzen 5 7520U, Bun 1.3.14, SQLite in-memory.

</div>

| Operation | Drizzle | better-drizzle | Overhead |
| --- | --- | --- | --- |
| Point lookup | 139.87 µs | 134.49 µs | -3.8% |
| Filtered list | 291.55 µs | 397.33 µs | +36.3% |
| Active count | 110.28 µs | 122.49 µs | +11.1% |
| Exists | 155.76 µs | 168.25 µs | +8.0% |
| Offset pagination | 263.44 µs | 281.97 µs | +7.0% |
| Cursor pagination | 300.32 µs | 344.69 µs | +14.8% |
| Complex relation filter | 1.30 ms | 1.30 ms | +0.0% |
| Update + reload | 159.39 µs | 167.36 µs | +5.0% |

<div align="center">

### Memory (memory benchmark)

Same hardware. 2000 read iterations, 600 mixed read iterations, 1200 write iterations.

</div>

| Batch | Drizzle | better-drizzle | Overhead |
| --- | --- | --- | --- |
| **Single Read** | 184.7 µs/op, 2.08 MB heap | 139.9 µs/op, 300 KB heap | -24.3% time, -85.9% heap |
| **Mixed Read** | 2.39 ms/op, 844 KB heap | 2.32 ms/op, 387 KB heap | -3.2% time, -54.1% heap |
| **Write** | 226.5 µs/op, 361 KB heap | 216.5 µs/op, 94 KB heap | -4.4% time, -74.1% heap |

<div align="center">

### Interpretation

- Reads are within **0–15%** of raw Drizzle at the API-parity level. The wrapper adds minimal overhead for the convenience of a consistent repository interface.
- Writes are **within 5%** of raw Drizzle for update roundtrips and **14% faster** for create+delete roundtrips due to optimized returning paths.
- Memory overhead is **negative across the board** — better-drizzle uses less heap and RSS than raw Drizzle in the measured workloads, thanks to fewer intermediate allocations in the query compilation and execution paths.
- The `manual drizzle reference` group shows that raw hand-written joins are faster (as expected), but they return flat shapes and skip relation resolution. The parity group is the fair comparison.

<div align="center">

Run benchmarks yourself:

</div>

```bash
bun run bench          # latency
bun run bench:memory   # memory overhead
bun run bench:all      # both
```
