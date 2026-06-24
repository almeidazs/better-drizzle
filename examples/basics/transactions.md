# Transactions

Transactions live on the client, not on individual repositories.

The callback receives a full Better Drizzle transaction client, so the same delegates, plugins, raw methods, and hooks continue to work inside the transaction.

## Basic transaction

```ts
const user = await client.transaction(async (tx) => {
	const created = await tx.users.create({
		data: {
			email: 'new@example.com',
			id: 1,
			name: 'New User',
			active: true,
		},
	});

	await tx.posts.create({
		data: {
			id: 10,
			authorId: created.id,
			title: 'Hello',
			published: true,
		},
	});

	return created;
});
```

## Nested transactions

Nested transactions create savepoints and can be rolled back independently.

```ts
await client.transaction(async (tx) => {
	await tx.users.create({
		data: { id: 1, email: 'a@test.com', name: 'Alice', active: true },
	});

	try {
		await tx.transaction(async (nestedTx) => {
			await nestedTx.users.create({
				data: { id: 2, email: 'b@test.com', name: 'Bob', active: true },
			});

			nestedTx.rollback('nested rollback');
		});
	} catch (error) {
		console.log(error);
	}

	await tx.users.create({
		data: { id: 3, email: 'c@test.com', name: 'Charlie', active: true },
	});
});
```

## Explicit rollback

```ts
await client.transaction(async (tx) => {
	const alreadyExists = await tx.users.exists({
		where: { email: 'alice@example.com' },
	});

	if (alreadyExists) tx.rollback('email already exists');

	await tx.users.create({
		data: {
			email: 'alice@example.com',
			id: 1,
			name: 'Alice',
			active: true,
		},
	});
});
```

## `afterCommit()` and `afterRollback()`

These callbacks are useful when side effects must follow the transaction lifecycle.

```ts
await client.transaction(async (tx) => {
	tx.afterCommit(() => {
		console.log('send email after commit');
	});

	tx.afterRollback(() => {
		console.log('cleanup rollback side effects');
	});

	await tx.users.create({
		data: {
			email: 'lifecycle@example.com',
			id: 1,
			name: 'Lifecycle',
			active: true,
		},
	});
});
```

## Retries

Automatic retries are opt-in.

```ts
await client.transaction(
	async (tx) => {
		await tx.users.create({
			data: {
				email: 'retry@example.com',
				id: 1,
				name: 'Retry User',
				active: true,
			},
		});
	},
	{
		retries: {
			attempts: 3,
			on: ['deadlock', 'serializationFailure'],
			delayMs: (attempt) => attempt * 25,
		},
	},
);
```

## Transaction options

```ts
await client.transaction(
	async (tx) => {
		return tx.users.findMany({
			take: 10,
		});
	},
	{
		comment: 'users.list.transaction',
		context: {
			requestId: 'req_123',
		},
		name: 'users-list',
		readOnly: true,
		timeoutMs: 1000,
	},
);
```

## Practical notes

- SQLite ignores some transaction options and Better Drizzle can warn, throw, or ignore depending on configuration.
- Raw SQL methods still bind to the transaction-scoped client inside `transaction(...)`.
- Plugins and hooks can read `transactionContext` and `isInTransaction`.
