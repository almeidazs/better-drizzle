import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';

test('one relation sorts preserve a target scalar column named _count', async () => {
	const authors = sqliteTable('count_authors', {
		_count: integer('count_value').notNull(),
		id: integer('id').primaryKey(),
	});
	const posts = sqliteTable('count_posts', {
		authorId: integer('author_id').notNull(),
		id: integer('id').primaryKey(),
	});
	const relations = defineRelations({ authors, posts }, (r) => ({
		authors: { posts: r.many.posts() },
		posts: {
			author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }),
		},
	}));
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec(`
CREATE TABLE count_authors (id INTEGER PRIMARY KEY, count_value INTEGER NOT NULL);
CREATE TABLE count_posts (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL);
INSERT INTO count_authors VALUES (1, 20), (2, 10);
INSERT INTO count_posts VALUES (1, 1), (2, 2), (3, 2);
`);
		const db = better(drizzle({ client: sqlite, relations }));
		expect(
			(
				await db.posts.findMany({
					orderBy: [{ author: { _count: 'asc' } }, { id: 'asc' }],
				})
			).map((post) => post.id),
		).toEqual([2, 3, 1]);
		expect(
			(
				await db.authors.findMany({
					orderBy: [{ posts: { _count: 'desc' } }, { id: 'asc' }],
				})
			).map((author) => author.id),
		).toEqual([2, 1]);
	} finally {
		sqlite.close();
	}
});
