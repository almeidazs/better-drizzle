// Type-level assertions; checked by `bunx tsc --noEmit`, never executed.
import type { Database } from 'bun:sqlite';

import { better } from 'better-drizzle';
import { timestamps } from 'better-drizzle/timestamps';
import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const posts = sqliteTable('type_timestamp_posts', {
	id: integer().primaryKey(),
	title: text().notNull(),
	createdAt: integer({ mode: 'timestamp' }).notNull(),
	updatedAt: integer({ mode: 'timestamp' }).notNull(),
});
const legacy = sqliteTable('type_timestamp_legacy', {
	id: integer().primaryKey(),
	createdOn: integer({ mode: 'timestamp' }).notNull(),
	updatedOn: integer({ mode: 'timestamp' }).notNull(),
});

declare const sqlite: Database;
const raw = drizzle({
	client: sqlite,
	relations: defineRelations({ legacy, posts }),
});

const app = better(raw, { plugins: [timestamps()] });
app.posts.create({ data: { id: 1, title: 'A' } });
app.posts.createMany({ data: [{ id: 2, title: 'B' }] });
app.posts.upsert({
	create: { id: 3, title: 'C' },
	update: { title: 'Updated' },
	where: { id: 3 },
});
app.posts.upsertMany({
	data: [{ id: 4, title: 'D' }],
	target: 'id',
	update: 'all',
});
// @ts-expect-error Generated timestamps keep their column value type.
app.posts.create({ data: { id: 5, title: 'E', createdAt: 'not a date' } });

const overridden = better(raw, {
	plugins: [
		timestamps({
			models: {
				legacy: { createdAt: 'createdOn', updatedAt: 'updatedOn' },
				posts: false,
			},
		}),
	],
});
overridden.legacy.create({ data: { id: 1 } });
// @ts-expect-error A disabled model still requires its timestamps.
overridden.posts.create({ data: { id: 1, title: 'A' } });

const renamed = better(raw, {
	plugins: [timestamps({ createdAt: 'createdOn', updatedAt: 'updatedOn' })],
});
renamed.legacy.create({ data: { id: 2 } });

const database = better(raw, {
	plugins: [timestamps({ mode: 'database' })],
});
// @ts-expect-error Database mode does not fill the required timestamps.
database.posts.create({ data: { id: 1, title: 'A' } });
