# Timestamps plugin

The timestamps plugin handles `createdAt` and `updatedAt` fields in application code.

## Install

```bash
npm install @better-drizzle/timestamps
```

## Basic setup

```ts
import { better } from 'better-drizzle';
import { timestamps } from '@better-drizzle/timestamps';

const client = better(db, {
	schema,
	plugins: [
		timestamps({
			createdAt: 'createdAt',
			updatedAt: 'updatedAt',
			mode: 'app',
		}),
	],
});
```

## What it does

- `create()` sets `createdAt` and `updatedAt` when those columns exist
- `createMany()` applies the same rule row by row
- `update()` and `updateEach()` refresh `updatedAt`
- `upsert()` sets timestamps for the create payload and refreshes `updatedAt` for the update payload
- `upsertMany()` stamps insert rows and keeps `updatedAt` fresh on conflict updates

## Example behavior

```ts
const user = await client.users.create({
	data: {
		email: 'alice@example.com',
		name: 'Alice',
		active: true,
	},
});

console.log(user.createdAt);
console.log(user.updatedAt);
```

## Custom column names

```ts
const client = better(db, {
	schema,
	plugins: [
		timestamps({
			createdAt: 'created_at',
			updatedAt: 'updated_at',
		}),
	],
});
```

## Database-managed mode

If the database already owns timestamps through defaults or triggers:

```ts
timestamps({
	mode: 'database',
});
```

In that mode, the plugin stops modifying payloads and lets the database be the source of truth.
