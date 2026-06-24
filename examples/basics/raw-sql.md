# Raw SQL

The raw API is deliberately explicit:

- `$raw` for safe reads
- `$executeRaw` for safe write statements
- `$rawUnsafe` only when unsafe raw SQL is explicitly enabled

## Imports

```ts
import { sql } from 'drizzle-orm';
```

## `$raw` with a tagged template

```ts
const rows = await client.$raw<{ id: number; email: string }>`
	select id, email
	from users
	where active = ${true}
	order by id asc
`;
```

## `$raw` with a Drizzle `sql` object

```ts
const rows = await client.$raw<{ id: number; email: string }>(
	sql`select id, email from users where email like ${'%@example.com'}`,
);
```

## `$executeRaw`

```ts
const result = await client.$executeRaw`
	update users
	set active = ${false}
	where id = ${1}
`;

console.log(result.rowsAffected);
```

## Row mapping

```ts
const rows = await client.$raw(
	sql`select id, email from users order by id asc`,
	{
		map(row: { id: number; email: string }) {
			return {
				id: row.id,
				email: row.email.toLowerCase(),
			};
		},
		name: 'users.list.raw',
		comment: 'raw.users.list',
		timeoutMs: 5000,
	},
);
```

## Enabling `$rawUnsafe`

`$rawUnsafe` is blocked by default.

```ts
const unsafeClient = better(db, {
	schema,
	raw: {
		allowUnsafe: true,
	},
});

const rows = await unsafeClient.$rawUnsafe<{ id: number }>(
	'select id from users where email = ?',
	['alice@example.com'],
);
```

## Require comments on raw calls

```ts
const strictRawClient = better(db, {
	schema,
	raw: {
		requireComment: true,
		timeoutMs: 3000,
		unsupportedOptions: 'warn',
	},
});
```

## Raw SQL inside a transaction

```ts
await client.transaction(async (tx) => {
	await tx.$executeRaw`
		update users
		set active = ${true}
		where id = ${2}
	`;

	const rows = await tx.$raw<{ id: number }>`
		select id from users where active = ${true} order by id asc
	`;

	console.log(rows);
});
```

## When raw is a good fit

- database-specific SQL functions
- reporting queries that read better as SQL
- one-off statements that the delegate API should not try to model

## When the delegate API is a better fit

- routine CRUD
- relation loading
- typed filters and pagination
- code paths that would otherwise duplicate projection and payload shaping
