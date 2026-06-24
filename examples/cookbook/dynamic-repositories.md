# Dynamic repositories

When the table name is only known at runtime, `repository(name)` keeps the call site clean.

## Basic usage

```ts
const repo = client.repository('users');

const users = await repo.findMany({
	where: {
		active: true,
	},
});
```

## Why it exists

It is useful when:

- a generic admin endpoint serves multiple resources
- a helper receives the model name dynamically
- you want to resolve by TypeScript schema key or by database table name

## Example helper

```ts
async function listByRepository(
	name: 'users' | 'posts',
	query: { take?: number },
) {
	const repo = client.repository(name);

	return repo.findMany({
		take: query.take ?? 20,
	});
}
```

## Rule of thumb

Prefer direct property access when the table is known statically.
Use `repository()` when dynamic dispatch is the actual requirement.
