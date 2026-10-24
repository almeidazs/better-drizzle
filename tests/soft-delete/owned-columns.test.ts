import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';
import { softDelete } from '../../src/plugins/soft-delete';
import { timestamps } from '../../src/plugins/timestamps';

const records = sqliteTable('owned_records', {
	id: integer().primaryKey(),
	name: text().notNull(),
	createdAt: integer({ mode: 'timestamp_ms' }),
	updatedAt: integer({ mode: 'timestamp_ms' }),
	deletedAt: integer({ mode: 'timestamp_ms' }),
	deletedById: text(),
});
const createdOnly = sqliteTable('owned_created_only', {
	id: integer().primaryKey(),
	name: text().notNull(),
	createdAt: integer({ mode: 'timestamp_ms' }),
});
const custom = sqliteTable('owned_custom', {
	id: integer().primaryKey(),
	name: text().notNull(),
	madeAt: text(),
	touchedAt: text(),
	removedAt: text(),
	removedBy: text(),
});
const fixed = new Date('2026-01-01T00:00:00Z');
const forged = new Date('1999-01-01T00:00:00Z');
const createContext = (reverse = false) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE owned_records(id INTEGER PRIMARY KEY, name TEXT NOT NULL, createdAt INTEGER, updatedAt INTEGER, deletedAt INTEGER, deletedById TEXT);
		CREATE TABLE owned_created_only(id INTEGER PRIMARY KEY, name TEXT NOT NULL, createdAt INTEGER);
		CREATE TABLE owned_custom(id INTEGER PRIMARY KEY, name TEXT NOT NULL, madeAt TEXT, touchedAt TEXT, removedAt TEXT, removedBy TEXT);
	`);
	const raw = drizzle({
		client: sqlite,
		relations: defineRelations({ records, createdOnly, custom }),
	});
	const stamp = timestamps({
		now: () => fixed,
		models: { custom: { createdAt: 'madeAt', updatedAt: 'touchedAt' } },
	});
	const deletion = softDelete();
	return {
		sqlite,
		raw,
		db: better(raw, {
			plugins: reverse ? [deletion, stamp] : [stamp, deletion],
		}),
	};
};

test.each([false, true])(
	'updateEach protects audit columns with reversed plugin order %s',
	async (reverse) => {
		const ctx = createContext(reverse);
		try {
			await ctx.db.records.create({ data: { id: 1, name: 'Original' } });
			const update = Object.freeze({
				name: (row: { name: string }) => row.name,
				createdAt: () => {
					throw new Error('createdAt updater must not run');
				},
				deletedAt: () => {
					throw new Error('deletedAt updater must not run');
				},
				deletedById: () => {
					throw new Error('deletedBy updater must not run');
				},
			});
			await ctx.db.records.updateEach({
				by: records.id,
				data: [{ id: 1, name: 'Updated' }],
				update,
			});
			expect(
				await ctx.db.records.findFirst({ where: { id: 1 } }),
			).toMatchObject({
				name: 'Updated',
				createdAt: fixed,
				updatedAt: fixed,
				deletedAt: null,
				deletedById: null,
			});
			expect(Object.hasOwn(update, 'createdAt')).toBe(true);
			expect(Object.hasOwn(update, 'deletedAt')).toBe(true);
		} finally {
			ctx.sqlite.close();
		}
	},
);

test('updateEach protects createdAt without updatedAt and with custom names', async () => {
	const ctx = createContext();
	try {
		await ctx.db.createdOnly.create({ data: { id: 1, name: 'Original' } });
		await ctx.db.createdOnly.updateEach({
			by: createdOnly.id,
			data: [{ id: 1, name: 'Updated' }],
			update: { name: (row) => row.name, createdAt: () => forged },
		});
		expect(
			await ctx.db.createdOnly.findFirst({ where: { id: 1 } }),
		).toMatchObject({ name: 'Updated', createdAt: fixed });
		await ctx.db.custom.create({ data: { id: 1, name: 'Original' } });
		await ctx.db.custom.updateEach({
			by: custom.id,
			data: [{ id: 1, name: 'Updated' }],
			update: {
				name: (row) => row.name,
				madeAt: () => forged.toISOString(),
			},
		});
		expect(
			await ctx.db.custom.findFirst({ where: { id: 1 } }),
		).toMatchObject({ name: 'Updated', madeAt: fixed.toISOString() });
	} finally {
		ctx.sqlite.close();
	}
});

test('create, createMany, update, and updateMany strip caller soft-delete fields', async () => {
	const ctx = createContext();
	try {
		const data = Object.freeze({
			id: 1,
			name: 'Original',
			deletedAt: forged,
			deletedById: 'forged',
		});
		await ctx.db.records.create({ data });
		await ctx.db.records.createMany({
			data: [
				{ ...data, id: 2 },
				{ ...data, id: 3 },
			],
		});
		await ctx.db.records.update({
			where: { id: 1 },
			data: { name: 'Updated', deletedAt: forged, deletedById: 'forged' },
		});
		await ctx.db.records.updateMany({
			where: { id: { in: [2, 3] } },
			data: { name: 'Updated', deletedAt: forged, deletedById: 'forged' },
		});
		const rows = await ctx.db.records.findMany({ orderBy: { id: 'asc' } });
		expect(rows).toHaveLength(3);
		for (const row of rows)
			expect(row).toMatchObject({
				name: 'Updated',
				deletedAt: null,
				deletedById: null,
			});
		expect(data.deletedAt).toBe(forged);
		expect(data.deletedById).toBe('forged');
	} finally {
		ctx.sqlite.close();
	}
});

test('upsert cannot restore a deleted row or stamp a new row as deleted', async () => {
	const ctx = createContext();
	try {
		await ctx.db.records.create({ data: { id: 1, name: 'Original' } });
		const before = await ctx.db.records.delete({
			where: { id: 1 },
			deletedBy: 'admin',
		});
		await ctx.db.records.upsert({
			where: { id: 1 },
			create: { id: 1, name: 'Created', deletedAt: null },
			update: { name: 'Updated', deletedAt: null, deletedById: null },
		});
		expect(await ctx.db.records.findFirst({ where: { id: 1 } })).toBeNull();
		expect(
			await ctx.db.records.findFirst({
				where: { id: 1 },
				deleted: 'with',
			}),
		).toMatchObject({
			name: 'Updated',
			deletedAt: before?.deletedAt,
			deletedById: 'admin',
		});
		const created = await ctx.db.records.upsert({
			where: { id: 2 },
			create: {
				id: 2,
				name: 'Created',
				deletedAt: forged,
				deletedById: 'forged',
			},
			update: {},
		});
		expect(created).toMatchObject({ deletedAt: null, deletedById: null });
	} finally {
		ctx.sqlite.close();
	}
});

test.each(['all', 'columns', 'object', 'callback'] as const)(
	'upsertMany protects soft-delete fields with %s updates',
	async (mode) => {
		const ctx = createContext();
		try {
			await ctx.db.records.create({ data: { id: 1, name: 'Original' } });
			const before = await ctx.db.records.delete({
				where: { id: 1 },
				deletedBy: 'admin',
			});
			const update =
				mode === 'all'
					? 'all'
					: mode === 'columns'
						? ['name', 'deletedAt', 'deletedById']
						: mode === 'object'
							? {
									name: 'Updated',
									deletedAt: null,
									deletedById: null,
								}
							: ({
									excluded,
								}: {
									excluded: { name: unknown };
								}) => ({
									name: excluded.name,
									deletedAt: sql`NULL`,
									deletedById: null,
								});
			await ctx.db.records.upsertMany({
				target: 'id',
				data: [
					{
						id: 1,
						name: 'Updated',
						deletedAt: null,
						deletedById: null,
					},
					{
						id: 2,
						name: 'Created',
						deletedAt: forged,
						deletedById: 'forged',
					},
				],
				update,
			} as never);
			expect(
				await ctx.db.records.findFirst({ where: { id: 1 } }),
			).toBeNull();
			expect(
				await ctx.db.records.findFirst({
					where: { id: 1 },
					deleted: 'with',
				}),
			).toMatchObject({
				name: 'Updated',
				deletedAt: before?.deletedAt,
				deletedById: 'admin',
			});
			expect(
				await ctx.db.records.findFirst({ where: { id: 2 } }),
			).toMatchObject({ deletedAt: null, deletedById: null });
		} finally {
			ctx.sqlite.close();
		}
	},
);

test('custom soft-delete columns are protected while restore and bypass remain explicit', async () => {
	const ctx = createContext();
	const db = better(ctx.raw, {
		plugins: [
			softDelete({ column: 'removedAt', deletedByColumn: 'removedBy' }),
		],
	});
	try {
		await db.custom.create({
			data: {
				id: 1,
				name: 'Original',
				removedAt: forged.toISOString(),
				removedBy: 'forged',
			},
		});
		expect(await db.custom.findFirst({ where: { id: 1 } })).toMatchObject({
			removedAt: null,
			removedBy: null,
		});
		await db.custom.updateEach({
			by: custom.id,
			data: [{ id: 1, name: 'Updated' }],
			update: {
				name: (row) => row.name,
				removedAt: () => forged.toISOString(),
				removedBy: () => 'forged',
			},
		});
		expect(await db.custom.findFirst({ where: { id: 1 } })).toMatchObject({
			removedAt: null,
			removedBy: null,
		});
		await db.custom.delete({ where: { id: 1 }, deletedBy: 'admin' });
		await db.custom.restore({ where: { id: 1 } });
		expect(await db.custom.findFirst({ where: { id: 1 } })).toMatchObject({
			removedAt: null,
			removedBy: null,
		});
		await db.custom.$withoutPlugins().update({
			where: { id: 1 },
			data: { removedAt: forged.toISOString(), removedBy: 'import' },
		});
		expect(await db.custom.findFirst({ where: { id: 1 } })).toBeNull();
		expect(
			await db.custom.findFirst({ where: { id: 1 }, deleted: 'with' }),
		).toMatchObject({
			removedAt: forged.toISOString(),
			removedBy: 'import',
		});
	} finally {
		ctx.sqlite.close();
	}
});

test.each(['timestamps', 'soft-delete', 'both', 'reversed'] as const)(
	'upsertMany all preserves conflict keys with %s',
	async (mode) => {
		const ctx = createContext();
		const stamp = timestamps({ now: () => fixed });
		const deletion = softDelete();
		const plugins =
			mode === 'timestamps'
				? [stamp]
				: mode === 'soft-delete'
					? [deletion]
					: mode === 'both'
						? [stamp, deletion]
						: [deletion, stamp];
		const db = better(ctx.raw, { plugins });
		try {
			await db.records.create({ data: { id: 1, name: 'Original' } });
			ctx.sqlite.exec(
				`CREATE TRIGGER immutable_owned_id BEFORE UPDATE OF id ON owned_records BEGIN SELECT RAISE(ABORT, 'immutable id'); END`,
			);
			for (const target of ['id', ['id']] as const) {
				await db.records.upsertMany({
					target,
					data: [{ id: 1, name: 'Updated' }],
					update: 'all',
				});
			}
			expect(
				await db.records.findFirst({ where: { id: 1 } }),
			).toMatchObject({ id: 1, name: 'Updated' });
		} finally {
			ctx.sqlite.close();
		}
	},
);
