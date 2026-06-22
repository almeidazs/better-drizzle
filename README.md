<p align="center">
  <img src="./assets/logo.png" alt="better-drizzle" width="720" />
</p>

<br/>

<h3 align="center">Drizzle, but better 🚀</h3>

<div align="center">

# Better Drizzle

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
**Check whether a user exists or not and count after it**
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
**Create and update the user**
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

**You can also resolve repositories dynamically**

</div>

```ts
const users = client.repository('users');
```

<div align="center">

The repository name can be the TypeScript schema key or the database table name.

## Hooks

The client accepts optional hooks through `better(db, options)`. This is useful for auditing, tracing, metrics, authorization, and other cross-cutting concerns that you do not want duplicated in every repository call.

The hook layer is optional. If you do not need it, do not pass it.

## Performance

This library is not trying to beat raw Drizzle at being raw Drizzle.

It is trying to stay close while giving you a higher-level API.

Current benchmarks in [`benchmark/`](/benchmark) are split into two views:

</div>

- `api parity`: raw Drizzle does the same work and returns the same shape as `better-drizzle`
- `manual drizzle reference`: lower-level Drizzle queries that intentionally do less work

<div align="center">

That distinction matters. Comparing a repository helper that returns nested typed payloads against a flat hand-written join is not a fair comparison.

</div>
