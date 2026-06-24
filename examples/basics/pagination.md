# Pagination

`paginate()` wraps query execution and metadata in a single API.

Every paginated result has this shape:

```ts
type PaginationResult<T> = {
	data: T[];
	pagination: {
		count: number;
		hasNext: boolean;
		hasPrevious: boolean;
	};
};
```

## Offset pagination

```ts
const page = await client.users.paginate({
	limit: 20,
	orderBy: [{ id: 'asc' }],
	skip: 40,
	where: {
		active: true,
	},
});

console.log(page.data);
console.log(page.pagination.count);
console.log(page.pagination.hasNext);
console.log(page.pagination.hasPrevious);
```

## `take` also works

```ts
const page = await client.users.paginate({
	take: 10,
	orderBy: [{ id: 'asc' }],
});
```

## Cursor pagination

```ts
import { PaginationType } from 'better-drizzle';

const first = await client.users.paginate({
	limit: 2,
	orderBy: [{ id: 'asc' }],
	type: PaginationType.Cursor,
});

const second = await client.users.paginate({
	after: { id: first.data[first.data.length - 1]?.id },
	limit: 2,
	orderBy: [{ id: 'asc' }],
	type: PaginationType.Cursor,
});
```

## Backwards navigation

```ts
const last = await client.users.paginate({
	limit: 2,
	orderBy: [{ id: 'desc' }],
	type: PaginationType.Cursor,
});

const previous = await client.users.paginate({
	before: { id: last.data[last.data.length - 1]?.id },
	limit: 2,
	orderBy: [{ id: 'desc' }],
	type: PaginationType.Cursor,
});
```

## Pagination with projection

```ts
const page = await client.posts.paginate({
	limit: 10,
	orderBy: [{ id: 'desc' }],
	include: {
		author: true,
	},
});
```

## Choosing offset vs cursor

| Strategy | Good for | Tradeoff |
| --- | --- | --- |
| Offset | admin tables, reporting, simple list UIs | easier to read, weaker for very large changing datasets |
| Cursor | feeds, timelines, large mutable datasets | needs stable ordering and cursor discipline |

## Practical advice

- Always use a stable `orderBy` when cursor pagination is involved.
- If the consumer needs `count`, `hasNext`, and `hasPrevious`, `paginate()` is usually cleaner than rebuilding that shape manually in every service.
