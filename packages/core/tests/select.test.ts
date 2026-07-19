import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestContext, type TestContext } from './setup';

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

describe('select - scalar fields', () => {
	test('select specific columns', async () => {
		const result = await ctx.better.users.findMany({
			select: { id: true, name: true },
		});
		expect(result.length).toBe(5);
		for (const row of result) {
			expect(Object.keys(row).sort()).toEqual(['id', 'name']);
		}
	});

	test('select single column', async () => {
		const result = await ctx.better.users.findMany({
			select: { email: true },
		});
		expect(result.length).toBe(5);
		for (const row of result) {
			expect(Object.keys(row)).toEqual(['email']);
		}
	});

	test('select with where', async () => {
		const result = await ctx.better.users.findMany({
			where: { id: 1 },
			select: { id: true, name: true, email: true },
		});
		expect(result.length).toBe(1);
		expect(result[0]).toEqual({
			id: 1,
			name: 'Alice',
			email: 'alice@example.com',
		});
	});

	test('select on posts', async () => {
		const result = await ctx.better.posts.findMany({
			select: { id: true, title: true, score: true },
		});
		expect(result.length).toBe(6);
		for (const row of result) {
			expect(Object.keys(row).sort()).toEqual(['id', 'score', 'title']);
		}
	});
});

describe('select - relations', () => {
	test('select with relation includes author', async () => {
		type PostWithAuthor = { author: { name: string } };

		const result = await ctx.better.posts.findMany({
			where: { id: 1 },
			select: { id: true, title: true, author: true },
		});

		expect(result.length).toBe(1);
		const typed = result[0] as unknown as PostWithAuthor;
		expect(typed.author).toBeDefined();
		expect(typed.author.name).toBe('Alice');
	});

	test('select with relation includes posts', async () => {
		type UserWithPosts = { posts: unknown[] };

		const result = await ctx.better.users.findMany({
			where: { id: 1 },
			select: { name: true, posts: true },
		});

		expect(result.length).toBe(1);
		const typed = result[0] as unknown as UserWithPosts;
		expect(typed.posts).toBeDefined();
		expect(typed.posts.length).toBe(2);
	});
});

describe('include - relations', () => {
	test('include author relation', async () => {
		type PostWithAuthor = { author: { id: number; name: string } };

		const result = await ctx.better.posts.findMany({
			where: { id: 3 },
			include: { author: true },
		});

		expect(result.length).toBe(1);
		const typed = result[0] as unknown as PostWithAuthor;
		expect(typed.author).toBeDefined();
		expect(typed.author.id).toBe(2);
		expect(typed.author.name).toBe('Bob');
	});

	test('include posts relation', async () => {
		type UserWithPosts = { posts: unknown[] };

		const result = await ctx.better.users.findMany({
			where: { id: 1 },
			include: { posts: true },
		});

		expect(result.length).toBe(1);
		const typed = result[0] as unknown as UserWithPosts;
		expect(typed.posts).toBeDefined();
		expect(typed.posts.length).toBe(2);
	});

	test('include comments relation', async () => {
		type PostWithComments = { comments: unknown[] };

		const result = await ctx.better.posts.findMany({
			where: { id: 1 },
			include: { comments: true },
		});

		expect(result.length).toBe(1);
		const typed = result[0] as unknown as PostWithComments;
		expect(typed.comments).toBeDefined();
		expect(typed.comments.length).toBe(2);
	});

	test('include multiple relations', async () => {
		type UserWithRels = { posts: unknown[]; comments: unknown[] };

		const result = await ctx.better.users.findMany({
			where: { id: 1 },
			include: { posts: true, comments: true },
		});

		expect(result.length).toBe(1);
		const typed = result[0] as unknown as UserWithRels;
		expect(typed.posts).toBeDefined();
		expect(typed.comments).toBeDefined();
	});

	test('include with nested select on relation', async () => {
		type UserWithPosts = { posts: unknown[] };

		const result = await ctx.better.users.findMany({
			where: { id: 1 },
			include: { posts: true },
		});

		expect(result.length).toBe(1);
		const typed = result[0] as unknown as UserWithPosts;
		expect(typed.posts.length).toBe(2);
	});

	test('include on findFirst', async () => {
		type UserWithPosts = { posts: unknown[] };

		const result = await ctx.better.users.findFirst({
			where: { id: 1 },
			include: { posts: true },
		});

		expect(result).not.toBeNull();
		const typed = result as unknown as UserWithPosts;
		expect(typed.posts).toBeDefined();
		expect(typed.posts.length).toBe(2);
	});

	test('include on findOne', async () => {
		type UserWithPosts = { posts: unknown[] };

		const result = await ctx.better.users.findOne({
			where: { id: 1 },
			include: { posts: true },
		});

		expect(result).not.toBeNull();
		const typed = result as unknown as UserWithPosts;
		expect(typed.posts).toBeDefined();
	});

	test('include on findUnique', async () => {
		type UserWithPosts = { posts: unknown[] };

		const result = await ctx.better.users.findUnique({
			where: { email: 'alice@example.com' },
			include: { posts: true },
		});

		expect(result).not.toBeNull();
		const typed = result as unknown as UserWithPosts;
		expect(typed.posts).toBeDefined();
	});

	test('include returns empty array when no related records', async () => {
		type UserWithPosts = { posts: unknown[] };

		const result = await ctx.better.users.findFirst({
			where: { id: 5 },
			include: { posts: true },
		});

		expect(result).not.toBeNull();
		const typed = result as unknown as UserWithPosts;
		expect(typed.posts).toEqual([]);
	});

	test('applies filters ordering and pagination per parent', async () => {
		const result = await ctx.better.users.findMany({
			orderBy: { id: 'asc' },
			where: { id: { in: [1, 2] } },
			include: {
				posts: {
					orderBy: { score: 'desc' },
					take: 1,
					where: { published: true },
				},
			},
		});

		expect(result).toHaveLength(2);
		expect(result[0]?.posts.map((post) => post.id)).toEqual([1]);
		expect(result[1]?.posts.map((post) => post.id)).toEqual([4]);
	});

	test('hydrates nested relations without exposing linking columns', async () => {
		const result = await ctx.better.users.findFirst({
			where: { id: 1 },
			select: {
				name: true,
				posts: {
					orderBy: { id: 'asc' },
					select: {
						comments: { select: { body: true } },
						title: true,
					},
				},
			},
		});

		expect(result).toEqual({
			name: 'Alice',
			posts: [
				{
					comments: [{ body: 'Nice post!' }, { body: 'Thanks!' }],
					title: 'First Post',
				},
				{ comments: [], title: 'Second Post' },
			],
		});
	});

	test('rejects select and include at the same level', async () => {
		await expect(
			ctx.better.users.findMany({
				include: { posts: true },
				select: { name: true },
			} as never),
		).rejects.toThrow('select and include cannot be used');
	});
});
