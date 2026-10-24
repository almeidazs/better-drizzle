import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';

const parents = sqliteTable('batch_parents', {
	id: integer().primaryKey(),
	org: integer().notNull(),
});
const children = sqliteTable('batch_children', {
	id: integer().primaryKey(),
	parentId: integer('parent_id').notNull(),
	org: integer().notNull(),
	name: text().notNull(),
});
const links = sqliteTable('batch_links', {
	parentId: integer('parent_id').notNull(),
	org: integer().notNull(),
	childId: integer('child_id').notNull(),
});
const relations = defineRelations({ parents, children, links }, (r) => ({
	parents: {
		children: r.many.children({
			from: r.parents.id,
			to: r.children.parentId,
		}),
		composite: r.many.children({
			from: [r.parents.org, r.parents.id],
			to: [r.children.org, r.children.parentId],
		}),
		linked: r.many.children({
			from: r.parents.id.through(r.links.parentId),
			to: r.children.id.through(r.links.childId),
		}),
		compositeLinked: r.many.children({
			from: [
				r.parents.org.through(r.links.org),
				r.parents.id.through(r.links.parentId),
			],
			to: r.children.id.through(r.links.childId),
		}),
	},
	children: {
		parent: r.one.parents({ from: r.children.parentId, to: r.parents.id }),
	},
}));

const createContext = (size: number) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE batch_parents(id INTEGER PRIMARY KEY, org INTEGER NOT NULL);
		CREATE TABLE batch_children(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL, org INTEGER NOT NULL, name TEXT NOT NULL);
		CREATE TABLE batch_links(parent_id INTEGER NOT NULL, org INTEGER NOT NULL, child_id INTEGER NOT NULL);
		WITH RECURSIVE ids(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM ids WHERE id < ${size}) INSERT INTO batch_parents SELECT id, 1 FROM ids;
		INSERT INTO batch_children SELECT id*10, id, org, 'first' FROM batch_parents;
		INSERT INTO batch_children SELECT id*10+1, id, org, 'second' FROM batch_parents;
		INSERT INTO batch_links SELECT parent_id, org, id FROM batch_children;
	`);
	const queries: { sql: string; params: number }[] = [];
	const raw = drizzle({
		client: sqlite,
		relations,
		logger: {
			logQuery(query, params) {
				queries.push({ sql: query, params: params.length });
			},
		},
	});
	return { sqlite, db: better(raw), queries };
};

test.each(['children', 'linked'] as const)(
	'%s loads more parents than the SQLite bind limit',
	async (relation) => {
		const ctx = createContext(32_767);
		try {
			const rows = await ctx.db.parents.findMany({
				include: { [relation]: true },
				orderBy: { id: 'asc' },
			});
			expect(rows).toHaveLength(32_767);
			for (const row of rows)
				expect(row[relation].map((child) => child.parentId)).toEqual([
					row.id,
					row.id,
				]);
			expect(
				ctx.queries.slice(1).every((query) => query.params <= 32_766),
			).toBe(true);
		} finally {
			ctx.sqlite.close();
		}
	},
);

test.each(['composite', 'compositeLinked'] as const)(
	'%s bounds OR depth and keeps pagination per parent',
	async (relation) => {
		const ctx = createContext(1_100);
		try {
			const rows = await ctx.db.parents.findMany({
				include: {
					[relation]: {
						where: { name: { in: ['first', 'second'] } },
						orderBy: { id: 'desc' },
						skip: 1,
						take: 1,
						select: {
							name: true,
							parent: { select: { id: true } },
						},
					},
				},
				orderBy: { id: 'asc' },
			});
			expect(rows).toHaveLength(1_100);
			for (const row of rows)
				expect(row[relation]).toEqual([
					{ name: 'first', parent: { id: row.id } },
				]);
		} finally {
			ctx.sqlite.close();
		}
	},
);

test('small relation reads still use one query per relation', async () => {
	const ctx = createContext(10);
	try {
		const rows = await ctx.db.parents.findMany({
			include: { children: true, linked: true },
		});
		expect(rows).toHaveLength(10);
		expect(ctx.queries).toHaveLength(3);
	} finally {
		ctx.sqlite.close();
	}
});

test('shared one-relation keys are deduplicated across batch boundaries', async () => {
	const ctx = createContext(10_001);
	try {
		const rows = await ctx.db.children.findMany({
			include: { parent: true },
			orderBy: { id: 'asc' },
		});
		expect(rows).toHaveLength(20_002);
		for (const row of rows) expect(row.parent?.id).toBe(row.parentId);
		expect(ctx.queries).toHaveLength(3);
	} finally {
		ctx.sqlite.close();
	}
});

test('equal Date keys are fetched once even when parents exceed a batch', async () => {
	const parents = sqliteTable('date_parents', {
		id: integer().primaryKey(),
		at: integer({ mode: 'timestamp_ms' }).notNull(),
	});
	const children = sqliteTable('date_children', {
		id: integer().primaryKey(),
		at: integer({ mode: 'timestamp_ms' }).notNull(),
	});
	const relations = defineRelations({ parents, children }, (r) => ({
		parents: {
			children: r.many.children({
				from: r.parents.at,
				to: r.children.at,
			}),
		},
	}));
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec(`
			CREATE TABLE date_parents(id INTEGER PRIMARY KEY, at INTEGER NOT NULL);
			CREATE TABLE date_children(id INTEGER PRIMARY KEY, at INTEGER NOT NULL);
			WITH RECURSIVE ids(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM ids WHERE id < 10001) INSERT INTO date_parents SELECT id, 1000 FROM ids;
			INSERT INTO date_children VALUES (1, 1000);
		`);
		const params: number[] = [];
		const db = better(
			drizzle({
				client: sqlite,
				relations,
				logger: {
					logQuery(_query, values) {
						params.push(values.length);
					},
				},
			}),
		);
		const rows = await db.parents.findMany({ include: { children: true } });
		expect(rows).toHaveLength(10_001);
		expect(
			rows.every(
				(row) => row.children.length === 1 && row.children[0]?.id === 1,
			),
		).toBe(true);
		expect(params).toEqual([0, 1]);
	} finally {
		sqlite.close();
	}
});
