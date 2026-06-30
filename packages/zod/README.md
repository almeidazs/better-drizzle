<p align="center">
  <img src="https://raw.githubusercontent.com/almeidazs/better-drizzle/main/assets/logo.png" alt="better-drizzle" width="520" />
</p>

<br/>

<h3 align="center">@better-drizzle/zod</h3>

<div align="center">

Zod schema generation and runtime validation for [better-drizzle](https://npmjs.com/package/better-drizzle).

</div>

```bash
npm install better-drizzle @better-drizzle/zod drizzle-orm zod
```

```ts
import { better } from 'better-drizzle';
import { z } from 'zod';
import { zod as betterZod } from '@better-drizzle/zod';

const db = better(raw, {
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

```ts
db.users.$zod.create;
db.users.$zod.update;
db.users.$zod.upsert;
db.users.$zod.select;
db.users.$zod.where;
db.users.$zod.orderBy;
db.users.$zod.pagination;
db.users.$zod.query;
```
