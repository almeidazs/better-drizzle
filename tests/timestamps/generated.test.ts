import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';
import { ata } from '../../src/plugins/ata';
import { timestamps } from '../../src/plugins/timestamps';
import { zod } from '../../src/plugins/zod';

const posts = sqliteTable('generated_timestamp_posts', {
	id: integer().primaryKey(),
	title: text().notNull(),
	createdAt: integer({ mode: 'timestamp' }).notNull(),
	updatedAt: integer({ mode: 'timestamp' }).notNull(),
});

const legacy = sqliteTable('generated_timestamp_legacy', {
	id: integer().primaryKey(),
	createdOn: integer({ mode: 'timestamp' }).notNull(),
	updatedOn: integer({ mode: 'timestamp' }).notNull(),
});

const numeric = sqliteTable('generated_timestamp_numeric', {
	id: integer().primaryKey(),
	createdAt: integer().notNull(),
});

const partial = sqliteTable('generated_timestamp_partial', {
	id: integer().primaryKey(),
	createdOn: integer({ mode: 'timestamp' }).notNull(),
});

const createContext = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE generated_timestamp_posts (
			id INTEGER PRIMARY KEY,
			title TEXT NOT NULL,
			createdAt INTEGER NOT NULL,
			updatedAt INTEGER NOT NULL
		);
		CREATE TABLE generated_timestamp_legacy (
			id INTEGER PRIMARY KEY,
			createdOn INTEGER NOT NULL,
			updatedOn INTEGER NOT NULL
		);
		CREATE TABLE generated_timestamp_numeric (
			id INTEGER PRIMARY KEY,
			createdAt INTEGER NOT NULL
		);
		CREATE TABLE generated_timestamp_partial (
			id INTEGER PRIMARY KEY,
			createdOn INTEGER NOT NULL
		);
	`);
	return {
		close: () => sqlite.close(),
		db: drizzle({
			client: sqlite,
			relations: defineRelations({ legacy, numeric, partial, posts }),
		}),
	};
};

describe('timestamps generated columns', () => {
	const now = new Date('2026-01-02T03:04:05.000Z');
	const validator = {
		ata: () => ata(),
		zod: () => zod({ validate: { create: true } }),
	};

	for (const name of ['ata', 'zod'] as const)
		for (const first of [true, false])
			test(`${name} validates create with timestamps ${first ? 'after' : 'before'} it`, async () => {
				const ctx = createContext();
				try {
					const clock = timestamps({ now: () => now });
					const check = validator[name]();
					const client = better(ctx.db, {
						plugins: first ? [check, clock] : [clock, check],
					});
					const row = await client.posts.create({
						data: { id: 1, title: 'First' },
						validate: true,
					});
					expect(row?.createdAt).toEqual(now);
					expect(row?.updatedAt).toEqual(now);
				} finally {
					ctx.close();
				}
			});

	test('respects model column overrides and disabled models', async () => {
		const ctx = createContext();
		try {
			const client = better(ctx.db, {
				plugins: [
					zod({ validate: { create: true } }),
					timestamps({
						models: {
							legacy: {
								createdAt: 'createdOn',
								updatedAt: 'updatedOn',
							},
							posts: false,
						},
						now: () => now,
					}),
				],
			});
			expect(
				client.posts.$zod.create.safeParse({ id: 1, title: 'A' })
					.success,
			).toBe(false);
			const row = await client.legacy.create({ data: { id: 1 } });
			expect(row?.createdOn).toEqual(now);
			expect(row?.updatedOn).toEqual(now);
		} finally {
			ctx.close();
		}
	});

	test('database mode keeps required timestamps required', () => {
		const ctx = createContext();
		try {
			const client = better(ctx.db, {
				plugins: [zod(), timestamps({ mode: 'database' })],
			});
			expect(
				client.posts.$zod.create.safeParse({ id: 1, title: 'A' })
					.success,
			).toBe(false);
		} finally {
			ctx.close();
		}
	});

	test('does not mark unsupported column types as generated', () => {
		const ctx = createContext();
		try {
			const client = better(ctx.db, {
				plugins: [zod(), timestamps()],
			});
			expect(
				client.numeric.$zod.create.safeParse({ id: 1 }).success,
			).toBe(false);
		} finally {
			ctx.close();
		}
	});

	test('allows a partial override when the other default column is absent', async () => {
		const ctx = createContext();
		try {
			const client = better(ctx.db, {
				plugins: [
					zod({ validate: { create: true } }),
					timestamps({
						models: { partial: { createdAt: 'createdOn' } },
						now: () => now,
					}),
				],
			});
			const row = await client.partial.create({ data: { id: 1 } });
			expect(row?.createdOn).toEqual(now);
		} finally {
			ctx.close();
		}
	});
});
