# Bun + SQLite

This is the lightest full-stack setup and a good fit for local tools, prototypes, and benchmark-adjacent work.

## Client module

```ts
import Database from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { better } from 'better-drizzle';
import { schema } from './schema';

const sqlite = new Database('app.db');
const db = drizzle(sqlite, { schema });

export const client = better(db, { schema });
```

## HTTP usage

```ts
import { client } from './client';

Bun.serve({
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === '/users') {
			const users = await client.users.findMany({
				orderBy: [{ id: 'desc' }],
				take: 20,
			});

			return Response.json(users);
		}

		return new Response('Not found', { status: 404 });
	},
});
```

## Why this stack works well

- the setup is almost entirely schema plus one client module
- SQLite is great for demos, prototypes, and local workflows
- it stays close to the benchmark environment used in this repository
