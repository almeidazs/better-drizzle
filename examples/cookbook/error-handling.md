# Error handling

`better-drizzle` keeps nullability and exceptional flow separate on purpose.

## Pattern 1: nullable result at the service boundary

```ts
const user = await client.users.findUnique({
	where: {
		email: 'alice@example.com',
	},
});

if (!user) {
	return null;
}

return user;
```

## Pattern 2: throw inside the service

```ts
import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

const user = await client.users.findUnique({
	where: {
		email: 'alice@example.com',
	},
}).throw(
	() =>
		new BetterDrizzleError({
			code: BetterDrizzleErrorCode.ResultNotFound,
			message: 'User not found',
			status: 404,
		}),
);
```

## Pattern 3: map errors at the HTTP boundary

```ts
import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

app.get('/users/:id', async (req, res) => {
	try {
		const user = await client.users.findOne({
			where: { id: Number(req.params.id) },
		}).throw(
			() =>
				new BetterDrizzleError({
					code: BetterDrizzleErrorCode.ResultNotFound,
					message: 'Not found',
					status: 404,
				}),
		);

		res.json(user);
	} catch (error) {
		res.status(404).json({ error: String(error) });
	}
});
```

## Transaction failure pattern

```ts
await client.transaction(async (tx) => {
	const exists = await tx.users.exists({
		where: { email: 'alice@example.com' },
	});

	if (exists) tx.rollback('duplicate email');

	await tx.users.create({
		data: {
			email: 'alice@example.com',
			name: 'Alice',
			active: true,
		},
	});
});
```

## Rule of thumb

- keep validation close to request parsing
- keep not-found mapping close to the boundary that understands HTTP or RPC semantics
- use `.throw()` when that makes service code materially clearer
