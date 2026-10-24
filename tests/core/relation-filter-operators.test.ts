import { expect, test } from 'bun:test';

import { createTenantDb } from '../tenant/fixture';
import { createTestContext } from './setup';

test.each([
	[{ every: {} }, [1, 2, 3, 4, 5]],
	[{ some: { published: true }, none: { published: false } }, [2, 4]],
	[{ some: {}, every: {} }, [1, 2, 3, 4]],
	[{ none: {}, every: {} }, [5]],
	[{ some: { published: true }, every: {} }, [1, 2, 4]],
	[
		{ some: { published: true }, none: undefined, every: undefined },
		[1, 2, 4],
	],
	[
		{
			some: { published: true },
			none: { published: false },
			every: { score: { gt: 0 } },
		},
		[2, 4],
	],
] as const)(
	'many relation operators %j preserve empty and omitted predicates',
	async (posts, expected) => {
		const ctx = createTestContext();
		try {
			const where = { posts };
			const args = { where, orderBy: { id: 'asc' as const } };
			expect(
				(await ctx.better.users.findMany(args)).map((row) => row.id),
			).toEqual([...expected]);
			expect(await ctx.better.users.count({ where })).toBe(
				expected.length,
			);
			expect(await ctx.better.users.exists({ where })).toBe(
				expected.length > 0,
			);
			expect(
				(
					await ctx.better.users
						.findMany(args)
						.prepare('relation_operators')
						.execute()
				).map((row) => row.id),
			).toEqual([...expected]);
		} finally {
			ctx.close();
		}
	},
);

test('one relation operators ignore undefined and combine null checks', async () => {
	const ctx = createTestContext();
	try {
		expect(
			(
				await ctx.better.posts.findMany({
					where: {
						author: { is: { active: true }, isNot: { id: 1 } },
					},
					orderBy: { id: 'asc' },
				})
			).map((row) => row.id),
		).toEqual([3, 4, 6]);
		expect(
			(
				await ctx.better.posts.findMany({
					where: { author: { is: undefined, isNot: { id: 1 } } },
					orderBy: { id: 'asc' },
				})
			).map((row) => row.id),
		).toEqual([3, 4, 5, 6]);
		expect(
			await ctx.better.posts.count({
				where: { author: { is: null, isNot: null } },
			}),
		).toBe(0);
	} finally {
		ctx.close();
	}
});

test('empty every preserves matching rows in nested reads and batch writes', async () => {
	const ctx = createTestContext();
	try {
		const where = { posts: { some: {}, every: {} } };
		const rows = await ctx.better.users.findMany({
			include: { posts: { where: { author: { is: where } } } },
			orderBy: { id: 'asc' },
		});
		expect(rows.map((row) => row.posts.map((post) => post.id))).toEqual([
			[1, 2],
			[3, 4],
			[5],
			[6],
			[],
		]);
		expect(
			(await ctx.better.users.updateMany({ where, data: { age: 99 } }))
				.count,
		).toBe(4);
		expect(
			(
				await ctx.better.users.findMany({
					where: { age: 99 },
					orderBy: { id: 'asc' },
				})
			).map((row) => row.id),
		).toEqual([1, 2, 3, 4]);
	} finally {
		ctx.close();
	}
});

test('many-to-many operator combinations preserve tenant scope on reads and writes', async () => {
	const ctx = createTenantDb();
	try {
		const db = ctx.db.$tenant({ organizationId: 'a' });
		for (const members of [
			{ every: {} },
			{ some: {}, every: {} },
			{ some: {}, none: undefined, every: undefined },
			{
				some: { name: 'a-m1' },
				none: { name: 'b-m1' },
				every: { organizationId: 'a' },
			},
		]) {
			const rows = await db.projects.findMany({
				where: { members },
				orderBy: { id: 'asc' },
			});
			expect(rows.map((row) => row.id)).toEqual(
				'some' in members ? [1] : [1, 2],
			);
		}
		const where = { members: { some: {}, every: {} } };
		expect(
			(await db.projects.updateMany({ where, data: { name: 'updated' } }))
				.count,
		).toBe(1);
		expect((await db.projects.deleteMany({ where })).count).toBe(1);
		expect((await db.projects.findMany()).map((row) => row.id)).toEqual([
			2,
		]);
		expect(
			ctx.sqlite.query('SELECT name FROM t_projects WHERE id = 3').get(),
		).toEqual({ name: 'b-p1' });
	} finally {
		ctx.sqlite.close();
	}
});
