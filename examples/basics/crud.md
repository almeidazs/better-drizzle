# CRUD and mutations

This page covers the write surface with the patterns that usually matter in application code.

## `create`

```ts
const user = await client.users.create({
	data: {
		email: 'alice@example.com',
		id: 1,
		name: 'Alice',
		active: true,
	},
});
```

## `create` with `skipDuplicates`

Use `skipDuplicates: true` or `skipDuplicates: ['columnName']` when the service should skip duplicate inserts without branching first.

```ts
const maybeUser = await client.users.create({
	data: {
		email: 'alice@example.com',
		id: 2,
		name: 'Alice Duplicate',
		active: true,
	},
	skipDuplicates: ['email'],
});

if (!maybeUser) {
	console.log('duplicate ignored');
}
```

## `createMany`

```ts
const batch = await client.users.createMany({
	data: [
		{ email: 'a@example.com', id: 2, name: 'A', active: true },
		{ email: 'b@example.com', id: 3, name: 'B', active: false },
	],
});

console.log(batch.count);
console.log(batch.data);
```

With `skipDuplicates`, `count` reflects only rows that were actually inserted and `data` contains only those inserted rows.

## `update`

`update()` returns a throwing result helper. You can treat it as `Promise<Row | null>` or call `.throw()`.

```ts
import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

const updated = await client.users.update({
	data: {
		name: 'Alice Updated',
	},
	where: {
		id: 1,
	},
});

if (!updated) {
	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.ResultNotFound,
		message: 'Update target not found',
		status: 404,
	});
}
```

## `updateMany`

```ts
const batch = await client.users.updateMany({
	data: {
		active: false,
	},
	where: {
		active: true,
	},
});

console.log(batch.count);
```

## `updateEach`

`updateEach()` updates many rows with different values in one statement by generating a `CASE` expression per updated column.

```ts
const batch = await client.users.updateEach({
	by: users.id,
	data: [
		{ id: 1, city: 'New York', name: 'Alice' },
		{ id: 2, city: 'Chicago', name: 'Bob' },
	],
	update: {
		city: (row) => row.city,
		name: (row) => row.name,
	},
	select: {
		id: true,
		name: true,
		city: true,
	},
});

console.log(batch.count);
console.log(batch.data);
```

`by` must be a column from the target table. `select` is supported for scalar columns, but relation `include` is intentionally not part of this path.

## `delete`

```ts
const deleted = await client.users.delete({
	where: {
		id: 1,
	},
});
```

## `deleteMany`

```ts
const batch = await client.users.deleteMany({
	where: {
		active: false,
	},
});
```

## `upsert`

`upsert()` is useful when your service wants “create if missing, update if present” without branching in userland.

```ts
const user = await client.users.upsert({
	where: {
		email: 'alice@example.com',
	},
	create: {
		email: 'alice@example.com',
		id: 1,
		name: 'Alice',
		active: true,
	},
	update: {
		name: 'Alice Renamed',
	},
});
```

## `upsertMany`

`upsertMany()` is the batch version for native conflict-update writes. It is designed for high-throughput paths where one statement should do the work of many `upsert()` calls.

```ts
const batch = await client.users.upsertMany({
	data: [
		{
			id: 1,
			email: 'alice@example.com',
			name: 'Alice Updated',
			active: true,
		},
		{
			id: 9,
			email: 'new@example.com',
			name: 'New User',
			active: false,
		},
	],
	target: 'email',
	update: ['name', 'active'],
	select: {
		id: true,
		name: true,
	},
});

console.log(batch.count);
console.log(batch.data);
```

`target` defines the conflict columns. `update` can be `'all'`, a column list, a partial object, or a callback that builds SQL-aware updates from `excluded`, `table`, and Drizzle `sql`.

## Add `select` or `include` to writes too

The returned payload can still be narrowed or expanded.

```ts
const user = await client.users.create({
	data: {
		email: 'writer@example.com',
		id: 10,
		name: 'Writer',
		active: true,
	},
	select: {
		id: true,
		email: true,
	},
});
```

## Connect, disconnect, or replace relations

Relation commands live inside `data` and use structured selectors:

```ts
const post = await client.posts.create({
	data: {
		author: { connect: { email: 'writer@example.com' } },
		title: 'Connected post',
	},
});

await client.users.update({
	where: { id: 10 },
	data: {
		posts: {
			connect: [{ id: 20 }, { id: 21 }],
			disconnect: { id: 19 },
		},
		groups: {
			set: [{ id: 1 }, { id: 2 }],
		},
	},
});
```

`set` is exclusive for its relation. Every selector must match exactly one row. Better Drizzle wraps the root write and relation changes in an implicit transaction, so invalid selectors and required-FK disconnects roll everything back.

## Practical notes

- `createMany()`, `updateMany()`, `updateEach()`, and `deleteMany()` return a batch summary.
- `create()` returns `null` and `createMany()` returns a partial count when `skipDuplicates` is enabled and duplicates are skipped.
- `updateEach()` rejects duplicate `by` values and supports `onEmpty: 'return' | 'throw'`.
- `upsertMany()` is native-first and optimized for throughput. It supports `select`, but not relation `include`.
- Relation commands are supported by `create()`, `update()`, and `upsert()`; batch write methods remain scalar-only.
- `update()` and `delete()` are nullable by default because the target row may not exist.
- `upsert()` is often cleaner than “find, then branch, then write” when the behavior is truly upsert-shaped.
