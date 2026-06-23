<p align="center">
  <img src="https://raw.githubusercontent.com/almeidazs/better-drizzle/main/assets/logo.png" alt="better-drizzle" width="520" />
</p>

<br/>

<h3 align="center">@better-drizzle/soft-delete</h3>

<div align="center">

Soft delete behavior for [better-drizzle](https://npmjs.com/package/better-drizzle).

[`@better-drizzle/soft-delete`](https://npmjs.com/package/@better-drizzle/soft-delete) extends Better Drizzle's built-in methods with typed soft delete controls, default visibility filtering, and restore helpers.

</div>

```bash
npm install better-drizzle @better-drizzle/soft-delete drizzle-orm
```

<div align="center">

## Usage

</div>

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

<div align="center">

All options are optional.

</div>

```ts
softDelete();
```

<div align="center">

Defaults:

</div>

- `column: 'deletedAt'`
- `deletedByColumn: 'deletedById'`
- `defaults.mode: 'soft'`
- `defaults.visibility: 'without'`

<div align="center">

## Reads

</div>

By default, read operations exclude soft-deleted rows:

```ts
await client.users.findMany();
await client.users.findFirst();
await client.users.count();
await client.users.exists();
```

You can opt in per query:

```ts
await client.users.findMany({ deleted: 'with' });
await client.users.findMany({ deleted: 'only' });
await client.users.count({ deleted: 'with' });
await client.users.exists({
	deleted: 'only',
	where: { id: 1 },
});
```

<div align="center">

## Deletes and restore

</div>

```ts
await client.users.delete({
	where: { id: 1 },
});

await client.users.delete({
	where: { id: 1 },
	mode: 'hard',
});

await client.users.delete({
	where: { id: 1 },
	deletedBy: userId,
});

await client.users.restore({
	where: { id: 1 },
});

await client.users.restoreById(1);
```

<div align="center">

## Behavior details

</div>

- Models missing the configured soft delete column are ignored automatically.
- `deletedBy` is only written when the configured column exists on the model.
- `restore()` and `restoreById()` bypass plugin transforms so they can always clear the soft delete fields directly.
- `mode: 'hard'` falls back to the built-in physical delete.
