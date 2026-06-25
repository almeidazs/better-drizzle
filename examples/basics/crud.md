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

## Practical notes

- `createMany()`, `updateMany()`, and `deleteMany()` return a batch summary.
- `create()` returns `null` and `createMany()` returns a partial count when `skipDuplicates` is enabled and duplicates are skipped.
- `update()` and `delete()` are nullable by default because the target row may not exist.
- `upsert()` is often cleaner than “find, then branch, then write” when the behavior is truly upsert-shaped.
