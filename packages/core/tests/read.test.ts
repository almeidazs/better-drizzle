import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';

import { createTestContext, type TestContext } from './setup';

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

describe('findMany', () => {
	test('returns all records when no args', async () => {
		const result = await ctx.better.users.findMany();
		expect(result.length).toBe(5);
	});

	test('findMany with where filter', async () => {
		const result = await ctx.better.users.findMany({
			where: { active: true },
		});
		expect(result.length).toBe(3);
		expect(result.every((u) => u.active)).toBe(true);
	});

	test('findMany with orderBy ascending', async () => {
		const result = await ctx.better.users.findMany({
			orderBy: [{ age: 'asc' }],
		});
		expect(result.length).toBe(5);
		for (let i = 1; i < result.length; i++)
			expect(result[i]?.age).toBeGreaterThanOrEqual(
				result[i - 1]?.age ?? 0,
			);
	});

	test('findMany with orderBy descending', async () => {
		const result = await ctx.better.users.findMany({
			orderBy: [{ age: 'desc' }],
		});
		expect(result.length).toBe(5);
		for (let i = 1; i < result.length; i++)
			expect(result[i]?.age).toBeLessThanOrEqual(result[i - 1]?.age ?? 0);
	});

	test('findMany with take limit', async () => {
		const result = await ctx.better.users.findMany({ take: 2 });
		expect(result.length).toBe(2);
	});

	test('findMany with skip offset', async () => {
		const result = await ctx.better.users.findMany({
			orderBy: [{ id: 'asc' }],
			skip: 2,
			take: 10,
		});
		expect(result.length).toBe(3);
		expect(result[0]?.id).toBe(3);
	});

	test('findMany with take and skip', async () => {
		const result = await ctx.better.users.findMany({
			orderBy: [{ id: 'asc' }],
			take: 2,
			skip: 1,
		});
		expect(result.length).toBe(2);
		expect(result[0]?.id).toBe(2);
		expect(result[1]?.id).toBe(3);
	});

	test('findMany with select returns only selected fields', async () => {
		const result = await ctx.better.users.findMany({
			select: { id: true, name: true },
		});
		expect(result.length).toBe(5);
		for (const row of result) {
			expect(Object.keys(row)).toEqual(['id', 'name']);
		}
	});

	test('findMany with include returns related data', async () => {
		type PostWithAuthor = { author: { id: number; name: string } };

		const result = await ctx.better.posts.findMany({
			where: { id: 1 },
			include: { author: true },
		});

		expect(result.length).toBe(1);
		const typed = result[0] as unknown as PostWithAuthor;
		expect(typed.author).toBeDefined();
		expect(typed.author.id).toBe(1);
		expect(typed.author.name).toBe('Alice');
	});

	test('findMany with empty result', async () => {
		const result = await ctx.better.users.findMany({ where: { id: 9999 } });
		expect(result.length).toBe(0);
	});

	test('findMany with multiple where conditions', async () => {
		const result = await ctx.better.users.findMany({
			where: { active: true, age: { gte: 30 } },
		});
		expect(result.length).toBe(1);
		expect(result[0]?.name).toBe('Bob');
	});
});

describe('findFirst', () => {
	test('returns first record when no args', async () => {
		const result = await ctx.better.users.findFirst();
		expect(result).not.toBeNull();
	});

	test('findFirst with where filter', async () => {
		const result = await ctx.better.users.findFirst({
			where: { email: 'bob@example.com' },
		});
		expect(result).not.toBeNull();
		expect(result?.name).toBe('Bob');
	});

	test('findFirst returns null when no match', async () => {
		const result = await ctx.better.users.findFirst({
			where: { id: 9999 },
		});
		expect(result).toBeNull();
	});

	test('findFirst with orderBy returns first in order', async () => {
		const result = await ctx.better.users.findFirst({
			orderBy: [{ age: 'desc' }],
		});
		expect(result).not.toBeNull();
		expect(result?.name).toBe('Charlie');
	});

	test('findFirst with select returns only selected fields', async () => {
		const result = await ctx.better.users.findFirst({
			where: { id: 1 },
			select: { id: true, email: true },
		});
		expect(result).toEqual({ id: 1, email: 'alice@example.com' });
	});

	test('findFirst with include returns related data', async () => {
		type PostWithAuthor = { author: { name: string } };

		const result = await ctx.better.posts.findFirst({
			where: { id: 3 },
			include: { author: true },
		});

		expect(result).not.toBeNull();
		const typed = result as unknown as PostWithAuthor;
		expect(typed.author).toBeDefined();
		expect(typed.author.name).toBe('Bob');
	});
});

describe('findOne', () => {
	test('returns record when found', async () => {
		const result = await ctx.better.users.findOne({ where: { id: 1 } });
		expect(result).not.toBeNull();
		expect(result?.name).toBe('Alice');
	});

	test('findOne returns null when not found', async () => {
		const result = await ctx.better.users.findOne({ where: { id: 9999 } });
		expect(result).toBeNull();
	});

	test('findOne with select', async () => {
		const result = await ctx.better.users.findOne({
			where: { id: 2 },
			select: { id: true, name: true },
		});
		expect(result).toEqual({ id: 2, name: 'Bob' });
	});

	test('findOne with include', async () => {
		type UserWithPosts = { posts: unknown[] };

		const result = await ctx.better.users.findOne({
			where: { id: 1 },
			include: { posts: true },
		});

		expect(result).not.toBeNull();
		const typed = result as unknown as UserWithPosts;
		expect(typed.posts).toBeDefined();
		expect(typed.posts.length).toBe(2);
	});
});

describe('findUnique', () => {
	test('returns record when found by unique field', async () => {
		const result = await ctx.better.users.findUnique({
			where: { email: 'alice@example.com' },
		});
		expect(result).not.toBeNull();
		expect(result?.name).toBe('Alice');
	});

	test('findUnique returns null when not found', async () => {
		const result = await ctx.better.users.findUnique({
			where: { email: 'nonexistent@example.com' },
		});
		expect(result).toBeNull();
	});

	test('findUnique with select', async () => {
		const result = await ctx.better.users.findUnique({
			where: { email: 'bob@example.com' },
			select: { id: true, name: true },
		});
		expect(result).toEqual({ id: 2, name: 'Bob' });
	});

	test('findUnique with include', async () => {
		type UserWithPosts = { posts: unknown[] };

		const result = await ctx.better.users.findUnique({
			where: { email: 'alice@example.com' },
			include: { posts: true },
		});

		expect(result).not.toBeNull();
		const typed = result as unknown as UserWithPosts;
		expect(typed.posts).toBeDefined();
		expect(typed.posts.length).toBe(2);
	});
});

describe('count', () => {
	test('counts all records when no args', async () => {
		const result = await ctx.better.users.count();
		expect(result).toBe(5);
	});

	test('count with where filter', async () => {
		const result = await ctx.better.users.count({
			where: { active: true },
		});
		expect(result).toBe(3);
	});

	test('count returns 0 when no matches', async () => {
		const result = await ctx.better.users.count({ where: { id: 9999 } });
		expect(result).toBe(0);
	});

	test('count on posts table', async () => {
		const result = await ctx.better.posts.count();
		expect(result).toBe(6);
	});

	test('count on comments table', async () => {
		const result = await ctx.better.comments.count();
		expect(result).toBe(5);
	});
});

describe('exists', () => {
	test('returns true when record exists', async () => {
		const result = await ctx.better.users.exists({ where: { id: 1 } });
		expect(result).toBe(true);
	});

	test('returns false when record does not exist', async () => {
		const result = await ctx.better.users.exists({ where: { id: 9999 } });
		expect(result).toBe(false);
	});

	test('exists with complex where', async () => {
		const result = await ctx.better.users.exists({
			where: { active: true, age: { gte: 30 } },
		});
		expect(result).toBe(true);
	});

	test('exists returns true with no args when table has data', async () => {
		const result = await ctx.better.users.exists();
		expect(result).toBe(true);
	});

	test('exists on empty table', async () => {
		await ctx.raw.run(sql`PRAGMA foreign_keys = OFF`);
		await ctx.raw.run(sql`DELETE FROM test_comments`);
		await ctx.raw.run(sql`DELETE FROM test_posts`);
		await ctx.raw.run(sql`DELETE FROM test_users`);
		await ctx.raw.run(sql`PRAGMA foreign_keys = ON`);

		const result = await ctx.better.users.exists();
		expect(result).toBe(false);
	});
});
