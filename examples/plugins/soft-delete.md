# Soft delete plugin

The soft-delete plugin turns `delete()` into a recoverable state transition for compatible models.

## Install

```bash
npm install @better-drizzle/soft-delete
```

## Setup

```ts
import { better } from 'better-drizzle';
import { softDelete } from '@better-drizzle/soft-delete';

const client = better(db, {
	schema,
	plugins: [
		softDelete({
			column: 'deletedAt',
			deletedByColumn: 'deletedById',
			defaults: {
				mode: 'soft',
				visibility: 'without',
			},
		}),
	],
});
```

## What it changes

- `delete()` writes the deleted timestamp instead of removing the row
- `findMany()`, `findFirst()`, `count()`, and `exists()` filter deleted rows by default
- models that have the configured delete column gain `restore()` and `restoreById()`
- delete mode and visibility become typed operation args

## Default read behavior

```ts
const visibleUsers = await client.users.findMany();
```

The default visibility is usually “without deleted rows”.

## Read deleted rows explicitly

```ts
const deletedUsers = await client.users.findMany({
	deleted: 'only',
});

const allUsers = await client.users.findMany({
	deleted: 'with',
});
```

## Soft delete and restore

```ts
await client.users.delete({
	where: { id: 1 },
	deletedBy: 'admin_42',
});

await client.users.restore({
	where: { id: 1 },
});

await client.users.restoreById(1);
```

## Force hard delete

```ts
await client.users.delete({
	where: { id: 1 },
	mode: 'hard',
});
```

## Where this plugin fits best

- audit-sensitive systems
- admin tools where deleted rows must remain inspectable
- applications where “delete” should default to reversible behavior
