import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestContext, type TestContext } from './setup';

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

describe('scalar where - equality', () => {
	test('simple equality filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { name: 'Alice' },
		});
		expect(result.length).toBe(1);
		expect(result[0]?.name).toBe('Alice');
	});

	test('equality filter with null', async () => {
		const result = await ctx.better.users.findMany({
			where: { email: null },
		});
		expect(result.length).toBe(0);
	});

	test('equals filter object', async () => {
		const result = await ctx.better.users.findMany({
			where: { name: { equals: 'Bob' } },
		});
		expect(result.length).toBe(1);
		expect(result[0]?.name).toBe('Bob');
	});

	test('equals null filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { email: { equals: null } },
		});
		expect(result.length).toBe(0);
	});
});

describe('scalar where - comparison', () => {
	test('gt filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { age: { gt: 30 } },
		});
		expect(result.length).toBe(1);
		expect(result[0]?.name).toBe('Charlie');
	});

	test('gte filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { age: { gte: 30 } },
		});
		expect(result.length).toBe(2);
	});

	test('lt filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { age: { lt: 25 } },
		});
		expect(result.length).toBe(1);
		expect(result[0]?.name).toBe('Eve');
	});

	test('lte filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { age: { lte: 25 } },
		});
		expect(result.length).toBe(2);
	});

	test('in filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { id: { in: [1, 2, 3] } },
		});
		expect(result.length).toBe(3);
	});

	test('notIn filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { id: { notIn: [1, 2] } },
		});
		expect(result.length).toBe(3);
	});
});

describe('scalar where - string', () => {
	test('contains filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { name: { contains: 'li' } },
		});
		expect(result.length).toBe(2);
		expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Charlie']);
	});

	test('startsWith filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { name: { startsWith: 'A' } },
		});
		expect(result.length).toBe(1);
		expect(result[0]?.name).toBe('Alice');
	});

	test('endsWith filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { name: { endsWith: 'e' } },
		});
		expect(result.length).toBe(3);
	});
});

describe('scalar where - negation', () => {
	test('not with simple value', async () => {
		const result = await ctx.better.users.findMany({
			where: { name: { not: 'Alice' } },
		});
		expect(result.length).toBe(4);
		expect(result.every((u) => u.name !== 'Alice')).toBe(true);
	});

	test('not with equals', async () => {
		const result = await ctx.better.users.findMany({
			where: { name: { not: { equals: 'Bob' } } },
		});
		expect(result.length).toBe(4);
	});

	test('not with in filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { id: { not: { in: [1, 2] } } },
		});
		expect(result.length).toBe(3);
	});
});

describe('logical operators', () => {
	test('AND', async () => {
		const result = await ctx.better.users.findMany({
			where: { AND: [{ active: true }, { age: { gte: 30 } }] },
		});
		expect(result.length).toBe(1);
		expect(result[0]?.name).toBe('Bob');
	});

	test('OR', async () => {
		const result = await ctx.better.users.findMany({
			where: { OR: [{ name: 'Alice' }, { name: 'Bob' }] },
		});
		expect(result.length).toBe(2);
	});

	test('NOT', async () => {
		const result = await ctx.better.users.findMany({
			where: { NOT: { active: true } },
		});
		expect(result.length).toBe(2);
		expect(result.every((u) => !u.active)).toBe(true);
	});

	test('NOT with array', async () => {
		const result = await ctx.better.users.findMany({
			where: { NOT: [{ name: 'Alice' }, { name: 'Bob' }] },
		});
		expect(result.length).toBe(3);
	});

	test('combined AND + OR', async () => {
		const result = await ctx.better.users.findMany({
			where: {
				AND: [{ active: true }],
				OR: [{ name: 'Alice' }, { name: 'Bob' }],
			},
		});
		expect(result.length).toBe(2);
		expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Bob']);
	});
});

describe('relation where - One', () => {
	test('author is (simple equality)', async () => {
		const result = await ctx.better.posts.findMany({
			where: { author: { is: { name: 'Alice' } } },
		});
		expect(result.length).toBe(2);
		expect(result.every((p) => p.userId === 1)).toBe(true);
	});

	test('author is null', async () => {
		const result = await ctx.better.comments.findMany({
			where: { author: { is: null } },
		});
		expect(result.length).toBe(0);
	});

	test('author isNot', async () => {
		const result = await ctx.better.posts.findMany({
			where: { author: { isNot: { name: 'Alice' } } },
		});
		expect(result.length).toBe(4);
		expect(result.every((p) => p.userId !== 1)).toBe(true);
	});

	test('author isNot null', async () => {
		const result = await ctx.better.posts.findMany({
			where: { author: { isNot: null } },
		});
		expect(result.length).toBe(6);
	});

	test('post is (for comment)', async () => {
		const result = await ctx.better.comments.findMany({
			where: { post: { is: { title: 'First Post' } } },
		});
		expect(result.length).toBe(2);
		expect(result.every((c) => c.postId === 1)).toBe(true);
	});
});

describe('relation where - Many', () => {
	const names = (rows: { name: string }[]) =>
		rows.map((row) => row.name).sort();

	test('posts some - users with at least one published post', async () => {
		const result = await ctx.better.users.findMany({
			where: { posts: { some: { published: true } } },
		});
		// Alice (1 published, 1 draft), Bob (2 published), Diana (1 published).
		// Charlie has only a draft and Eve has no posts.
		expect(names(result)).toEqual(['Alice', 'Bob', 'Diana']);
	});

	test('posts every - users whose posts are all published', async () => {
		const result = await ctx.better.users.findMany({
			where: { posts: { every: { published: true } } },
		});
		// Eve qualifies vacuously: she has no posts to violate the predicate.
		expect(names(result)).toEqual(['Bob', 'Diana', 'Eve']);
	});

	test('posts none - users with no published post', async () => {
		const result = await ctx.better.users.findMany({
			where: { posts: { none: { published: true } } },
		});
		expect(names(result)).toEqual(['Charlie', 'Eve']);
	});

	test('posts none - users with no posts at all', async () => {
		const result = await ctx.better.users.findMany({
			where: { posts: { none: {} } },
		});
		expect(names(result)).toEqual(['Eve']);
	});

	test('relation filters correlate on the parent row', async () => {
		// A published post exists in the fixture, so an uncorrelated EXISTS would
		// return every user instead of only those who own one.
		const total = await ctx.better.users.count();
		const result = await ctx.better.users.findMany({
			where: { posts: { some: { published: true } } },
		});
		expect(result.length).toBeLessThan(total);
	});

	test('relation filter correlates when the same relation is included', async () => {
		// An include routes the query through the relational query builder, which
		// aliases the base table (from "test_users" "users"). The filter's
		// correlation must reference that alias; referencing the raw table name
		// throws "no such column: test_users.id".
		const result = await ctx.better.users.findMany({
			include: { posts: true },
			where: { posts: { some: { published: true } } },
		});
		expect(names(result)).toEqual(['Alice', 'Bob', 'Diana']);
		// The include still loaded the relation.
		const alice = result.find((row) => row.name === 'Alice') as
			| { posts?: unknown[] }
			| undefined;
		expect(alice?.posts?.length).toBeGreaterThan(0);
	});
});

describe('where with orderBy', () => {
	test('where + orderBy ascending', async () => {
		const result = await ctx.better.users.findMany({
			where: { active: true },
			orderBy: [{ age: 'asc' }],
		});
		expect(result.length).toBe(3);
		for (let i = 1; i < result.length; i++)
			expect(result[i]?.age).toBeGreaterThanOrEqual(
				result[i - 1]?.age ?? 0,
			);
	});

	test('where + orderBy descending', async () => {
		const result = await ctx.better.users.findMany({
			where: { active: false },
			orderBy: [{ age: 'desc' }],
		});
		expect(result.length).toBe(2);
		for (let i = 1; i < result.length; i++)
			expect(result[i]?.age).toBeLessThanOrEqual(result[i - 1]?.age ?? 0);
	});
});

describe('JSONB where', () => {
	test('rejects JSONB path filters outside PostgreSQL', async () => {
		await expect(
			ctx.better.users.findMany({
				where: { name: { json: { 'profile.age': { gte: 18 } } } },
			} as never),
		).rejects.toMatchObject({
			code: 'JSONB_QUERY_UNSUPPORTED',
			dialect: 'sqlite',
		});
	});
});
