# Choosing between `where`, `select`, and `include`

These options solve different problems.

## `where` filters rows

```ts
await client.posts.findMany({
	where: {
		published: true,
	},
});
```

## `select` narrows the payload

```ts
await client.posts.findMany({
	select: {
		id: true,
		title: true,
	},
});
```

## `include` keeps the row and adds relations

```ts
await client.posts.findMany({
	include: {
		author: true,
	},
});
```

## Choosing well

| Goal | Best tool |
| --- | --- |
| “Only rows that match these conditions” | `where` |
| “Only these scalar fields and nested relation fields” | `select` |
| “Give me the full row plus its relations” | `include` |

## Practical advice

At API boundaries, prefer explicit shapes.
That usually means using `select` or a narrow `include` instead of returning large default payloads by accident.
