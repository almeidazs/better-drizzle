# Writing

Read this file for create, update, delete, upsert, transaction, metadata, and error-handling tasks.

Public docs:

- `https://better-drizzle.com/docs/writing/crud`
- `https://better-drizzle.com/docs/writing/throwing-results`
- `https://better-drizzle.com/docs/advanced/transactions`
- `https://better-drizzle.com/docs/advanced/error-handling`

## Write helpers

The main write entry points are:

- `create`
- `createMany`
- `update`
- `updateEach`
- `updateMany`
- `delete`
- `deleteMany`
- `upsert`
- `upsertMany`

## Important behavior

- `create` and `createMany` accept `skipDuplicates`.
- `skipDuplicates: true` makes `create` return `null` when the insert is skipped.
- `updateEach` is native-first and uses a single `UPDATE ... CASE ... END` style statement.
- `upsertMany` supports `select` but not relation `include`.
- Unsupported dialect/feature combinations should fail fast rather than degrade to userland loops.

## Example patterns

**Create with duplicate skip**

```ts
const maybeCreated = await client.users.create({
	data: {
		email: 'better@example.com',
		name: 'Better',
	},
	skipDuplicates: true,
});

if (!maybeCreated) {
	console.log('user already existed');
}
```

**Update**

```ts
const updated = await client.users.update({
	where: { id: 1 },
	data: {
		name: 'better-drizzle',
	},
});
```

**Batch upsert**

```ts
const batch = await client.users.upsertMany({
	data: [
		{ email: 'alice@example.com', name: 'Alice', active: true },
		{ email: 'bob@example.com', name: 'Bob', active: false },
	],
	target: ['email'],
	update: ['name', 'active'],
	select: {
		id: true,
		name: true,
	},
});
```

**Scoped metadata**

```ts
const scoped = client.$withContext({
	requestId: 'req_123',
	organizationId: 'org_123',
});

await scoped.users.create({
	data: { name: 'Alice' },
	meta: { userId: 'user_7' },
});
```

## Transactions and metadata

- `db.transaction(callback, options?)` is the official API.
- Transaction clients are full Better Drizzle clients.
- Nested transactions use savepoints.
- Scoped metadata from `$withContext(meta)` is shallow-merged with per-call and transaction metadata.

**Transaction example**

```ts
await client.transaction(async (tx) => {
	const created = await tx.users.create({
		data: {
			email: 'alice@example.com',
			name: 'Alice',
		},
	});

	tx.afterCommit(async () => {
		await sendWelcomeEmail(created.email);
	});

	return created;
});
```

## Error expectations

- Prefer `BetterDrizzleError`.
- Prefer `BetterDrizzleError.from(...)` or `.fromDatabaseError(...)` when normalizing external errors.
- Do not throw ad hoc raw `Error` values for library-defined failure cases.

## Agent checks

- avoid read-then-write flows when native upsert paths exist
- do not suggest relation selects for `updateEach`
- do not claim `upsertMany` supports `include`
- keep transaction examples bound to the transaction-scoped client

## Anti-patterns

- returning generic ORM pseudocode instead of real delegate calls
- using `db.query.*` examples when the user asked for `better-drizzle` delegates
- showing `upsertMany` with relation `include`
- writing transaction examples that accidentally keep using the root client inside the callback
