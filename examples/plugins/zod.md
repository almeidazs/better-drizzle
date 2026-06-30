# Zod plugin

The Zod plugin generates per-table Zod schemas from your Better Drizzle schema and uses them for runtime validation.

## Install

```bash
npm install @better-drizzle/zod zod
```

## Usage

```ts
import { better } from 'better-drizzle';
import { z } from 'zod';
import { zod as betterZod } from '@better-drizzle/zod';

const client = better(db, {
	schema,
	plugins: [
		betterZod({
			validate: {
				create: true,
				update: true,
				upsert: true,
				result: true,
			},
			behavior: {
				coerce: true,
				unknownKeys: 'strip',
			},
			schemas: {
				users: {
					fields: {
						email: (schema) => schema.email().toLowerCase(),
						name: (schema) => schema.min(2),
						passwordHash: false,
					},
					create: {
						omit: ['id', 'passwordHash'],
						extend: {
							password: z.string().min(8),
						},
					},
					update: {
						omit: ['id', 'passwordHash'],
						partial: true,
					},
					select: {
						omit: ['passwordHash'],
					},
				},
			},
		}),
	],
});
```

## Generated schemas

Each delegate exposes:

```ts
client.users.$zod.create;
client.users.$zod.update;
client.users.$zod.upsert;
client.users.$zod.select;
client.users.$zod.where;
client.users.$zod.orderBy;
client.users.$zod.pagination;
client.users.$zod.query;
```

That makes it easy to share one schema source between repository calls and request validation:

```ts
const input = client.users.$zod.create.parse(req.body);

await client.users.create({
	data: input,
});
```

## Validation controls

The plugin validates create, update, upsert, query args, and result shapes when enabled.

Disable it per call when needed:

```ts
await client.users.update({
	where: { id: 1 },
	data: req.body,
	validate: false,
});
```

## Good fit when

- you want one schema source for both API edges and repository calls
- you want runtime validation without hand-writing per-table Zod objects
- you need operation-specific schemas like `where`, `orderBy`, or `pagination`
