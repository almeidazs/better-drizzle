# Row locks

Row locks let you control concurrent access to rows during reads.
Better Drizzle wraps Drizzle's `FOR UPDATE`, `FOR SHARE`, and related clauses behind a typed `lock` option on every read helper.

Locks are supported on **PostgreSQL** and **MySQL** only.
SQLite does not support row-level locking and will throw if you try.

## Basic locked read

The simplest form is a string shorthand:

```ts
const users = await client.users.findMany({
	where: { active: true },
	lock: 'update',
});
```

This generates `SELECT ... FOR UPDATE`.

## Object form

The full form gives you access to all lock options:

```ts
const users = await client.users.findMany({
	where: { active: true },
	lock: {
		mode: 'update',
		skipLocked: true,
	},
});
```

## Lock modes

| Mode | SQL (PostgreSQL) | SQL (MySQL) |
| --- | --- | --- |
| `'update'` | `FOR UPDATE` | `FOR UPDATE` |
| `'share'` | `FOR SHARE` | `FOR SHARE` |
| `'noKeyUpdate'` | `FOR NO KEY UPDATE` | not supported |
| `'keyShare'` | `FOR KEY SHARE` | not supported |

`noKeyUpdate` and `keyShare` are PostgreSQL-specific.
Using them on MySQL throws `LOCK_NOT_SUPPORTED`.

## `skipLocked` and `noWait`

These control what happens when a locked row is already held by another transaction:

- `skipLocked: true` — skip rows that are locked, return only unlocked rows
- `noWait: true` — fail immediately if any requested row is locked

They are **mutually exclusive**.
Enabling both throws an error.

```ts
// Skip locked rows
const available = await client.jobs.findMany({
	where: { status: 'pending' },
	lock: {
		mode: 'update',
		skipLocked: true,
	},
});
```

```ts
// Fail fast if locked
try {
	const row = await client.jobs.findFirst({
		where: { id: 1 },
		lock: {
			mode: 'update',
			noWait: true,
		},
	});
} catch (error) {
	// LOCK_TIMEOUT — the row was locked by another transaction
}
```

## Lock specific tables (PostgreSQL only)

On PostgreSQL you can scope the lock to specific tables using `tables`.
This is useful in joins where you only want to lock certain tables:

```ts
const posts = await client.posts.findMany({
	where: { published: true },
	include: { author: true },
	lock: {
		mode: 'update',
		tables: ['posts'],
	},
});
```

`tables` accepts both TypeScript table keys and database table names.
Duplicate table references (by database name) are deduplicated automatically.

<Callout type="warn">
	`tables` is only supported on PostgreSQL. Using it on MySQL or SQLite throws
	`LOCK_NOT_SUPPORTED`.
</Callout>

## Locked reads on all read helpers

Locks work on every read helper that accepts `QueryArgs`:

```ts
// findFirst
const user = await client.users.findFirst({
	where: { role: 'admin' },
	lock: 'share',
});

// findOne
const user = await client.users.findOne({
	where: { id: 1 },
	lock: 'update',
});

// findUnique
const user = await client.users.findUnique({
	where: { email: 'admin@example.com' },
	lock: 'update',
});

// paginate
const page = await client.users.paginate({
	where: { active: true },
	lock: {
		mode: 'share',
		skipLocked: true,
	},
	limit: 25,
});

// cursor
const cursor = await client.users.cursor({
	where: { active: true },
	lock: 'update',
	limit: 25,
});
```

`count`, `exists`, and all write operations (`create`, `update`, `delete`, `upsert`, etc.) do **not** accept `lock`.

## Enforcing transaction-only locks

Row locks outside a transaction hold until the end of the connection's implicit transaction.
This can cause contention.
You can enforce that locks only run inside explicit transactions:

```ts
const client = better(db, {
	schema,
	locks: {
		transactionsOnly: true,
	},
});
```

With this config, any `lock` outside `client.transaction(...)` throws `LOCK_REQUIRES_TRANSACTION`:

```ts
// This throws
const users = await client.users.findMany({
	lock: 'update',
});

// This works
await client.transaction(async (tx) => {
	return tx.users.findMany({
		lock: 'update',
	});
});
```

## Locked reads inside transactions

The most common pattern is combining locks with transactions for atomic read-then-write:

```ts
await client.transaction(async (tx) => {
	const job = await tx.jobs.findFirst({
		where: { status: 'pending' },
		lock: {
			mode: 'update',
			noWait: true,
		},
	});

	if (!job) return null;

	await tx.jobs.update({
		where: { id: job.id },
		data: { status: 'processing' },
	});

	return job;
});
```

## Cursor pagination with locks

Locks propagate to cursor pagination, including the internal `hasPrevious`/`hasNext` probe queries:

```ts
const page = await client.users.cursor({
	where: { active: true },
	lock: {
		mode: 'update',
		skipLocked: true,
	},
	limit: 25,
	after: previousCursor,
});
```

## Single-relation includes with locks

Locks work with a single `One` relation include on the fast path:

```ts
const posts = await client.posts.findMany({
	where: { published: true },
	include: { author: true },
	lock: 'update',
});
```

General relation loading (multiple `include` fields or relation `select`) is **intentionally rejected** when `lock` is present.
This avoids silently dropping the lock on the relation query:

```ts
// This throws LOCK_NOT_SUPPORTED
const posts = await client.posts.findMany({
	include: { author: true, tags: true },
	lock: 'update',
});
```

## Error handling

Lock acquisition failures are normalized to `BetterDrizzleError` with code `LOCK_TIMEOUT`:

```ts
import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

try {
	await client.transaction(async (tx) => {
		return tx.users.findMany({
			where: { id: 1 },
			lock: {
				mode: 'update',
				noWait: true,
			},
		});
	});
} catch (error) {
	if (error instanceof BetterDrizzleError && error.code === BetterDrizzleErrorCode.LockTimeout) {
		console.log('Row is locked by another transaction');
	}
}
```

## Dialect summary

| Feature | PostgreSQL | MySQL | SQLite |
| --- | --- | --- | --- |
| `lock: 'update'` | Yes | Yes | rejected |
| `lock: 'share'` | Yes | Yes | rejected |
| `lock: 'noKeyUpdate'` | Yes | rejected | rejected |
| `lock: 'keyShare'` | Yes | rejected | rejected |
| `skipLocked` | Yes | Yes | N/A |
| `noWait` | Yes | Yes | N/A |
| `tables` | Yes | rejected | N/A |
| `transactionsOnly` | Yes | Yes | N/A |

## Practical notes

- Always handle `LOCK_TIMEOUT` errors when using `noWait`.
- Prefer `skipLocked` for work-queue patterns where you want to process whatever is available.
- Prefer `noWait` for strict operations where you need a specific row or nothing.
- `transactionsOnly` is a good safety net for teams that frequently forget to wrap locked reads.
- Locks on `paginate` and `cursor` propagate to internal navigation probes, so you do not need to manage them separately.
