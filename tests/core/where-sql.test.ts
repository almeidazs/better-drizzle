import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { and, defineRelations, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';
import { softDelete } from '../../src/plugins/soft-delete';
import { createTestContext, type TestContext } from './setup';

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

const ids = (rows: { id: number }[]) => rows.map((row) => row.id).toSorted();

describe('$where', () => {
	test('compiles a typed where for raw Drizzle queries', async () => {
		const { users } = ctx.schema;
		const rows = await ctx.raw
			.select()
			.from(users)
			.where(ctx.better.users.$where({ id: 2 }));

		expect(rows.map((row) => row.name)).toEqual(['Bob']);
	});

	test('matches findMany for logical and operator filters', async () => {
		const { users } = ctx.schema;
		const where = {
			OR: [{ age: { gte: 30 } }, { name: { contains: 'Ali' } }],
			NOT: { active: false },
		};
		const raw = await ctx.raw
			.select()
			.from(users)
			.where(ctx.better.users.$where(where));
		const repo = await ctx.better.users.findMany({ where });

		expect(ids(raw)).toEqual(ids(repo));
		expect(raw.length).toBeGreaterThan(0);
	});

	test('compiles relation filters', async () => {
		const { users } = ctx.schema;
		const where = { posts: { some: { published: true } } };
		const raw = await ctx.raw
			.select()
			.from(users)
			.where(ctx.better.users.$where(where));
		const repo = await ctx.better.users.findMany({ where });

		expect(ids(raw)).toEqual(ids(repo));
		expect(raw.length).toBeGreaterThan(0);
	});

	test('returns undefined for an empty where', () => {
		expect(ctx.better.users.$where()).toBeUndefined();
		expect(ctx.better.users.$where(undefined)).toBeUndefined();
		expect(ctx.better.users.$where({})).toBeUndefined();
	});

	test('passes SQL through', async () => {
		const { users } = ctx.schema;
		const rows = await ctx.raw
			.select()
			.from(users)
			.where(ctx.better.users.$where(eq(users.id, 1)));

		expect(ids(rows)).toEqual([1]);
	});

	test('composes with other conditions, joins, and writes', async () => {
		const { posts, users } = ctx.schema;
		const joined = await ctx.raw
			.select({ title: posts.title })
			.from(posts)
			.innerJoin(users, eq(posts.userId, users.id))
			.where(
				and(
					ctx.better.users.$where({ name: 'Alice' }),
					ctx.better.posts.$where({ published: true }),
				),
			);

		expect(joined.map((row) => row.title)).toEqual(['First Post']);

		await ctx.raw
			.update(users)
			.set({ name: 'Renamed' })
			.where(ctx.better.users.$where({ id: 3 }));

		expect(
			(await ctx.better.users.findUnique({ where: { id: 3 } }))?.name,
		).toBe('Renamed');
	});

	test('does not apply plugin filters', async () => {
		const items = sqliteTable('where_sql_items', {
			deletedAt: integer('deleted_at', { mode: 'timestamp' }),
			id: integer('id').primaryKey(),
		});
		const sqlite = new Database(':memory:');

		sqlite.exec(`
			CREATE TABLE where_sql_items (id INTEGER PRIMARY KEY NOT NULL, deleted_at INTEGER);
			INSERT INTO where_sql_items VALUES (1, NULL), (2, 1710000000);
		`);

		const raw = drizzle({
			client: sqlite,
			relations: defineRelations({ items }),
		});
		const client = better(raw, { plugins: [softDelete()] });
		const rows = await raw
			.select()
			.from(items)
			.where(client.items.$where({}));

		expect(await client.items.findMany()).toHaveLength(1);
		expect(client.items.$where({})).toBeUndefined();
		expect(rows).toHaveLength(2);
		sqlite.close();
	});

	test('is available on transaction and scoped clients', async () => {
		const { users } = ctx.schema;

		expect(
			ctx.better.$withContext({ a: 1 }).users.$where({ id: 1 }),
		).toBeDefined();
		await ctx.better.transaction(async (tx) => {
			const rows = await tx.users.findMany({ where: { id: 1 } });
			const sqlRows = await ctx.raw
				.select()
				.from(users)
				.where(tx.users.$where({ id: 1 }));

			expect(ids(sqlRows)).toEqual(ids(rows));
		});
	});

	test('rejects unknown columns at the type level', () => {
		// @ts-expect-error unknown column
		ctx.better.users.$where({ nope: 1 });
	});
});
