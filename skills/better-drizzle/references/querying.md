# Querying

Read this file for read helpers, filters, relation loading, pagination, explain plans, row locks, and raw SQL.

Public docs:

- `https://better-drizzle.com/docs/querying/reads`
- `https://better-drizzle.com/docs/querying/filters`
- `https://better-drizzle.com/docs/querying/relations`
- `https://better-drizzle.com/docs/querying/pagination`
- `https://better-drizzle.com/docs/querying/explain`
- `https://better-drizzle.com/docs/advanced/raw-sql`
- `https://better-drizzle.com/docs/advanced/locks`

## Read helpers

The main read entry points are:

- `findMany`
- `findFirst`
- `findOne`
- `findUnique`
- `count`
- `exists`
- `paginate`
- `cursor`

These read helpers return explainable thenables with `.explain(options?)`.

## Query behavior

- `paginate()` is offset-based only.
- `cursor()` is the cursor-based API.
- `count()` and `exists()` honor cursor filters when provided.
- Locking is supported on `QueryArgs`-based reads, not on `count`, `exists`, or write operations.
- Locked reads with relation loading are intentionally rejected rather than silently degraded.

## Example patterns

**Simple point lookup**

```ts
const user = await client.users.findFirst({
	where: { id: 1 },
});
```

**Nested relation filter with include**

```ts
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

**Explain without executing the normal read path twice**

```ts
const plan = await client.users
	.findMany({
		where: { active: true },
		orderBy: [{ id: 'asc' }],
	})
	.explain({
		analyze: true,
		comment: 'users.active.explain',
	});
```

**Offset pagination**

```ts
const page = await client.users.paginate({
	where: { active: true },
	page: 2,
	perPage: 25,
	orderBy: [{ id: 'asc' }],
});
```

**Cursor pagination**

```ts
const page = await client.users.cursor({
	take: 20,
	after: { id: 42 },
	orderBy: [{ id: 'asc' }],
});
```

## Raw SQL

- Safe raw calls use tagged templates or Drizzle `sql` objects.
- Plain strings are only allowed through `$rawUnsafe`.
- `$rawUnsafe` is gated by `raw.allowUnsafe`.
- Raw execution bypasses model transforms and CRUD hooks, but uses dedicated raw hooks.

**Safe raw example**

```ts
const rows = await client.$raw<{ id: number; name: string }[]>`
	select id, name
	from users
	where active = ${true}
`;
```

**Locked read example**

```ts
const jobs = await client.transaction(async (tx) => {
	return tx.jobs.findMany({
		where: { status: 'pending' },
		lock: {
			mode: 'update',
			skipLocked: true,
		},
		take: 10,
	});
});
```

## Anti-patterns

- using `before` and `after` together in one cursor query
- claiming `count()` accepts row locks
- showing lock examples on SQLite as if they are supported
- silently replacing locked relation reads with unlocked reads
- routing plain string SQL through `$raw` instead of `$rawUnsafe`

## Agent checks

Before suggesting a query:

- verify the method exists on the real delegate surface
- do not mix cursor and offset semantics
- do not suggest locks on SQLite as supported behavior
- do not suggest relation `include` for lock-based reads
- do not route plain strings through safe raw APIs
