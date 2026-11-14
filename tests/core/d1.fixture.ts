import { Database } from 'bun:sqlite';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';

export const authors = sqliteTable('d1_authors', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

export const posts = sqliteTable('d1_posts', {
	authorId: integer('author_id').references(() => authors.id),
	id: integer('id').primaryKey(),
	title: text('title').notNull(),
});

export const items = sqliteTable('d1_items', {
	a: text('a').notNull(),
	b: text('b').notNull(),
	c: text('c').notNull(),
	d: text('d').notNull(),
	id: integer('id').primaryKey(),
	touched: text('touched').$onUpdate(() => 'touched'),
});

export const regions = sqliteTable('d1_regions', {
	a: text('a').notNull(),
	b: text('b').notNull(),
	id: integer('id').primaryKey(),
	region: text('region').notNull(),
});

export const relations = defineRelations(
	{ authors, items, posts, regions },
	(r) => ({
		authors: {
			posts: r.many.posts(),
		},
		posts: {
			author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }),
		},
	}),
);

const MAX_PARAMS = 100;

const TRANSACTION_SQL = /^\s*(begin|commit|rollback|savepoint|release)\b/i;

/** The error Cloudflare D1 returns for `BEGIN` and `SAVEPOINT`. */
export const D1_TRANSACTION_ERROR =
	'D1_ERROR: To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements.';

class FakeD1Statement {
	constructor(
		private readonly database: Database,
		private readonly sql: string,
		private readonly params: unknown[] = [],
	) {}

	bind(...params: unknown[]) {
		if (params.length > MAX_PARAMS)
			throw new Error('D1_ERROR: too many SQL variables');

		return new FakeD1Statement(this.database, this.sql, params);
	}

	all() {
		return Promise.resolve({
			meta: {},
			results: this.database.query(this.sql).all(...(this.params as [])),
			success: true,
		});
	}

	first() {
		return Promise.resolve(
			this.database.query(this.sql).get(...(this.params as [])) ?? null,
		);
	}

	raw() {
		return Promise.resolve(
			this.database.query(this.sql).values(...(this.params as [])),
		);
	}

	run() {
		const result = this.database
			.query(this.sql)
			.run(...(this.params as []));

		return Promise.resolve({
			meta: { changes: result.changes },
			results: [],
			success: true,
		});
	}
}

/** The slice of a `D1Database` binding that `drizzle-orm/d1` uses. */
class FakeD1Database {
	constructor(private readonly database: Database) {}

	prepare(sql: string) {
		if (TRANSACTION_SQL.test(sql)) throw new Error(D1_TRANSACTION_ERROR);

		return new FakeD1Statement(this.database, sql);
	}

	async batch(statements: FakeD1Statement[]) {
		const results = [];

		for (const statement of statements) results.push(await statement.run());

		return results;
	}
}

const createTablesSql = `
CREATE TABLE d1_authors (id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL);
CREATE TABLE d1_posts (
	id INTEGER PRIMARY KEY NOT NULL,
	author_id INTEGER REFERENCES d1_authors(id),
	title TEXT NOT NULL
);
CREATE TABLE d1_regions (
	id INTEGER PRIMARY KEY NOT NULL,
	a TEXT NOT NULL,
	b TEXT NOT NULL,
	region TEXT NOT NULL
);
CREATE TABLE d1_items (
	id INTEGER PRIMARY KEY NOT NULL,
	a TEXT NOT NULL,
	b TEXT NOT NULL,
	c TEXT NOT NULL,
	d TEXT NOT NULL,
	touched TEXT
);
`;

export const createD1Context = (options: Parameters<typeof better>[1] = {}) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(createTablesSql);
	const raw = drizzle(new FakeD1Database(sqlite) as never, { relations });

	return {
		client: better(raw, options),
		schema: { authors, items, posts },
		sqlite,
	};
};
