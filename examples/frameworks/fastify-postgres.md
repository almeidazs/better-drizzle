# Fastify + Postgres

Fastify works well when you want structured plugins, shared decorators, and a predictable request lifecycle.

## Shared client module

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

## Fastify plugin

```ts
import fp from 'fastify-plugin';
import { client } from './client';

export default fp(async (app) => {
	app.decorate('db', client);
});
```

## Route usage

```ts
app.get('/posts', async (request) => {
	return app.db.posts.findMany({
		include: {
			author: true,
		},
		orderBy: [{ id: 'desc' }],
		take: 20,
	});
});
```

## Why this pairing is useful

- shared client through Fastify decorators
- strong fit for plugin-oriented server structure
- easy place to centralize hooks, tracing, and transactions
