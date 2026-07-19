# Pagination

`paginate()` is the offset-based helper. `cursor()` is the cursor-based helper.

## Offset pagination

Offset pages return totals and page metadata:

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
console.log(page.pagination.type); // "offset"
console.log(page.pagination.page);
console.log(page.pagination.perPage);
console.log(page.pagination.total);
console.log(page.pagination.pageCount);
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

Cursor pages return navigation cursors instead of totals:

```ts
const first = await client.users.cursor({
	limit: 2,
	orderBy: [{ id: 'asc' }],
});

const second = await client.users.cursor({
	after: first.pagination.nextCursor as { id: number },
	limit: 2,
	orderBy: [{ id: 'asc' }],
});
```

## Backwards navigation

Pass `before` to move backwards. Only one of `before` or `after` is allowed.

```ts
const previous = await client.users.cursor({
	before: { id: 4 },
	limit: 2,
	orderBy: [{ id: 'asc' }],
});
```

## Pagination with projection

Both helpers accept normal read projections:

```ts
const page = await client.posts.paginate({
	limit: 10,
	orderBy: [{ id: 'desc' }],
	include: {
		author: true,
	},
});

const feed = await client.posts.cursor({
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
- Make sure the cursor field is still selected when using custom `select`.
