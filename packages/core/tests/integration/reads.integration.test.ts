import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { and, asc, count, eq, gte, sql } from 'drizzle-orm';

import {
	COMMENTS_PER_POST,
	createMassiveContext,
	type MassiveContext,
	POSTS_PER_USER,
	posts,
	USER_COUNT,
	users,
} from './setup';

let ctx: MassiveContext;

beforeEach(() => {
	ctx = createMassiveContext();
});

afterEach(() => {
	ctx.close();
});

describe('massive sqlite reads', () => {
	test('reads the complete seeded dataset', async () => {
		const [userCount, postCount, commentCount] = await Promise.all([
			ctx.client.users.count(),
			ctx.client.posts.count(),
			ctx.client.comments.count(),
		]);

		expect(userCount).toBe(USER_COUNT);
		expect(postCount).toBe(USER_COUNT * POSTS_PER_USER);
		expect(commentCount).toBe(
			USER_COUNT * POSTS_PER_USER * COMMENTS_PER_POST,
		);
	});

	test('matches raw drizzle for compound scalar filters and ordering', async () => {
		const raw = await ctx.raw
			.select()
			.from(users)
			.where(and(eq(users.active, true), gte(users.age, 55)))
			.orderBy(asc(users.age), asc(users.id))
			.limit(40);
		const better = await ctx.client.users.findMany({
			orderBy: [{ age: 'asc' }, { id: 'asc' }],
			take: 40,
			where: { active: true, age: { gte: 55 } },
		});

		expect(better).toEqual(raw);
	});

	test('supports all logical and collection predicates against real rows', async () => {
		const rows = await ctx.client.users.findMany({
			orderBy: { id: 'asc' },
			select: { age: true, id: true },
			where: {
				AND: [
					{ id: { in: [1, 2, 3, 4, 5, 6] } },
					{ id: { notIn: [2, 4, 6] } },
				],
				NOT: { age: { lt: 19 } },
				OR: [{ active: true }, { id: 4 }],
			},
		});

		expect(rows.map((row) => row.id)).toEqual([1, 3, 5]);
	});

	test('returns exact scalar projections without hidden columns', async () => {
		const rows = await ctx.client.users.findMany({
			orderBy: { id: 'asc' },
			select: { email: true, name: true },
			take: 25,
		});

		expect(rows).toHaveLength(25);
		for (const row of rows)
			expect(Object.keys(row).sort()).toEqual(['email', 'name']);
	});

	test('covers first, one, unique and throwing result helpers', async () => {
		const first = await ctx.client.users.findFirst({
			orderBy: { id: 'desc' },
		});
		const one = await ctx.client.users.findOne({ where: { id: 177 } });
		const unique = await ctx.client.users.findUnique({
			where: { email: 'user-177@example.com' },
		});
		const throwing = await ctx.client.users
			.findFirst({ where: { id: 177 } })
			.throw();

		expect(first?.id).toBe(USER_COUNT);
		expect(one).toEqual(unique);
		expect(throwing).toEqual(one);
		await expect(
			ctx.client.users.findUnique({ where: { id: 99_999 } }).throw(),
		).rejects.toThrow();
	});

	test('matches raw count and existence checks', async () => {
		const rawCount = Number(
			(
				await ctx.raw
					.select({ value: count() })
					.from(users)
					.where(and(eq(users.active, true), gte(users.age, 60)))
			)[0]?.value ?? 0,
		);

		expect(
			await ctx.client.users.count({
				where: { active: true, age: { gte: 60 } },
			}),
		).toBe(rawCount);
		expect(
			await ctx.client.users.exists({ where: { id: USER_COUNT } }),
		).toBe(true);
		expect(
			await ctx.client.users.exists({ where: { id: USER_COUNT + 1 } }),
		).toBe(false);
	});

	test('returns honest offset pagination metadata', async () => {
		const result = await ctx.client.users.paginate({
			limit: 37,
			orderBy: { id: 'asc' },
			skip: 74,
		});

		expect(result.data[0]?.id).toBe(75);
		expect(result.data).toHaveLength(37);
		expect(result.pagination).toEqual({
			hasNext: true,
			hasPrevious: true,
			page: 3,
			pageCount: Math.ceil(USER_COUNT / 37),
			perPage: 37,
			total: USER_COUNT,
			type: 'offset',
		});
	});

	test('navigates forward and backward with real cursor probes', async () => {
		const forward = await ctx.client.users.cursor({
			after: { id: 100 },
			limit: 20,
			orderBy: { id: 'asc' },
		});
		const backward = await ctx.client.users.cursor({
			before: { id: 101 },
			limit: 20,
			orderBy: { id: 'asc' },
		});

		expect(forward.data.map((row) => row.id)).toEqual(
			Array.from({ length: 20 }, (_, index) => 101 + index),
		);
		expect(forward.pagination.hasNext).toBe(true);
		expect(forward.pagination.hasPrevious).toBe(true);
		expect(backward.data.map((row) => row.id)).toEqual(
			Array.from({ length: 20 }, (_, index) => 81 + index),
		);
	});

	test('loads to-one, to-many and optional relations', async () => {
		const user = await ctx.client.users.findFirst({
			include: { posts: true, profile: true },
			where: { id: 1 },
		});
		const withoutProfile = await ctx.client.users.findFirst({
			include: { profile: true },
			where: { id: USER_COUNT },
		});
		const post = await ctx.client.posts.findFirst({
			include: { author: true },
			where: { id: 1 },
		});

		expect(user?.posts).toHaveLength(POSTS_PER_USER);
		expect(user?.profile?.bio).toBe('Profile 1');
		expect(withoutProfile?.profile).toBeNull();
		expect(post?.author.id).toBe(1);
	});

	test('projects relation counts in the root query', async () => {
		const database = ctx.sqlite as unknown as {
			prepare: (query: string) => unknown;
		};
		const prepare = database.prepare.bind(database);
		const statements: string[] = [];
		database.prepare = (query) => {
			statements.push(query);
			return prepare(query);
		};

		try {
			const user = await ctx.client.users.findFirst({
				include: {
					_count: {
						select: {
							groups: true,
							posts: { where: { published: true } },
							profile: true,
						},
					},
				},
				where: { id: 1 },
			});

			expect(user?._count).toEqual({ groups: 3, posts: 3, profile: 1 });
			expect(statements).toHaveLength(1);
			expect(statements[0]).toContain('count(*)');
		} finally {
			database.prepare = prepare;
		}
	});

	test('projects filtered counts across the complete seeded dataset', async () => {
		const users = await ctx.client.users.findMany({
			include: {
				_count: {
					select: {
						groups: true,
						posts: { where: { published: true } },
					},
				},
			},
			orderBy: { id: 'asc' },
		});

		expect(users).toHaveLength(USER_COUNT);
		for (const user of users) {
			const firstPostId = (user.id - 1) * POSTS_PER_USER + 1;
			let publishedPosts = 0;
			for (let offset = 0; offset < POSTS_PER_USER; offset += 1)
				if ((firstPostId + offset) % 3 !== 0) publishedPosts += 1;
			expect(user._count.groups).toBe(3);
			expect(user._count.posts).toBe(publishedPosts);
		}
	});

	test('projects counts alongside nested relation loading', async () => {
		const user = await ctx.client.users.findFirst({
			include: {
				_count: { select: { posts: true } },
				posts: {
					include: { _count: { select: { comments: true } } },
					orderBy: { id: 'asc' },
					take: 2,
				},
			},
			where: { id: 1 },
		});

		expect(user?._count.posts).toBe(POSTS_PER_USER);
		expect(user?.posts).toHaveLength(2);
		for (const post of user?.posts ?? [])
			expect(post._count.comments).toBe(COMMENTS_PER_POST);
	});

	test('aliases raw SQL relation count filters', async () => {
		const user = await ctx.client.users.findFirst({
			include: {
				_count: {
					select: {
						posts: { where: sql`${posts.published} = ${true}` },
					},
				},
			},
			where: { id: 1 },
		});

		expect(user?._count.posts).toBe(3);
	});

	test('rejects invalid relation count selections', async () => {
		await expect(
			ctx.client.users.findMany({
				include: { _count: { select: {} } },
			} as never),
		).rejects.toThrow('_count.select must include at least one relation');
		await expect(
			ctx.client.users.findMany({
				include: { _count: { select: { missing: true } } },
			} as never),
		).rejects.toThrow('Unknown relation "missing" in _count');
	});

	test('hydrates a deep graph with per-parent filters and window pagination', async () => {
		const rows = await ctx.client.users.findMany({
			orderBy: { id: 'asc' },
			select: {
				id: true,
				posts: {
					orderBy: { score: 'desc' },
					skip: 1,
					take: 2,
					where: { published: true },
					select: {
						comments: {
							orderBy: { likes: 'desc' },
							select: { body: true, likes: true },
							take: 1,
						},
						title: true,
					},
				},
			},
			take: 30,
		});

		expect(rows).toHaveLength(30);
		for (const user of rows) {
			expect(user.posts.length).toBeLessThanOrEqual(2);
			for (const post of user.posts) {
				expect(Object.keys(post).sort()).toEqual(['comments', 'title']);
				expect(post.comments.length).toBeLessThanOrEqual(1);
			}
		}
	});

	test('loads inferred many-to-many relations with per-parent pagination', async () => {
		const rows = await ctx.client.users.findMany({
			include: {
				groups: { orderBy: { id: 'asc' }, skip: 1, take: 1 },
			},
			orderBy: { id: 'asc' },
			take: 50,
		});

		expect(rows).toHaveLength(50);
		for (const user of rows) expect(user.groups).toHaveLength(1);
	});

	test('filters through one and many relations', async () => {
		const byAuthor = await ctx.client.posts.findMany({
			where: { author: { is: { active: false } } },
		});
		const withPublished = await ctx.client.users.findMany({
			where: { posts: { some: { published: true } } },
		});
		const withNoPosts = await ctx.client.users.findMany({
			where: { posts: { none: {} } },
		});

		expect(byAuthor.length).toBe((USER_COUNT / 4) * POSTS_PER_USER);
		expect(withPublished).toHaveLength(USER_COUNT);
		expect(withNoPosts).toHaveLength(0);
	});

	test('repository lookup and concurrent reads use the same real client', async () => {
		const repository = ctx.client.repository('mass_users');
		const results = await Promise.all(
			Array.from({ length: 40 }, (_, index) =>
				repository.findFirst({ where: { id: index + 1 } }),
			),
		);

		expect(results.map((row) => row?.id)).toEqual(
			Array.from({ length: 40 }, (_, index) => index + 1),
		);
	});

	test('returns a real sqlite explain plan and deferred relation stages', async () => {
		const plan = await ctx.client.users
			.findMany({
				include: {
					posts: { include: { comments: true }, take: 2 },
				},
				where: { active: true },
			})
			.explain();

		expect(plan.driver).toBe('sqlite');
		expect(plan.statements[0]?.raw).toBeArray();
		expect(plan.deferredRelations.map((stage) => stage.path)).toEqual([
			'posts',
			'posts.comments',
		]);
	});

	test('rejects sqlite row locks against a real driver', async () => {
		await expect(
			ctx.client.users.findMany({
				lock: { mode: 'forUpdate' },
				where: { id: 1 },
			}),
		).rejects.toThrow('Row locks are not supported');
	});

	test('raw drizzle and better return identical selected post ids', async () => {
		const raw = await ctx.raw
			.select({ id: posts.id })
			.from(posts)
			.where(gte(posts.score, 700))
			.orderBy(asc(posts.id));
		const better = await ctx.client.posts.findMany({
			orderBy: { id: 'asc' },
			select: { id: true },
			where: { score: { gte: 700 } },
		});

		expect(better).toEqual(raw);
	});
});
