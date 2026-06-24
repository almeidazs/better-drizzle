# Reads and filters

This page covers the read-side API in one place:

- `findMany`
- `findFirst`
- `findOne`
- `findUnique`
- `count`
- `exists`
- scalar filters
- logical operators
- using raw Drizzle SQL inside `where`

## `findMany`

```ts
const users = await client.users.findMany({
	orderBy: [{ id: 'asc' }],
	take: 25,
	where: {
		active: true,
	},
});
```

## `findFirst`

`findFirst()` is the ergonomic choice when the query can match many rows but you only want the first row after ordering and filtering.

```ts
const user = await client.users.findFirst({
	orderBy: [{ id: 'desc' }],
	where: {
		active: true,
	},
});
```

## `findOne`

Use `findOne()` when your service code expects a single nullable row and the calling code owns the not-found behavior.

```ts
const user = await client.users.findOne({
	where: {
		id: 42,
	},
});
```

## `findUnique`

`findUnique()` reads well when the query is driven by a unique field such as `email`.

```ts
const user = await client.users.findUnique({
	where: {
		email: 'alice@example.com',
	},
});
```

## `count` and `exists`

```ts
const activeCount = await client.users.count({
	where: {
		active: true,
	},
});

const exists = await client.users.exists({
	where: {
		email: 'alice@example.com',
	},
});
```

## Common scalar filters

### String filters

```ts
const users = await client.users.findMany({
	where: {
		name: {
			contains: 'ali',
			mode: 'insensitive',
		},
		email: {
			endsWith: '@example.com',
		},
	},
});
```

### Numeric and date-style filters

```ts
const users = await client.users.findMany({
	where: {
		id: {
			gte: 100,
			lte: 200,
		},
	},
});
```

### Boolean filters

```ts
const users = await client.users.findMany({
	where: {
		active: {
			equals: true,
		},
	},
});
```

## Logical operators

```ts
const users = await client.users.findMany({
	where: {
		AND: [
			{ active: true },
			{
				OR: [
					{ email: { endsWith: '@company.com' } },
					{ name: { startsWith: 'Admin' } },
				],
			},
		],
	},
});
```

## Raw Drizzle SQL inside `where`

If you need a Drizzle SQL fragment, you can still pass it as `where`.

```ts
import { eq } from 'drizzle-orm';
import { users } from './schema';

const user = await client.users.findFirst({
	where: eq(users.id, 1),
});
```

## Choosing between the read methods

| Method | Typical use |
| --- | --- |
| `findMany` | Lists, feeds, admin tables, relation loading |
| `findFirst` | “Give me the first matching row after ordering/filtering” |
| `findOne` | A single nullable row where the calling code owns not-found behavior |
| `findUnique` | A single row looked up through a unique field like email or slug |
| `count` | Aggregate count for filtered sets |
| `exists` | Cheap existence checks without materializing rows |
