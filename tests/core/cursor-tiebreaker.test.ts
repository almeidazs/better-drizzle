import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, primaryKey, sqliteTable } from 'drizzle-orm/sqlite-core';

import { better, param } from '../../src';

const records = sqliteTable(
	'cursor_ties',
	{
		tenantId: integer().notNull(),
		id: integer().notNull(),
		value: integer(),
	},
	(table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

const createContext = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE cursor_ties(tenantId INTEGER NOT NULL, id INTEGER NOT NULL, value INTEGER, PRIMARY KEY(tenantId, id));
		INSERT INTO cursor_ties VALUES (2,3,10),(1,3,10),(2,1,20),(1,1,20),(2,2,NULL),(1,2,NULL);
	`);
	return {
		sqlite,
		db: better(
			drizzle({
				client: sqlite,
				relations: defineRelations({ records }),
			}),
		),
	};
};

test.each([
	undefined,
	{},
	[],
	{ value: 'desc' },
	[{ value: { direction: 'asc', nulls: 'last' } }, { tenantId: 'desc' }],
] as const)(
	'cursor traverses every tied row forwards and backwards with order %j',
	async (orderBy) => {
		const { sqlite, db } = createContext();
		try {
			const all = await db.records.cursor({ limit: 100, orderBy });
			let page = await db.records.cursor({ limit: 1, orderBy });
			const rows = [...page.data];
			while (page.pagination.nextCursor && rows.length < 10) {
				page = await db.records.cursor({
					limit: 1,
					orderBy,
					after: page.pagination.nextCursor,
				});
				rows.push(...page.data);
			}
			expect(rows).toHaveLength(6);
			expect(rows).toEqual(all.data);
			const backwards = [...page.data];
			while (page.pagination.previousCursor && backwards.length < 10) {
				page = await db.records.cursor({
					limit: 1,
					orderBy,
					before: page.pagination.previousCursor,
				});
				backwards.unshift(...page.data);
			}
			expect(backwards).toEqual(all.data);
		} finally {
			sqlite.close();
		}
	},
);

test('cursor keeps legacy tokens and upgrades returned tokens to the full primary key', async () => {
	const { sqlite, db } = createContext();
	try {
		const page = await db.records.cursor({
			orderBy: { value: 'desc' },
			after: { value: 20 },
			limit: 1,
		});
		expect(page.data[0]?.value).toBe(10);
		expect(page.pagination.nextCursor).toEqual({
			value: 10,
			tenantId: 1,
			id: 3,
		});
		const composite = await db.records.cursor({
			after: { tenantId: 1 },
			limit: 1,
		});
		expect(composite.data[0]).toMatchObject({ tenantId: 2, id: 1 });
		const reverse = await db.records.cursor({
			before: { tenantId: 2 },
			limit: 1,
		});
		expect(reverse.data[0]).toMatchObject({ tenantId: 1, id: 3 });
	} finally {
		sqlite.close();
	}
});

test('prepared cursor uses the full composite key and sort tiebreakers', async () => {
	const { sqlite, db } = createContext();
	try {
		const prepared = db.records
			.cursor({ after: param('after'), limit: 1 })
			.prepare('composite_cursor');
		const page = await prepared.execute({ after: { tenantId: 1, id: 1 } });
		expect(page.data).toEqual([{ tenantId: 1, id: 2, value: null }]);
		const sorted = db.records
			.cursor({
				after: param('after'),
				orderBy: { value: 'desc' },
				limit: 1,
			})
			.prepare('sorted_cursor');
		const next = await sorted.execute({
			after: { value: 20, tenantId: 1, id: 1 },
		});
		expect(next.data).toEqual([{ tenantId: 2, id: 1, value: 20 }]);
		const oldToken = await sorted.execute({ after: { value: 20 } });
		expect(oldToken.data).toEqual([{ tenantId: 1, id: 3, value: 10 }]);
	} finally {
		sqlite.close();
	}
});

test('cursor keeps implicit primary keys out of projected rows', async () => {
	const { sqlite, db } = createContext();
	try {
		const first = await db.records.cursor({
			limit: 1,
			orderBy: { value: 'desc' },
			select: { value: true },
		});
		expect(first.data).toEqual([{ value: 20 }]);
		expect(first.pagination.nextCursor).toEqual({
			value: 20,
			tenantId: 1,
			id: 1,
		});
		const second = await db.records.cursor({
			limit: 1,
			orderBy: { value: 'desc' },
			select: { value: true },
			after: first.pagination.nextCursor,
		});
		expect(second.data).toEqual([{ value: 20 }]);
		expect(second.pagination.nextCursor).toEqual({
			value: 20,
			tenantId: 2,
			id: 1,
		});
	} finally {
		sqlite.close();
	}
});
