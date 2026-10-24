import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

import { better, param } from '../../src';
import { createTestContext } from './setup';

test.each([undefined, {}, []] as const)(
	'cursor order falls back when orderBy is %j',
	async (orderBy) => {
		const ctx = createTestContext();
		try {
			expect(
				(
					await ctx.better.users.findMany({
						cursor: { age: 25 },
						take: 3,
						orderBy,
					})
				).map((row) => row.id),
			).toEqual([4, 2, 3]);
			expect(
				(
					await ctx.better.users.findMany({
						cursor: { id: 5 },
						take: -2,
						orderBy,
					})
				).map((row) => row.id),
			).toEqual([3, 4]);
		} finally {
			ctx.close();
		}
	},
);

test('backwards cursors retain explicit order, skip, and composite ordering', async () => {
	const ctx = createTestContext();
	try {
		expect(
			(
				await ctx.better.users.findMany({
					cursor: { id: 5 },
					take: -2,
					orderBy: { id: 'asc' },
				})
			).map((row) => row.id),
		).toEqual([3, 4]);
		expect(
			(
				await ctx.better.users.findMany({
					cursor: { id: 2 },
					take: -2,
					orderBy: { id: 'desc' },
				})
			).map((row) => row.id),
		).toEqual([4, 3]);
		expect(
			(
				await ctx.better.users.findMany({
					cursor: { id: 5 },
					skip: 1,
					take: -2,
				})
			).map((row) => row.id),
		).toEqual([2, 3]);
		expect(
			(
				await ctx.better.users.findMany({
					cursor: { age: 30, id: 2 },
					orderBy: [{ age: 'asc' }, { id: 'asc' }],
					take: -2,
				})
			).map((row) => row.id),
		).toEqual([1, 4]);
	} finally {
		ctx.close();
	}
});

test('backwards cursors preserve ordering through joined and batched relation reads', async () => {
	const ctx = createTestContext();
	try {
		const joined = await ctx.better.posts.findMany({
			cursor: { id: 7 },
			take: -2,
			include: { author: true },
		});
		expect(joined.map((row) => row.id)).toEqual([5, 6]);
		const batched = await ctx.better.users.findMany({
			cursor: { id: 5 },
			take: -2,
			include: { posts: true },
		});
		expect(batched.map((row) => row.id)).toEqual([3, 4]);
		const nested = await ctx.better.users.findMany({
			orderBy: { id: 'asc' },
			include: { posts: { cursor: { id: 7 }, take: -2 } },
		});
		expect(nested.map((row) => row.posts.map((post) => post.id))).toEqual([
			[1, 2],
			[3, 4],
			[5],
			[6],
			[],
		]);
	} finally {
		ctx.close();
	}
});

test('prepared backwards cursors preserve root and nested ordering', async () => {
	const ctx = createTestContext();
	try {
		const prepared = ctx.better.users
			.findMany({ cursor: param('cursor'), take: -2 })
			.prepare('backwards_cursor');
		expect(
			(await prepared.execute({ cursor: { id: 5 } })).map(
				(row) => row.id,
			),
		).toEqual([3, 4]);
		const relations = ctx.better.users
			.findMany({
				cursor: { id: 5 },
				take: -2,
				include: { posts: { cursor: { id: 7 }, take: -2 } },
			})
			.prepare('backwards_relations');
		const rows = await relations.execute();
		expect(rows.map((row) => row.id)).toEqual([3, 4]);
		expect(rows.map((row) => row.posts.map((post) => post.id))).toEqual([
			[5],
			[6],
		]);
	} finally {
		ctx.close();
	}
});

test('prepared cursor reads reject a negative take parameter before execution', async () => {
	const ctx = createTestContext();
	try {
		const prepared = ctx.better.users
			.findMany({ cursor: { id: 1 }, take: param('take') })
			.prepare('dynamic_cursor_take');
		expect(
			(await prepared.execute({ take: 2 })).map((row) => row.id),
		).toEqual([2, 3]);
		await expect(prepared.execute({ take: -2 })).rejects.toMatchObject({
			code: 'INVALID_ARGS',
		});
	} finally {
		ctx.close();
	}
});

test('cursor direction preserves explicit NULL placement and dialect defaults', async () => {
	const records = sqliteTable('nullable_cursors', {
		id: integer().primaryKey(),
		value: integer(),
	});
	const sqlite = new Database(':memory:');
	sqlite.exec(
		'CREATE TABLE nullable_cursors(id integer primary key, value integer); INSERT INTO nullable_cursors VALUES (1,NULL),(2,10),(3,20),(4,NULL),(5,30)',
	);
	const db = better(
		drizzle({ client: sqlite, relations: defineRelations({ records }) }),
	);
	try {
		expect(
			(
				await db.records.findMany({ cursor: { value: null }, take: 3 })
			).map((row) => row.id),
		).toEqual([2, 3, 5]);
		expect(
			(
				await db.records.findMany({
					cursor: { value: null, id: 4 },
					take: -3,
					orderBy: [
						{ value: { direction: 'asc', nulls: 'last' } },
						{ id: 'asc' },
					],
				})
			).map((row) => row.id),
		).toEqual([3, 5, 1]);
		expect(
			(
				await db.records.findMany({
					cursor: { value: 20, id: 3 },
					take: -3,
					orderBy: [
						{ value: { direction: 'desc', nulls: 'first' } },
						{ id: 'asc' },
					],
				})
			).map((row) => row.id),
		).toEqual([1, 4, 5]);
	} finally {
		sqlite.close();
	}
});
