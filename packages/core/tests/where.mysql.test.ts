import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createMysqlTestContext, type MysqlTestContext } from './setup.mysql';

// The relation-filter fix in compiler.ts is dialect-agnostic, so the SQLite
// suite already proves the behaviour. This mirror runs the same some/none/every
// assertions against a real MySQL server, covering the one dialect the review
// noted was not exercised. It needs a live database, so it is gated on MYSQL_URL
// and skips when unset, e.g.
//   MYSQL_URL=mysql://root:root@127.0.0.1:3306/better_drizzle \
//     bun test packages/core/tests/where.mysql.test.ts
const MYSQL_URL = process.env.MYSQL_URL;

describe.skipIf(!MYSQL_URL)('relation where - Many (mysql)', () => {
	let ctx: MysqlTestContext;

	const names = (rows: { name: string }[]) =>
		rows.map((row) => row.name).sort();

	beforeAll(async () => {
		ctx = await createMysqlTestContext(MYSQL_URL as string);
	});

	afterAll(async () => {
		await ctx?.close();
	});

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
});
