import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { drizzle } from 'drizzle-orm/bun-sqlite';

import {
	better,
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	definePlugin,
	param,
} from '../../src';
import { createTestContext, type TestContext } from './setup';

const rejectCode = async (promise: PromiseLike<unknown>) => {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(BetterDrizzleError);
		return (error as BetterDrizzleError).code;
	}
	throw new Error('Expected a rejection.');
};

describe('prepared statements', () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.close();
	});

	test('findUnique matches the regular read for every value', async () => {
		const byEmail = ctx.better.users
			.findUnique({ where: { email: param('email') } })
			.prepare('users.by-email');

		expect(byEmail.name).toBe('users.by-email');
		for (const user of ctx.seed.users)
			expect(await byEmail.execute({ email: user.email })).toEqual(
				await ctx.better.users.findUnique({
					where: { email: user.email },
				}),
			);
		expect(
			await byEmail.execute({ email: 'nobody@example.com' }),
		).toBeNull();
	});

	test('case-insensitive LIKE params', async () => {
		ctx.sqlite.exec('PRAGMA case_sensitive_like = ON');
		const search = ctx.better.users
			.findMany({
				orderBy: { id: 'asc' },
				where: {
					email: { endsWith: param('domain'), mode: 'insensitive' },
					name: { startsWith: param('prefix'), mode: 'insensitive' },
				},
			})
			.prepare();

		expect(
			(await search.execute({ domain: 'EXAMPLE.COM', prefix: 'a' })).map(
				(user) => user.name,
			),
		).toEqual(['Alice']);
		expect(
			await search.execute({ domain: 'EXAMPLE.COM', prefix: 'zz' }),
		).toEqual([]);
	});

	test('execute().throw() rejects when no row matches', async () => {
		const byId = ctx.better.users
			.findFirst({ where: { id: param('id') } })
			.prepare();

		expect((await byId.execute({ id: 2 }).throw()).name).toBe('Bob');
		expect(await rejectCode(byId.execute({ id: 99 }).throw())).toBe(
			BetterDrizzleErrorCode.ResultNotFound,
		);
	});

	test('scalar operators, combinators, and relation filters bind params', async () => {
		const search = ctx.better.users
			.findMany({
				orderBy: { id: 'asc' },
				where: {
					OR: [
						{ age: { gte: param('minAge'), lt: param('maxAge') } },
						{ name: { startsWith: param('prefix') } },
					],
					email: { endsWith: param('domain') },
					NOT: { name: { contains: param('excluded') } },
					posts: { some: { score: { gte: param('minScore') } } },
				},
			})
			.prepare();
		const values = [
			{
				domain: '@example.com',
				excluded: 'zzz',
				maxAge: 31,
				minAge: 25,
				minScore: 10,
				prefix: 'D',
			},
			{
				domain: 'example.com',
				excluded: 'li',
				maxAge: 40,
				minAge: 20,
				minScore: 30,
				prefix: 'C',
			},
		];

		for (const value of values)
			expect(await search.execute(value)).toEqual(
				await ctx.better.users.findMany({
					orderBy: { id: 'asc' },
					where: {
						OR: [
							{ age: { gte: value.minAge, lt: value.maxAge } },
							{ name: { startsWith: value.prefix } },
						],
						email: { endsWith: value.domain },
						NOT: { name: { contains: value.excluded } },
						posts: { some: { score: { gte: value.minScore } } },
					},
				}),
			);
	});

	test('take and skip accept params', async () => {
		const page = ctx.better.posts
			.findMany({
				orderBy: { id: 'asc' },
				skip: param('skip'),
				take: param('take'),
			})
			.prepare();

		expect(
			(await page.execute({ skip: 1, take: 2 })).map((post) => post.id),
		).toEqual([2, 3]);
		expect(
			(await page.execute({ skip: 4, take: 5 })).map((post) => post.id),
		).toEqual([5, 6]);
	});

	test('relations load per execution while the root query is prepared', async () => {
		const withPosts = ctx.better.users
			.findMany({
				include: {
					_count: {
						select: {
							posts: { where: { published: param('published') } },
						},
					},
					posts: { orderBy: { id: 'asc' } },
				},
				orderBy: { id: 'asc' },
				where: { active: param('active') },
			})
			.prepare();

		for (const active of [true, false])
			for (const published of [true, false])
				expect(await withPosts.execute({ active, published })).toEqual(
					await ctx.better.users.findMany({
						include: {
							_count: {
								select: { posts: { where: { published } } },
							},
							posts: { orderBy: { id: 'asc' } },
						},
						orderBy: { id: 'asc' },
						where: { active },
					}),
				);
	});

	test('relation filters compile into the prepared root query', async () => {
		const byAuthor = ctx.better.posts
			.findMany({
				include: { author: true },
				orderBy: { id: 'asc' },
				where: { author: { is: { name: param('author') } } },
			})
			.prepare();

		expect(await byAuthor.execute({ author: 'Alice' })).toEqual(
			await ctx.better.posts.findMany({
				include: { author: true },
				orderBy: { id: 'asc' },
				where: { author: { is: { name: 'Alice' } } },
			}),
		);
	});

	test('select projections prepare with params', async () => {
		const names = ctx.better.users
			.findMany({
				orderBy: { id: 'asc' },
				select: { name: true, posts: { select: { title: true } } },
				where: { age: { gt: param('age') } },
			})
			.prepare();

		expect(await names.execute({ age: 26 })).toEqual(
			await ctx.better.users.findMany({
				orderBy: { id: 'asc' },
				select: { name: true, posts: { select: { title: true } } },
				where: { age: { gt: 26 } },
			}),
		);
	});

	test('count and exists', async () => {
		const count = ctx.better.posts
			.count({ where: { score: { gte: param('score') } } })
			.prepare();
		const exists = ctx.better.users
			.exists({ where: { email: param('email') } })
			.prepare();

		expect(await count.execute({ score: 30 })).toBe(4);
		expect(await count.execute({ score: 100 })).toBe(0);
		expect(await exists.execute({ email: 'bob@example.com' })).toBe(true);
		expect(await exists.execute({ email: 'nobody@example.com' })).toBe(
			false,
		);
	});

	test('statements without params execute without values', async () => {
		const all = ctx.better.users
			.findMany({ orderBy: { id: 'asc' } })
			.prepare();

		expect(await all.execute()).toEqual(
			await ctx.better.users.findMany({ orderBy: { id: 'asc' } }),
		);
	});

	test('paginate resolves page, perPage, and skip params', async () => {
		const byPage = ctx.better.posts
			.paginate({
				orderBy: { id: 'asc' },
				page: param('page'),
				perPage: param('perPage'),
				where: { published: param('published') },
			})
			.prepare();
		const fixedSize = ctx.better.posts
			.paginate({
				orderBy: { id: 'asc' },
				page: param('page'),
				perPage: 2,
			})
			.prepare();
		const bySkip = ctx.better.posts
			.paginate({ limit: 2, orderBy: { id: 'asc' }, skip: param('skip') })
			.prepare();

		for (const page of [1, 2, 3])
			for (const perPage of [1, 2])
				expect(
					await byPage.execute({ page, perPage, published: true }),
				).toEqual(
					await ctx.better.posts.paginate({
						orderBy: { id: 'asc' },
						page,
						perPage,
						where: { published: true },
					}),
				);
		expect(await fixedSize.execute({ page: 2 })).toEqual(
			await ctx.better.posts.paginate({
				orderBy: { id: 'asc' },
				page: 2,
				perPage: 2,
			}),
		);
		expect(await bySkip.execute({ skip: 3 })).toEqual(
			await ctx.better.posts.paginate({
				limit: 2,
				orderBy: { id: 'asc' },
				skip: 3,
			}),
		);
		expect(await rejectCode(fixedSize.execute({ page: 0 }))).toBe(
			BetterDrizzleErrorCode.OperationError,
		);
	});

	test('cursor walks the same pages as the regular cursor()', async () => {
		const next = ctx.better.posts
			.cursor({ after: param('after'), limit: param('limit') })
			.prepare();
		const previous = ctx.better.posts
			.cursor({ before: param('before'), limit: 2 })
			.prepare();
		let cursor = (await ctx.better.posts.cursor({ limit: 2 })).pagination
			.nextCursor as { id: number } | null;

		while (cursor) {
			const page = await next.execute({ after: cursor, limit: 2 });
			expect(page).toEqual(
				await ctx.better.posts.cursor({ after: cursor, limit: 2 }),
			);
			expect(await previous.execute({ before: cursor })).toEqual(
				await ctx.better.posts.cursor({ before: cursor, limit: 2 }),
			);
			cursor = page.pagination.nextCursor as { id: number } | null;
		}
		expect(
			await rejectCode(next.execute({ after: null as never, limit: 2 })),
		).toBe(BetterDrizzleErrorCode.OperationError);
	});

	test('cursor with a composite order and filters', async () => {
		const ordered = ctx.better.posts
			.cursor({
				after: param('after'),
				limit: 2,
				orderBy: [{ score: 'desc' }, { id: 'asc' }],
				where: { score: { lte: param('max') } },
			})
			.prepare();
		const after = { id: 5, score: 50 };

		expect(await ordered.execute({ after, max: 60 })).toEqual(
			await ctx.better.posts.cursor({
				after,
				limit: 2,
				orderBy: [{ score: 'desc' }, { id: 'asc' }],
				where: { score: { lte: 60 } },
			}),
		);
	});

	test('missing and unknown values reject with their own codes', async () => {
		const byEmail = ctx.better.users
			.findUnique({ where: { email: param('email') } })
			.prepare();

		expect(await rejectCode(byEmail.execute({} as never))).toBe(
			BetterDrizzleErrorCode.PreparedParamMissing,
		);
		expect(
			await rejectCode(
				byEmail.execute({
					email: 'alice@example.com',
					extra: 1,
				} as never),
			),
		).toBe(BetterDrizzleErrorCode.PreparedParamUnknown);
	});

	test('unsupported shapes fail at prepare', () => {
		const prepareInList = () =>
			ctx.better.users
				.findMany({ where: { id: { in: param('ids') } } })
				.prepare();
		const prepareNested = () =>
			ctx.better.users
				.findMany({
					include: {
						posts: { where: { score: { gt: param('score') } } },
					},
				})
				.prepare();

		for (const prepare of [prepareInList, prepareNested])
			try {
				prepare();
				throw new Error('Expected prepare() to throw.');
			} catch (error) {
				expect((error as BetterDrizzleError).code).toBe(
					BetterDrizzleErrorCode.PreparedUnsupported,
				);
			}
	});

	test('explain fills the statement with values', async () => {
		const byEmail = ctx.better.users
			.findUnique({ where: { email: param('email') } })
			.prepare();
		const plan = await byEmail.explain({ email: 'alice@example.com' });

		expect(plan.operation).toBe('findUnique');
		expect(plan.statements[0]?.params).toEqual(['alice@example.com', 1]);
		expect(await rejectCode(byEmail.explain({} as never))).toBe(
			BetterDrizzleErrorCode.PreparedParamMissing,
		);
	});

	test('a statement prepared in a transaction sees its writes', async () => {
		await ctx.better.transaction(async (tx) => {
			const byEmail = tx.users
				.findUnique({ where: { email: param('email') } })
				.prepare();
			await tx.users.create({
				data: {
					active: true,
					age: 40,
					email: 'frank@example.com',
					id: 6,
					name: 'Frank',
				},
			});

			expect(
				(await byEmail.execute({ email: 'frank@example.com' }))?.name,
			).toBe('Frank');
		});
	});
});

describe('prepared statements with hooks and plugins', () => {
	test('before hooks and transforms run once; result hooks run per execution', async () => {
		const ctx = createTestContext();
		const calls = {
			after: 0,
			before: 0,
			intercept: [] as unknown[],
			meta: [] as unknown[],
			pluginAfter: 0,
			transform: 0,
		};
		const plugin = definePlugin({
			id: 'prepared-test',
			hooks: {
				afterQuery() {
					calls.pluginAfter += 1;
				},
			},
			intercept(context) {
				calls.intercept.push(context.params);
				return context.next();
			},
			transform(operation) {
				calls.transform += 1;
				operation.where = {
					...(operation.where as object),
					active: true,
				} as typeof operation.where;
				return operation;
			},
		});
		const db = better(
			drizzle({ client: ctx.sqlite, relations: ctx.relations }),
			{
				hooks: {
					afterQuery(context) {
						calls.after += 1;
						calls.meta.push(context.meta);
					},
					beforeQuery() {
						calls.before += 1;
					},
				},
				plugins: [plugin],
			},
		);
		const older = db.users
			.findMany({
				meta: { source: 'prepare' },
				orderBy: { id: 'asc' },
				where: { age: { gte: param('age') } },
			})
			.prepare();

		expect(
			(await older.execute({ age: 25 })).map((user) => user.name),
		).toEqual(['Alice', 'Bob', 'Diana']);
		expect(
			(await older.execute({ age: 29 }, { meta: { request: 2 } })).map(
				(user) => user.name,
			),
		).toEqual(['Bob']);
		expect(calls.transform).toBe(1);
		expect(calls.before).toBe(1);
		expect(calls.after).toBe(2);
		expect(calls.pluginAfter).toBe(2);
		expect(calls.intercept).toEqual([{ age: 25 }, { age: 29 }]);
		expect(calls.meta).toEqual([
			{ source: 'prepare' },
			{ request: 2, source: 'prepare' },
		]);

		const raw = db.users
			.$withoutPlugins()
			.findMany({ where: { age: { gte: param('age') } } })
			.prepare();
		expect(await raw.execute({ age: 30 })).toHaveLength(2);
		expect(calls.transform).toBe(1);
		ctx.close();
	});

	test('a before hook error surfaces on execute', async () => {
		const ctx = createTestContext();
		const db = better(
			drizzle({ client: ctx.sqlite, relations: ctx.relations }),
			{
				hooks: {
					beforeQuery() {
						throw new Error('denied');
					},
				},
			},
		);
		const statement = db.users
			.findUnique({ where: { id: param('id') } })
			.prepare();

		expect(await rejectCode(statement.execute({ id: 1 }))).toBe(
			BetterDrizzleErrorCode.HookError,
		);
		ctx.close();
	});
});
