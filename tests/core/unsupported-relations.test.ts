import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';

const users = sqliteTable('unsupported_users', {
	id: integer('id').primaryKey(),
});
const posts = sqliteTable('unsupported_posts', {
	id: integer('id').primaryKey(),
	userId: integer('user_id'),
});
const relations = defineRelations({ posts, users }, (r) => ({
	users: {
		publishedPosts: r.many.posts({
			from: r.users.id,
			to: r.posts.userId,
			where: { id: { gt: 0 } },
		}),
	},
}));

test('filtered relations fail instead of being ignored', async () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(
		'create table unsupported_users (id integer primary key); create table unsupported_posts (id integer primary key, user_id integer);',
	);
	const db = better(drizzle({ client: sqlite, relations }));

	await expect(
		Promise.resolve(
			db.users.findMany({ where: { publishedPosts: { some: {} } } }),
		),
	).rejects.toThrow('cannot be filtered');
	await expect(
		Promise.resolve(
			db.users.findMany({ include: { publishedPosts: true } }),
		),
	).rejects.toThrow('cannot be loaded');
	await expect(
		Promise.resolve(
			db.users.findMany({
				orderBy: { publishedPosts: { _count: 'asc' } },
			}),
		),
	).rejects.toThrow('cannot be sorted');
	sqlite.close();
});
