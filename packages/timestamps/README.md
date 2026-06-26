<p align="center">
  <img src="https://raw.githubusercontent.com/almeidazs/better-drizzle/main/assets/logo.png" alt="better-drizzle" width="520" />
</p>

<br/>

<h3 align="center">@better-drizzle/timestamps</h3>

<div align="center">

Automatic `createdAt` / `updatedAt` management for [better-drizzle](https://npmjs.com/package/better-drizzle).

[`@better-drizzle/timestamps`](https://npmjs.com/package/@better-drizzle/timestamps) is a first-class Better Drizzle plugin that keeps timestamp handling out of services and repositories. It can either manage timestamps in application code or stay out of the way when your database already does it with defaults, generated columns, or triggers.

</div>

```bash
npm install better-drizzle @better-drizzle/timestamps drizzle-orm
```

<div align="center">

## Why

Timestamp fields are repetitive and easy to drift:

</div>

- `createdAt` must be set on insert
- `updatedAt` must be refreshed on every update
- batch inserts should behave the same as single inserts
- upserts should stamp both create and update paths consistently
- some projects want app-managed timestamps, others want DB-managed timestamps

<div align="center">

This plugin centralizes that behavior into one reusable place.

## Usage

</div>

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

<div align="center">

All options are optional.

</div>

```ts
timestamps();
```

<div align="center">

Defaults:

</div>

- `createdAt: 'createdAt'`
- `updatedAt: 'updatedAt'`
- `mode: 'app'`

<div align="center">

## Modes

</div>

### `mode: 'app'`

The plugin updates payloads before the database call:

- `create`: sets `createdAt` and `updatedAt`
- `createMany`: sets `createdAt` and `updatedAt` for each row
- `update`: sets `updatedAt`
- `upsert`: sets both fields on the create payload and `updatedAt` on the update payload
- `upsertMany`: stamps insert rows and keeps `updatedAt` fresh on conflict updates

```ts
const client = better(db, {
	schema,
	plugins: [timestamps({ mode: 'app' })],
});
```

### `mode: 'database'`

The plugin becomes a no-op. Use this when your database already handles timestamps:

- column defaults like `DEFAULT now()`
- triggers
- generated values
- `ON UPDATE` behavior

```ts
const client = better(db, {
	schema,
	plugins: [timestamps({ mode: 'database' })],
});
```

<div align="center">

## Custom column names

</div>

```ts
const client = better(db, {
	schema,
	plugins: [
		timestamps({
			createdAt: 'created_on',
			updatedAt: 'updated_on',
		}),
	],
});
```

<div align="center">

## Behavior details

</div>

- Models missing the configured timestamp columns are skipped automatically.
- `mode: 'database'` adds effectively zero runtime behavior beyond plugin initialization.
- The plugin works with single writes, batch writes, and both single/batch upserts.
- The plugin only mutates write payloads. It does not change reads, filters, or result shapes.

<div align="center">

## Example

</div>

```ts
const post = await client.posts.create({
	data: {
		id: 1,
		title: 'Hello',
	},
});

console.log(post.createdAt); // Date
console.log(post.updatedAt); // Date

const updated = await client.posts.update({
	where: { id: 1 },
	data: { title: 'Updated' },
});

console.log(updated.updatedAt); // newer Date
```
