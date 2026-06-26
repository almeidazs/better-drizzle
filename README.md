<p align="center">
  <img src="./assets/logo.png" alt="better-drizzle" width="520" />
</p>

<br/>

<h3 align="center">Drizzle ORM, but better 🚀</h3>

<div align="center">

Minimal, type-safe repository helpers for [Drizzle ORM](https://orm.drizzle.team).

[better-drizzle](https://npmjs.com/package/better-drizzle) wraps an existing Drizzle client and gives each table a small, consistent API for reads, writes, pagination, nested filters, relation loading, and optional hooks. The goal is simple: keep Drizzle's type-safety, remove repetitive query glue, and stay close enough to the metal that performance still matters.

Website: https://better-drizzle.vercel.app/

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
- Consistent table delegates: `findMany`, `findFirst`, `create`, `update`, `delete`, `paginate`, `count`, `exists`, `upsert`, `upsertMany`

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

const maybeCreated = await client.users.create({
	data: {
		email: 'better@example.com',
		id: 124,
		name: 'better-again',
	},
	skipDuplicates: true,
});

if (!maybeCreated) {
	console.log('user already existed');
}

const batch = await client.users.upsertMany({
	data: [
		{ id: 123, name: 'better', email: 'better@example.com', active: true },
		{ id: 124, name: 'batch', email: 'batch@example.com', active: false },
	],
	target: 'email',
	update: ['name', 'active'],
	select: {
		id: true,
		name: true,
	},
});
```

<div align="center">

**You can where queries like drizzle too**

</div>

```ts
const { count } = await client.users.delete({
	where: eq(users.id, 123),
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

## Transactions

Transactions live on the client, not on individual models. The callback receives a full Better Drizzle client bound to the underlying transaction, so model delegates, plugin args, transforms, hooks, and nested transactions all keep working.

</div>

```ts
const user = await client.transaction(async (tx) => {
	const created = await tx.users.create({
		data: {
			email: 'better@example.com',
			id: 123,
			name: 'better',
		},
	});

	tx.afterCommit(async () => {
		await sendWelcomeEmail(created.email);
	});

	return created;
});
```

<div align="center">

## Plugins

Plugins let you package setup logic, query transforms, and reusable client/model extensions without wrapping `better(...)` yourself.

Plugins can also extend the built-in operation args in a fully typed way through `operationArgs`, so custom fields like `deleted` or `mode` flow from the delegate call into plugin transforms and hooks.

</div>

```ts
import { better } from 'better-drizzle';
import { timestamps } from '@better-drizzle/timestamps';
import { softDelete } from '@better-drizzle/soft-delete';

const client = better(drizzle, {
	schema,
	plugins: [
		timestamps({
			createdAt: 'created_at',
			updatedAt: 'updated_at',
		}),
		softDelete({
			column: 'deletedAt',
			deletedByColumn: 'deletedById',
			defaults: {
				mode: 'soft',
				visibility: 'without',
			},
		}),
	],
});

await client.users.delete({
	where: { id: 1 },
});

await client.users.findMany({
	deleted: 'only',
});

await client.users.restore({
	where: { id: 1 },
});
```

<div align="center">

Now you can soft delete rows easily and also have timestamps fields injected automatically.

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

See the full benchmark suite and results in [`benchmark/README.md`](/benchmark). The suite covers reads, writes, and transactions (including nested savepoints) with fair API-parity comparisons against raw Drizzle.

</div>
