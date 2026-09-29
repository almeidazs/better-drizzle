import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createMysqlTestContext, type MysqlTestContext } from './setup.mysql';

// The relation-filter fix in compiler.ts is dialect-agnostic, so the SQLite
// suite already proves the behaviour. This mirror runs the same some/none/every
// assertions against a real MySQL server, covering the one dialect the review
// noted was not exercised. It needs a live database, so it is gated on MYSQL_URL
// and skips when unset, e.g.
//   MYSQL_URL=mysql://root:root@127.0.0.1:3306/better_drizzle \
//     bun test tests/core/where.mysql.test.ts
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

	test('relation filter correlates when the same relation is included', async () => {
		// An include routes through the relational query builder, which aliases
		// the base table; the correlation must reference that alias.
		const result = await ctx.better.users.findMany({
			include: { posts: true },
			where: { posts: { some: { published: true } } },
		});
		expect(names(result)).toEqual(['Alice', 'Bob', 'Diana']);
	});

	test('upsert applies an atomic conflict update', async () => {
		const result = await ctx.better.users.upsert({
			create: {
				active: true,
				age: 25,
				email: 'alice@example.com',
				id: 1,
				name: 'Ignored',
			},
			update: { age: { increment: 3 } },
			where: { id: 1 },
		});

		expect(result).toMatchObject({ age: 28, id: 1 });
	});

	test('upsert inserts when there is no conflict', async () => {
		const result = await ctx.better.users.upsert({
			create: {
				active: true,
				age: 40,
				email: 'new-user@example.com',
				id: 10,
				name: 'New user',
			},
			update: { age: { increment: 1 } },
			where: { id: 10 },
		});

		expect(result).toMatchObject({ age: 40, id: 10 });
	});

	test('upsert uses the native MySQL builder on a primary-key-only table', async () => {
		const result = await ctx.better.comments.upsert({
			create: {
				authorId: 2,
				body: 'Ignored',
				id: 1,
				likes: 5,
				postId: 1,
			},
			update: { likes: { increment: 1 } },
			where: { id: 1 },
		});

		expect(result).toMatchObject({ id: 1, likes: 6 });
	});

	test('createMany counts only MySQL rows inserted with skipDuplicates', async () => {
		const result = await ctx.better.users.createMany({
			data: [
				{
					active: true,
					age: 20,
					email: 'batch-20@example.com',
					id: 20,
					name: 'Batch 20',
				},
				{
					active: true,
					age: 21,
					email: 'alice@example.com',
					id: 21,
					name: 'Duplicate email',
				},
			],
			skipDuplicates: true,
		});

		expect(result.count).toBe(1);
		expect(
			await ctx.better.users.findUnique({ where: { id: 20 } }),
		).toMatchObject({ id: 20 });
		expect(
			await ctx.better.users.findUnique({ where: { id: 21 } }),
		).toBeNull();
	});

	test('upsert by primary key cannot update a row with a different unique key', async () => {
		const alice = await ctx.better.users.findUnique({ where: { id: 1 } });
		await expect(
			ctx.better.users.upsert({
				create: {
					active: true,
					age: 30,
					email: 'alice@example.com',
					id: 30,
					name: 'Wrong conflict',
				},
				update: { age: { increment: 1 } },
				where: { id: 30 },
			}),
		).rejects.toThrow();
		expect(await ctx.better.users.findUnique({ where: { id: 1 } })).toEqual(
			alice,
		);
	});

	test('upsert respects a composite unique constraint', async () => {
		const owner = await ctx.better.memberships.findUnique({
			where: { id: 1 },
		});
		await expect(
			ctx.better.memberships.upsert({
				create: {
					id: 30,
					label: 'owner',
					note: 'Wrong conflict',
					userId: 1,
				},
				update: { note: 'Wrong update' },
				where: { id: 30 },
			}),
		).rejects.toThrow();
		expect(
			await ctx.better.memberships.findUnique({ where: { id: 1 } }),
		).toEqual(owner);
	});
});
