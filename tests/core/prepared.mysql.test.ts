import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { BetterDrizzleError, BetterDrizzleErrorCode, param } from '../../src';
import { createMysqlTestContext, type MysqlTestContext } from './setup.mysql';

// Live-MySQL coverage for prepared reads, e.g.
//   MYSQL_URL=mysql://root:root@127.0.0.1:3306/better_drizzle \
//     bun test tests/core/prepared.mysql.test.ts
const MYSQL_URL = process.env.MYSQL_URL;

describe.skipIf(!MYSQL_URL)('prepared statements (mysql)', () => {
	let ctx: MysqlTestContext;

	beforeAll(async () => {
		ctx = await createMysqlTestContext(MYSQL_URL as string);
	});

	afterAll(async () => {
		await ctx?.close();
	});

	test('findUnique and LIKE params match the regular read', async () => {
		const byEmail = ctx.better.users
			.findUnique({ where: { email: param('email') } })
			.prepare();
		const search = ctx.better.users
			.findMany({
				orderBy: { id: 'asc' },
				where: { name: { contains: param('part') } },
			})
			.prepare();

		for (const user of ctx.seed.users)
			expect(await byEmail.execute({ email: user.email })).toEqual(
				await ctx.better.users.findUnique({
					where: { email: user.email },
				}),
			);
		expect(await search.execute({ part: 'li' })).toEqual(
			await ctx.better.users.findMany({
				orderBy: { id: 'asc' },
				where: { name: { contains: 'li' } },
			}),
		);
	});

	test('limit and offset params', async () => {
		const page = ctx.better.posts
			.paginate({
				orderBy: { id: 'asc' },
				page: param('page'),
				perPage: param('perPage'),
			})
			.prepare();

		expect(await page.execute({ page: 2, perPage: 2 })).toEqual(
			await ctx.better.posts.paginate({
				orderBy: { id: 'asc' },
				page: 2,
				perPage: 2,
			}),
		);
	});

	test('cursor pages match the regular cursor()', async () => {
		const next = ctx.better.posts
			.cursor({ after: param('after'), limit: 2 })
			.prepare();
		const after = { id: 2 };

		expect(await next.execute({ after })).toEqual(
			await ctx.better.posts.cursor({ after, limit: 2 }),
		);
	});

	test('list params are PostgreSQL only', () => {
		try {
			ctx.better.users
				.findMany({ where: { id: { in: param('ids') } } })
				.prepare();
			throw new Error('Expected prepare() to throw.');
		} catch (error) {
			expect((error as BetterDrizzleError).code).toBe(
				BetterDrizzleErrorCode.PreparedUnsupported,
			);
		}
	});
});
