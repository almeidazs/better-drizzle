import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
	blob,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core';

import { better, definePlugin } from '../../src';

const groups = sqliteTable('reload_groups', {
	id: integer().primaryKey(),
	name: text().notNull(),
});
const owners = sqliteTable('reload_owners', {
	id: integer().primaryKey(),
	groupId: integer('group_id'),
	name: text().notNull(),
});
const records = sqliteTable('reload_records', {
	id: integer('record_id').primaryKey(),
	ownerId: integer('owner_id'),
	label: text().notNull(),
});
const composite = sqliteTable(
	'reload_composite',
	{
		tenantKey: text('tenant_key').notNull(),
		recordKey: text('record_key').notNull(),
		label: text().notNull(),
	},
	(table) => [primaryKey({ columns: [table.tenantKey, table.recordKey] })],
);
const mapped = sqliteTable(
	'reload_mapped',
	{
		at: integer('at_key', { mode: 'timestamp_ms' }).notNull(),
		bytes: blob('bytes_key', { mode: 'buffer' }).notNull(),
		serial: blob('serial_key', { mode: 'bigint' }).notNull(),
		label: text().notNull(),
	},
	(table) => [primaryKey({ columns: [table.at, table.bytes, table.serial] })],
);
const keyless = sqliteTable('reload_keyless', { label: text().notNull() });
const relations = defineRelations(
	{ groups, owners, records, composite, mapped, keyless },
	(r) => ({
		records: {
			owner: r.one.owners({ from: r.records.ownerId, to: r.owners.id }),
		},
		owners: {
			group: r.one.groups({ from: r.owners.groupId, to: r.groups.id }),
		},
	}),
);

const createContext = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE reload_groups(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
		CREATE TABLE reload_owners(id INTEGER PRIMARY KEY, group_id INTEGER, name TEXT NOT NULL);
		CREATE TABLE reload_records(record_id INTEGER PRIMARY KEY, owner_id INTEGER, label TEXT NOT NULL);
		CREATE TABLE reload_composite(tenant_key TEXT NOT NULL, record_key TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(tenant_key, record_key));
		CREATE TABLE reload_mapped(at_key INTEGER NOT NULL, bytes_key BLOB NOT NULL, serial_key BLOB NOT NULL, label TEXT NOT NULL, PRIMARY KEY(at_key, bytes_key, serial_key));
		CREATE TABLE reload_keyless(label TEXT NOT NULL);
		INSERT INTO reload_groups VALUES (1, 'Editors');
		INSERT INTO reload_owners VALUES (1, 1, 'Alice'), (2, NULL, 'Bob');
	`);
	const queries: { sql: string; params: number }[] = [];
	const raw = drizzle({
		client: sqlite,
		relations,
		logger: {
			logQuery(sql, params) {
				queries.push({ sql, params: params.length });
			},
		},
	});
	return { sqlite, raw, db: better(raw), queries };
};

test('createMany select reloads once and preserves insertion order without leaking primary keys', async () => {
	const ctx = createContext();
	try {
		const result = await ctx.db.records.createMany({
			data: [
				{ id: 30, label: 'third' },
				{ id: 10, label: 'first' },
				{ id: 20, label: 'second' },
			],
			select: { label: true },
		});
		expect(result).toEqual({
			count: 3,
			data: [{ label: 'third' }, { label: 'first' }, { label: 'second' }],
		});
		expect(ctx.queries).toHaveLength(2);
	} finally {
		ctx.sqlite.close();
	}
});

test.each(['select', 'include'] as const)(
	'createMany %s batches nested relations and preserves null relations',
	async (projection) => {
		const ctx = createContext();
		try {
			const data = [
				{ id: 30, ownerId: 1, label: 'third' },
				{ id: 10, ownerId: null, label: 'first' },
				{ id: 20, ownerId: 2, label: 'second' },
				{ id: 40, ownerId: 1, label: 'fourth' },
			];
			const owner = {
				select: { name: true, group: { select: { name: true } } },
			};
			const result = await ctx.db.records.createMany({
				data,
				...(projection === 'select'
					? { select: { label: true, owner } }
					: { include: { owner } }),
			});
			const expectedOwners = [
				{ name: 'Alice', group: { name: 'Editors' } },
				null,
				{ name: 'Bob', group: null },
				{ name: 'Alice', group: { name: 'Editors' } },
			];
			expect(result).toEqual({
				count: 4,
				data: data.map((row, index) => ({
					...(projection === 'select' ? { label: row.label } : row),
					owner: expectedOwners[index],
				})),
			});
			expect(ctx.queries).toHaveLength(4);
		} finally {
			ctx.sqlite.close();
		}
	},
);

test('createMany matches mapped composite keys without delimiter collisions', async () => {
	const ctx = createContext();
	try {
		const data = [
			{ tenantKey: 'a|b', recordKey: 'c', label: 'pipe left' },
			{ tenantKey: 'a', recordKey: 'b|c', label: 'pipe right' },
			{ tenantKey: 'a,b', recordKey: 'c', label: 'comma left' },
			{ tenantKey: 'a', recordKey: 'b,c', label: 'comma right' },
			{ tenantKey: 'a\u0000b', recordKey: 'c', label: 'null left' },
			{ tenantKey: 'a', recordKey: 'b\u0000c', label: 'null right' },
		];
		const result = await ctx.db.composite.createMany({
			data,
			select: { label: true },
		});
		expect(result).toEqual({
			count: data.length,
			data: data.map(({ label }) => ({ label })),
		});
		expect(ctx.queries).toHaveLength(2);
	} finally {
		ctx.sqlite.close();
	}
});

test('createMany chunks composite reload predicates below SQLite expression depth', async () => {
	const ctx = createContext();
	try {
		const data = Array.from({ length: 1_100 }, (_, index) => ({
			tenantKey: `tenant-${index % 3}`,
			recordKey: `key-${1_100 - index}`,
			label: `label-${index}`,
		}));
		const result = await ctx.db.composite.createMany({
			data,
			select: { label: true },
		});
		expect(result).toEqual({
			count: data.length,
			data: data.map(({ label }) => ({ label })),
		});
		const reads = ctx.queries.filter(({ sql }) => /^select\b/i.test(sql));
		expect(reads.length).toBeGreaterThan(1);
		expect(reads.length).toBeLessThan(10);
		expect(reads.every(({ params }) => params <= 32_766)).toBe(true);
	} finally {
		ctx.sqlite.close();
	}
});

test('createMany skipDuplicates reloads only inserted rows in returning order', async () => {
	const ctx = createContext();
	try {
		ctx.sqlite.exec(
			"INSERT INTO reload_records VALUES (10, NULL, 'existing')",
		);
		const result = await ctx.db.records.createMany({
			data: [
				{ id: 30, label: 'third' },
				{ id: 10, label: 'ignored' },
				{ id: 20, label: 'second' },
			],
			skipDuplicates: true,
			select: { label: true },
		});
		expect(result).toEqual({
			count: 2,
			data: [{ label: 'third' }, { label: 'second' }],
		});
		expect(ctx.queries).toHaveLength(2);
	} finally {
		ctx.sqlite.close();
	}
});

test.each([{}, { id: false, ownerId: false, label: false }])(
	'createMany preserves scalar selection behavior for %j',
	async (select) => {
		const ctx = createContext();
		try {
			const data = [
				{ id: 30, ownerId: null, label: 'third' },
				{ id: 10, ownerId: 1, label: 'first' },
			];
			const result = await ctx.db.records.createMany({ data, select });
			expect(result).toEqual({ count: 2, data });
		} finally {
			ctx.sqlite.close();
		}
	},
);

test('createMany matches decoded Date, Buffer, and bigint composite key values', async () => {
	const ctx = createContext();
	try {
		const data = [
			{
				at: new Date(2000),
				bytes: Buffer.from([0, 255]),
				serial: 9007199254740993n,
				label: 'second',
			},
			{
				at: new Date(1000),
				bytes: Buffer.from([0, 255]),
				serial: 9007199254740993n,
				label: 'first',
			},
			{
				at: new Date(2000),
				bytes: Buffer.from([255, 0]),
				serial: 9007199254740993n,
				label: 'other bytes',
			},
			{
				at: new Date(2000),
				bytes: Buffer.from([0, 255]),
				serial: 9007199254740994n,
				label: 'other bigint',
			},
		];
		const result = await ctx.db.mapped.createMany({
			data,
			select: { label: true },
		});
		expect(result).toEqual({
			count: 4,
			data: data.map(({ label }) => ({ label })),
		});
		expect(ctx.queries).toHaveLength(2);
	} finally {
		ctx.sqlite.close();
	}
});

test('createMany keeps the row-based fallback for tables without primary keys', async () => {
	const ctx = createContext();
	try {
		const data = [
			{ label: 'third' },
			{ label: 'first' },
			{ label: 'third' },
		];
		const result = await ctx.db.keyless.createMany({
			data,
			select: { label: true },
		});
		expect(result).toEqual({ count: 3, data });
	} finally {
		ctx.sqlite.close();
	}
});

test('createMany does not mutate a caller projection when adding reload keys', async () => {
	const ctx = createContext();
	try {
		const select = Object.freeze({
			label: true,
			owner: Object.freeze({ select: Object.freeze({ name: true }) }),
		});
		const result = await ctx.db.records.createMany({
			data: [
				{ id: 30, ownerId: 1, label: 'third' },
				{ id: 10, ownerId: null, label: 'first' },
			],
			select,
		});
		expect(result.data).toEqual([
			{ label: 'third', owner: { name: 'Alice' } },
			{ label: 'first', owner: null },
		]);
		expect(select).toEqual({
			label: true,
			owner: { select: { name: true } },
		});
	} finally {
		ctx.sqlite.close();
	}
});

test('createMany retains inserted count when read scopes hide some returning rows', async () => {
	const ctx = createContext();
	try {
		const visible = definePlugin({
			id: 'test/reload-visible',
			scope: {
				key: 'visible',
				model: (model) =>
					model.name === 'records'
						? { where: { label: { not: 'hidden' } } }
						: undefined,
			},
		});
		const db = better(ctx.raw, { plugins: [visible] });
		const result = await db.records.createMany({
			data: [
				{ id: 30, label: 'third' },
				{ id: 10, label: 'hidden' },
				{ id: 20, label: 'second' },
			],
			select: { label: true },
		});
		expect(result).toEqual({
			count: 3,
			data: [{ label: 'third' }, { label: 'second' }],
		});
		expect(
			ctx.sqlite
				.query('SELECT count(*) AS count FROM reload_records')
				.get(),
		).toEqual({ count: 3 });
		expect(ctx.queries).toHaveLength(2);
	} finally {
		ctx.sqlite.close();
	}
});

test('createMany reload chunks reserve the bind parameters used by read scopes', async () => {
	const ctx = createContext();
	try {
		const visible = definePlugin({
			id: 'test/reload-bind-budget',
			scope: {
				key: 'visible',
				model: (model) =>
					model.name === 'records'
						? {
								where: {
									label: {
										in: Array(32_760).fill('visible'),
									},
								},
							}
						: undefined,
			},
		});
		const db = better(ctx.raw, { plugins: [visible] });
		const data = Array.from({ length: 10 }, (_, index) => ({
			id: 10 - index,
			label: 'visible',
		}));
		const result = await db.records.createMany({
			data,
			select: { id: true },
		});
		expect(result).toEqual({
			count: 10,
			data: data.map(({ id }) => ({ id })),
		});
		const reads = ctx.queries.filter(({ sql }) => /^select\b/i.test(sql));
		expect(reads).toHaveLength(2);
		expect(reads.every(({ params }) => params <= 32_766)).toBe(true);
	} finally {
		ctx.sqlite.close();
	}
});
