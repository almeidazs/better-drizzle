# Writing

Docs: `/docs/writing/crud`, `/atomic-updates`, `/relation-writes`, `/throwing-results`, `/docs/advanced/transactions`, `/raw-sql`, `/docs/guides/multi-tenancy` (all under `https://better-drizzle.com`).

## Single-row writes

```ts
const user = await client.users.create({
	data: { email: 'a@example.com', name: 'Ana' },
	select: { id: true, email: true }, // or include; the result type follows
});

const maybe = await client.users.create({ data, skipDuplicates: true }); // null when skipped
await client.users.create({ data, skipDuplicates: ['email'] }); // explicit target (not MySQL)

const updated = await client.users.update({ where: { id: 1 }, data: { name: 'Ana B.' } }); // Row | null
await client.users.delete({ where: { id: 1 } }).throw(); // throws RESULT_NOT_FOUND on no match

await client.users.upsert({
	where: { email: 'a@example.com' },
	create: { email: 'a@example.com', name: 'Ana' },
	update: { name: 'Ana' },
});
```

`.throw()` exists on `findFirst`/`findOne`/`findUnique`/`update`/`delete` results. `.throw(() => new NotFound())` supplies a custom error.

## Batch writes

```ts
const { count } = await client.users.createMany({ data: rows, skipDuplicates: true }); // count = inserted rows
await client.users.updateMany({ where: { active: false }, data: { archived: true } });
await client.users.deleteMany({ where: { archived: true } });

// different value per row, one UPDATE ... CASE statement
await client.users.updateEach({
	by: users.id, // the Drizzle column
	data: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
	update: { name: (row) => row.name },
	onEmpty: 'return', // or 'throw' for empty data
});

// native INSERT ... ON CONFLICT / ON DUPLICATE KEY
await client.users.upsertMany({
	data: rows,
	target: ['email'],
	update: 'all', // or ['name'], { name: 'x' }, or ({ excluded, sql, table }) => ({ name: excluded.name })
	batchSize: 500,
	select: { id: true }, // relation include is not supported here
});
```

- `updateMany`/`deleteMany` without `where` touch every row. The rules plugin can forbid that.
- `data` is returned only when the driver supports `RETURNING` (not MySQL).
- `updateEach` rejects duplicate `by` values and relation selects.

## Atomic updates

Compiled to SQL right before the write, in `update`, `updateMany`, `updateEach`, `upsert`, and `upsertMany`:

```ts
data: {
	views: { increment: 1 }, // also set, decrement, multiply, divide; combined in the order set, increment, decrement, multiply, divide
	featured: { toggle: true },
	tags: { append: ['new'] }, // PG arrays: prepend, remove, replace: [{ from, to }], addUnique
	metadata: { 'profile.city': 'Lisbon' }, // PG jsonb: jsonb_set per dotted path
}
```

- Division by zero and non-finite operands throw before SQL runs.
- Array and JSONB path mutations are PostgreSQL-only (`ARRAY_MUTATION_UNSUPPORTED`, `JSONB_MUTATION_UNSUPPORTED`). Replacing the whole value works everywhere.
- A JSONB value must use all dotted keys (a partial update) or none (full replacement); mixing them throws.

## Relation writes

```ts
await client.posts.create({
	data: { title: 'Hi', author: { connect: { id: 1 } } },
});
await client.users.update({
	where: { id: 1 },
	data: {
		posts: { connect: [{ id: 2 }], disconnect: [{ id: 3 }] },
		groups: { set: [{ id: 1 }, { id: 4 }] }, // many-to-many via .through()
	},
});
await client.posts.update({ where: { id: 9 }, data: { author: { disconnect: true } } });
```

- Selectors must match exactly one row. `set` is exclusive with `connect`/`disconnect`.
- Relation writes run in an implicit transaction. There is no nested `create`/`connectOrCreate`: create the row first, then `connect` it.
- Batch methods (`createMany`, `updateMany`, `updateEach`, `upsertMany`) accept scalars only.

## Transactions

```ts
const order = await client.transaction(
	async (tx) => {
		const created = await tx.orders.create({ data });
		await tx.stock.update({ where: { id: data.itemId }, data: { qty: { decrement: 1 } } });
		if (!ok) tx.rollback('out of stock'); // throws, rejects with TRANSACTION_ROLLBACK
		tx.afterCommit(() => queue.publish(created.id));
		return created;
	},
	{ isolationLevel: 'serializable', timeoutMs: 5000, retries: { attempts: 3, delayMs: 50 } },
);
```

- `tx` is a full client: delegates, `$raw`, nested `tx.transaction(...)` (savepoints), `afterCommit`/`afterRollback`.
- Async callbacks work on every driver, including Bun SQLite.
- Options: `isolationLevel`, `readOnly`, `timeoutMs`, `signal`, `retries` (`on: ['deadlock', 'serializationFailure', 'connectionError']`), `meta`. SQLite ignores `isolationLevel`/`readOnly` with a warning (`better(db, { transaction: { unsupportedOptions: 'throw' } })`).

## Request metadata

```ts
const scoped = client.$withContext({ requestId, tenantId }); // per request
await scoped.users.update({ where: { id }, data, meta: { reason: 'admin' } });
```

`meta` is a shallow merge: scoped values first, then per-call values. It reaches hooks, plugins, raw hooks, and transaction hooks. Type it with `better<typeof relations, AppMeta>(db, ...)`.

## Raw SQL

```ts
const rows = await client.$raw<{ id: number }>`select id from users where active = ${true}`;
const { rowsAffected } = await client.$executeRaw`update users set active = ${false} where id = ${id}`;
await client.$raw(sql`select ...`, { map: (row) => row, comment: 'report', timeoutMs: 5000 });
await client.$rawUnsafe('select * from users where id = ?', [id]); // needs raw: { allowUnsafe: true }
```

- Interpolated values are bound parameters. Never build SQL strings for `$raw`.
- Raw calls skip model transforms and CRUD hooks, but run `beforeRaw`/`afterRaw`/`onRawError`.
- Inside a transaction, use `tx.$raw` so the statement joins it.
