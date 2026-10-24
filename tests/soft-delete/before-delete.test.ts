import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better, definePlugin } from '../../src';
import { cache } from '../../src/plugins/cache';
import { rules } from '../../src/plugins/rules';
import { softDelete } from '../../src/plugins/soft-delete';
import { createMemoryStore } from '../cache/memory-store';

const records = sqliteTable('guarded_soft_delete', {
	id: integer().primaryKey(),
	name: text().notNull(),
	deletedAt: integer({ mode: 'timestamp_ms' }),
	deletedById: text(),
});

const createContext = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE guarded_soft_delete(id INTEGER PRIMARY KEY, name TEXT NOT NULL, deletedAt INTEGER, deletedById TEXT);
		INSERT INTO guarded_soft_delete VALUES (1, 'First', NULL, NULL), (2, 'Second', NULL, NULL);
	`);
	const queries: string[] = [];
	const raw = drizzle({
		client: sqlite,
		relations: defineRelations({ records }),
		logger: {
			logQuery(query) {
				queries.push(query);
			},
		},
	});
	const snapshot = () =>
		sqlite.query('SELECT * FROM guarded_soft_delete ORDER BY id').all();
	return { sqlite, raw, queries, snapshot };
};

describe.each(['delete', 'deleteMany'] as const)('%s before hooks', (kind) => {
	test.each(['client', 'plugin-first', 'plugin-last', 'transform'] as const)(
		'%s rejection runs no SQL and preserves rows and cache',
		async (guard) => {
			const ctx = createContext();
			const memory = createMemoryStore();
			let beforeCalls = 0;
			let afterCalls = 0;
			const reject = async () => {
				beforeCalls++;
				await Promise.resolve();
				throw new Error('delete forbidden');
			};
			const guardPlugin = definePlugin({
				id: 'delete-guard',
				hooks: guard.startsWith('plugin')
					? { beforeDelete: reject }
					: {},
				transform(operation) {
					if (
						guard === 'transform' &&
						(operation.kind === 'delete' ||
							operation.kind === 'deleteMany')
					)
						throw new Error('delete forbidden');
				},
			});
			const deletion = softDelete();
			const caching = cache({ store: memory.store, ttl: 60 });
			const client = better(ctx.raw, {
				plugins:
					guard === 'plugin-first'
						? [guardPlugin, deletion, caching]
						: [deletion, caching, guardPlugin],
				hooks: {
					beforeDelete: guard === 'client' ? reject : undefined,
					afterDelete() {
						afterCalls++;
					},
				},
			});
			try {
				const read = () =>
					client.records.findMany({
						cache: true,
						orderBy: { id: 'asc' },
					});
				const cached = await read();
				const before = ctx.snapshot();
				const cacheWrites = memory.calls.set;
				ctx.queries.length = 0;
				await expect(
					client.records[kind]({
						where: { id: { in: [1, 2] } },
						deletedBy: 'admin',
					}),
				).rejects.toThrow('delete forbidden');
				expect(ctx.snapshot()).toEqual(before);
				expect(ctx.queries).toEqual([]);
				expect(afterCalls).toBe(0);
				expect(beforeCalls).toBe(guard === 'transform' ? 0 : 1);
				expect(memory.calls.set).toBe(cacheWrites);
				expect(await read()).toEqual(cached);
				expect(ctx.queries).toEqual([]);
			} finally {
				ctx.sqlite.close();
			}
		},
	);

	test('a later rules plugin can reject without changing audit columns', async () => {
		const ctx = createContext();
		const client = better(ctx.raw, {
			plugins: [softDelete(), rules({ requireQueryComment: 'error' })],
		});
		try {
			const before = ctx.snapshot();
			await expect(
				client.records[kind]({ where: { id: 1 } }),
			).rejects.toThrow();
			expect(ctx.snapshot()).toEqual(before);
			expect(ctx.queries).toEqual([]);
		} finally {
			ctx.sqlite.close();
		}
	});

	test('a later override prevents the soft-delete write', async () => {
		const ctx = createContext();
		const client = better(ctx.raw, {
			plugins: [
				softDelete(),
				definePlugin({
					id: 'delete-override',
					hooks: {
						beforeDelete() {
							return kind === 'delete' ? null : { count: 0 };
						},
					},
				}),
			],
		});
		try {
			const before = ctx.snapshot();
			const result = await client.records[kind]({ where: { id: 1 } });
			expect(result).toEqual(kind === 'delete' ? null : { count: 0 });
			expect(ctx.snapshot()).toEqual(before);
			expect(ctx.queries).toEqual([]);
		} finally {
			ctx.sqlite.close();
		}
	});

	test('a later intercept can reject without a soft-delete write', async () => {
		const ctx = createContext();
		const client = better(ctx.raw, {
			plugins: [
				softDelete(),
				definePlugin({
					id: 'intercept-guard',
					intercept(operation) {
						if (operation.kind === kind)
							throw new Error('intercept rejected delete');
						return operation.next();
					},
				}),
			],
		});
		try {
			const before = ctx.snapshot();
			await expect(
				client.records[kind]({ where: { id: 1 } }),
			).rejects.toThrow('intercept rejected delete');
			expect(ctx.snapshot()).toEqual(before);
			expect(ctx.queries).toEqual([]);
		} finally {
			ctx.sqlite.close();
		}
	});

	test('uses the final where clause after plugin transforms', async () => {
		const ctx = createContext();
		const client = better(ctx.raw, {
			plugins: [
				softDelete(),
				definePlugin({
					id: 'redirect-delete',
					transform(operation) {
						if (operation.kind === kind)
							operation.where = {
								id: 2,
							} as typeof operation.where;
					},
				}),
			],
		});
		try {
			await client.records[kind]({ where: { id: 1 } });
			const rows = ctx.snapshot() as {
				id: number;
				deletedAt: number | null;
			}[];
			expect(rows[0]?.deletedAt).toBeNull();
			expect(rows[1]?.deletedAt).toBeNumber();
		} finally {
			ctx.sqlite.close();
		}
	});

	test('a rejected delete caught inside a transaction leaves rows live', async () => {
		const ctx = createContext();
		const client = better(ctx.raw, {
			plugins: [
				softDelete(),
				definePlugin({
					id: 'transaction-delete-guard',
					hooks: {
						beforeDelete() {
							throw new Error('delete forbidden');
						},
					},
				}),
			],
		});
		try {
			const before = ctx.snapshot();
			await client.transaction(async (tx) => {
				await expect(
					tx.records[kind]({ where: { id: 1 } }),
				).rejects.toThrow('delete forbidden');
			});
			expect(ctx.snapshot()).toEqual(before);
		} finally {
			ctx.sqlite.close();
		}
	});

	test.each([false, true])(
		'successful deletes invalidate cache with cache first %s',
		async (cacheFirst) => {
			const ctx = createContext();
			const memory = createMemoryStore();
			const calls: string[] = [];
			const deletion = softDelete();
			const caching = cache({ store: memory.store, ttl: 60 });
			const client = better(ctx.raw, {
				plugins: cacheFirst ? [caching, deletion] : [deletion, caching],
				hooks: {
					beforeDelete() {
						expect(ctx.queries).toEqual([]);
						calls.push('beforeDelete');
					},
					afterDelete() {
						calls.push('afterDelete');
					},
				},
			});
			try {
				expect(await client.records.count({ cache: true })).toBe(2);
				ctx.queries.length = 0;
				const result = await client.records[kind]({
					where: { id: 1 },
					deletedBy: 'admin',
				});
				expect(calls).toEqual(['beforeDelete', 'afterDelete']);
				expect(
					kind === 'delete' ? result : result.data?.[0],
				).toMatchObject({
					id: 1,
					deletedById: 'admin',
					deletedAt: expect.any(Date),
				});
				expect(await client.records.count({ cache: true })).toBe(1);
				ctx.queries.length = 0;
				expect(await client.records.count({ cache: true })).toBe(1);
				expect(ctx.queries).toEqual([]);
			} finally {
				ctx.sqlite.close();
			}
		},
	);
});
