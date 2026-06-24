# Express + Postgres

Express is a good fit when your app already has middleware, route modules, and a conventional Node HTTP stack.

## Client module

```ts
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { better } from 'better-drizzle';
import { schema } from './schema';

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool, { schema });

export const client = better(db, { schema });
```

## Route handlers

```ts
import express from 'express';
import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';
import { client } from './client';

const app = express();

app.get('/users/:id', async (req, res) => {
	const id = Number(req.params.id);

	const user = await client.users.findUnique({
		include: {
			posts: true,
		},
		meta: {
			requestId: req.header('x-request-id'),
		},
		where: { id },
	});

	if (!user) {
		res.status(404).json({ error: 'User not found' });
		return;
	}

	res.json(user);
});
```

## Transaction example

```ts
import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

app.post('/users/:id/publish-post', async (req, res) => {
	const userId = Number(req.params.id);

	const post = await client.transaction(async (tx) => {
		const user = await tx.users.findUnique({
			where: { id: userId },
		}).throw(
			() =>
				new BetterDrizzleError({
					code: BetterDrizzleErrorCode.ResultNotFound,
					message: 'User not found',
					status: 404,
				}),
		);

		return tx.posts.create({
			data: {
				authorId: user.id,
				id: Date.now(),
				published: true,
				title: 'Published from route',
			},
		});
	});

	res.json(post);
});
```

## Pattern to keep

Instantiate the Drizzle and Better clients once, then import the shared client into route and service modules.
