# Relations, `select`, and `include`

This is where `better-drizzle` becomes noticeably nicer than repeating the same query glue everywhere.

## Base schema idea

The examples below assume a `users -> posts -> comments` style schema with Drizzle relations already defined.

## `include`: keep the base row, add relations

```ts
const posts = await client.posts.findMany({
	include: {
		author: true,
	},
	orderBy: [{ id: 'desc' }],
	take: 10,
});
```

`include` is usually the right choice when the controller wants the model plus related records.

## `select`: shape the response aggressively

```ts
const posts = await client.posts.findMany({
	select: {
		id: true,
		title: true,
		author: {
			select: {
				id: true,
				name: true,
			},
		},
	},
	where: {
		published: true,
	},
	orderBy: [{ id: 'desc' }],
});
```

`select` is the better fit when:

- you want to reduce payload size
- the response is going straight to an API boundary
- you do not want to accidentally leak extra columns

## Nested relation filters

### Filter posts by author data

```ts
const posts = await client.posts.findMany({
	where: {
		author: {
			is: {
				active: true,
			},
		},
	},
	include: {
		author: true,
	},
});
```

### Filter users by their posts

```ts
const users = await client.users.findMany({
	where: {
		posts: {
			some: {
				published: true,
			},
		},
	},
});
```

### “every” and “none” on to-many relations

```ts
const users = await client.users.findMany({
	where: {
		posts: {
			none: {
				published: false,
			},
		},
	},
});
```

## Combining relation filters with scalar filters

```ts
const posts = await client.posts.findMany({
	where: {
		AND: [
			{ published: true },
			{
				author: {
					is: {
						email: { endsWith: '@company.com' },
					},
				},
			},
		],
	},
	select: {
		id: true,
		title: true,
		author: {
			select: {
				id: true,
				email: true,
			},
		},
	},
});
```

## Rule of thumb

- Use `where` to control which rows qualify.
- Use `select` to control which fields survive.
- Use `include` to keep the full row and attach relations.
