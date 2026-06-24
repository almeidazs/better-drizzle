# Throwing results

Some Better Drizzle operations intentionally return a nullable result plus a `.throw()` helper.

This gives you both styles:

- `await result` when you want `T | null`
- `await result.throw()` when not-found is exceptional

## Supported operations

- `findFirst`
- `findOne`
- `findUnique`
- `update`
- `delete`

## `findFirst().throw()`

```ts
const user = await client.users.findFirst({
	where: { id: 1 },
}).throw();
```

## `findUnique().throw()`

```ts
const user = await client.users.findUnique({
	where: { email: 'alice@example.com' },
}).throw();
```

## `update().throw()`

```ts
const updated = await client.users.update({
	data: { name: 'Updated' },
	where: { id: 1 },
}).throw();
```

## `delete().throw()`

```ts
const deleted = await client.users.delete({
	where: { id: 1 },
}).throw();
```

## Custom error factory

```ts
import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

const user = await client.users.findOne({
	where: { id: 9999 },
}).throw(
	() =>
		new BetterDrizzleError({
			code: BetterDrizzleErrorCode.ResultNotFound,
			message: 'User not found',
			status: 404,
		}),
);
```

## Why this is useful

This pattern keeps the low-level API honest about nullability while letting higher-level services opt into exception-driven flow when that is the cleaner fit.
