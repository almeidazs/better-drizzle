# Next.js + Postgres

The main rule for Next.js is simple:
keep client construction in a server-only module and reuse it from route handlers or server actions.

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

## Route handler

```ts
import { client } from './client';

export async function GET() {
	const posts = await client.posts.findMany({
		include: {
			author: true,
		},
		orderBy: [{ id: 'desc' }],
		take: 10,
	});

	return Response.json(posts);
}
```

## Server action

```ts
'use server';

import { client } from './client';

export async function createUser(input: {
	email: string;
	name: string;
}) {
	return client.users.create({
		data: {
			email: input.email,
			name: input.name,
			active: true,
		},
	});
}
```

## Transaction in an action

```ts
'use server';

import { client } from './client';

export async function createUserAndPost(input: {
	email: string;
	name: string;
	title: string;
}) {
	return client.transaction(async (tx) => {
		const user = await tx.users.create({
			data: {
				email: input.email,
				name: input.name,
				active: true,
			},
		});

		return tx.posts.create({
			data: {
				authorId: user.id,
				title: input.title,
				published: false,
			},
		});
	});
}
```
