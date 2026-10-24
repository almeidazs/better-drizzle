import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core';

import { better, BetterDrizzleError } from '../../src';
import { cache } from '../../src/plugins/cache';
import { rules } from '../../src/plugins/rules';
import { softDelete } from '../../src/plugins/soft-delete';
import { timestamps } from '../../src/plugins/timestamps';
import { createMemoryStore } from '../cache/memory-store';

const records = sqliteTable('restore_records', {
	recordKey: text('record_key').primaryKey(),
	id: integer(),
	name: text().notNull(),
	updatedAt: integer({ mode: 'timestamp_ms' }),
	deletedAt: integer({ mode: 'timestamp_ms' }),
	deletedById: text(),
});
const composite = sqliteTable(
	'restore_composite',
	{
		id: integer(),
		tenantId: text().notNull(),
		deletedAt: integer({ mode: 'timestamp_ms' }),
	},
	(table) => [primaryKey({ columns: [table.id, table.tenantId] })],
);
const keyless = sqliteTable('restore_keyless', {
	id: integer(),
	deletedAt: integer({ mode: 'timestamp_ms' }),
});
const now = new Date('2026-10-24T12:00:00Z');
const createContext = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE restore_records(record_key TEXT PRIMARY KEY, id INTEGER, name TEXT NOT NULL, updatedAt INTEGER, deletedAt INTEGER, deletedById TEXT);
		INSERT INTO restore_records VALUES ('a', 1, 'Deleted', 1000, 2000, 'admin'), ('b', 2, 'Other', 1000, 2000, 'admin');
		CREATE TABLE restore_composite(id INTEGER, tenantId TEXT NOT NULL, deletedAt INTEGER, PRIMARY KEY(id, tenantId));
		INSERT INTO restore_composite VALUES (1, 'a', 2000), (1, 'b', 2000);
		CREATE TABLE restore_keyless(id INTEGER, deletedAt INTEGER);
		INSERT INTO restore_keyless VALUES (1, 2000);
	`);
	return {
		sqlite,
		raw: drizzle({
			client: sqlite,
			relations: defineRelations({ records, composite, keyless }),
		}),
	};
};

for (const method of ['restore', 'restoreById'] as const) {
	test.each([false, true])(
		`${method} runs plugins and client hooks (reversed: %s)`,
		async (reverse) => {
			const ctx = createContext();
			const memory = createMemoryStore();
			const events: string[] = [];
			const deletion = softDelete();
			const stamp = timestamps({ now: () => now });
			const db = better(ctx.raw, {
				plugins: [
					cache({ store: memory.store, ttl: 300 }),
					...(reverse ? [deletion, stamp] : [stamp, deletion]),
				],
				hooks: {
					beforeUpdate(context) {
						events.push(`before:${context.meta.reason}`);
						context.args.data.name = 'Restored';
					},
					afterUpdate() {
						events.push('after');
					},
				},
			});
			try {
				const read = () => db.records.findMany({ cache: true });
				expect(await read()).toEqual([]);
				const cached = memory.calls.set;
				expect(await read()).toEqual([]);
				expect(memory.calls.set).toBe(cached);
				const args = {
					meta: { reason: 'reviewed' },
					select: {
						recordKey: true,
						name: true,
						updatedAt: true,
						deletedAt: true,
						deletedById: true,
					},
				};
				const restored =
					method === 'restore'
						? await db.records.restore({
								...args,
								where: { recordKey: 'a' },
							})
						: await db.records.restoreById('a', args);
				expect(restored).toEqual({
					recordKey: 'a',
					name: 'Restored',
					updatedAt: now,
					deletedAt: null,
					deletedById: null,
				});
				expect(events).toEqual(['before:reviewed', 'after']);
				expect(await read()).toMatchObject([
					{ recordKey: 'a', name: 'Restored' },
				]);
				expect(
					await db.records.findFirst({
						where: { recordKey: 'b' },
						deleted: 'with',
					}),
				).toMatchObject({
					deletedAt: new Date(2000),
					deletedById: 'admin',
				});
			} finally {
				ctx.sqlite.close();
			}
		},
	);

	test(`${method} respects rules before writing`, async () => {
		const ctx = createContext();
		const db = better(ctx.raw, {
			plugins: [
				softDelete(),
				rules({
					noQueryDeletedWithoutExplicitOptIn: { requireReason: true },
				}),
			],
		});
		try {
			const restore = () =>
				method === 'restore'
					? db.records.restore({ where: { recordKey: 'a' } })
					: db.records.restoreById('a');
			await expect(Promise.resolve().then(restore)).rejects.toThrow(
				/reason/i,
			);
			expect(
				await db.records.findFirst({
					where: { recordKey: 'a' },
					deleted: 'with',
					meta: { reason: 'verify unchanged' },
				}),
			).toMatchObject({ deletedAt: new Date(2000) });
		} finally {
			ctx.sqlite.close();
		}
	});

	test(`${method} rolls back inside a transaction without invalidating cache`, async () => {
		const ctx = createContext();
		const memory = createMemoryStore();
		const db = better(ctx.raw, {
			plugins: [softDelete(), cache({ store: memory.store, ttl: 300 })],
		});
		try {
			expect(await db.records.findMany({ cache: true })).toEqual([]);
			const cached = memory.calls.set;
			await expect(
				db.transaction(async (tx) => {
					const restored =
						method === 'restore'
							? await tx.records.restore({
									where: { recordKey: 'a' },
								})
							: await tx.records.restoreById('a');
					expect(restored).toMatchObject({
						recordKey: 'a',
						deletedAt: null,
					});
					throw new Error('rollback restore');
				}),
			).rejects.toThrow('rollback restore');
			expect(
				await db.records.findFirst({
					where: { recordKey: 'a' },
					deleted: 'with',
				}),
			).toMatchObject({
				deletedAt: new Date(2000),
				deletedById: 'admin',
			});
			expect(await db.records.findMany({ cache: true })).toEqual([]);
			expect(memory.calls.set).toBe(cached);
		} finally {
			ctx.sqlite.close();
		}
	});
}

test('restoreById uses the declared primary key even with an unrelated id column', async () => {
	const ctx = createContext();
	const db = better(ctx.raw, { plugins: [softDelete()] });
	try {
		expect(await db.records.restoreById('a')).toMatchObject({
			recordKey: 'a',
			deletedAt: null,
		});
		expect(await db.records.restoreById('missing')).toBeNull();
		expect(await db.records.count()).toBe(1);
	} finally {
		ctx.sqlite.close();
	}
});

test.each(['composite', 'keyless'] as const)(
	'restoreById rejects %s keys while restore with where still works',
	async (model) => {
		const ctx = createContext();
		const db = better(ctx.raw, { plugins: [softDelete()] });
		try {
			const error = await Promise.resolve()
				.then(() => db[model].restoreById(1))
				.catch((cause) => cause);
			expect(error).toBeInstanceOf(BetterDrizzleError);
			expect(error.code).toBe('INVALID_ARGS');
			expect(await db[model].count()).toBe(0);
			expect(
				await db[model].restore({
					where: {
						id: 1,
						...(model === 'composite' ? { tenantId: 'a' } : {}),
					},
				}),
			).toMatchObject({ id: 1, deletedAt: null });
			expect(await db[model].count()).toBe(1);
		} finally {
			ctx.sqlite.close();
		}
	},
);
