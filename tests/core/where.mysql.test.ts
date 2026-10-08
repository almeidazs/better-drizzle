import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { defineRelations, fillPlaceholders, sql } from 'drizzle-orm';
import {
	blob,
	int,
	MySqlDialect,
	mysqlTable,
	varchar,
} from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { better, param } from '../../src';
import { createMysqlTestContext, type MysqlTestContext } from './setup.mysql';

// The relation-filter fix in compiler.ts is dialect-agnostic, so the SQLite
// suite already proves the behaviour. This mirror runs the same some/none/every
// assertions against a real MySQL server, covering the one dialect the review
// noted was not exercised. It needs a live database, so it is gated on MYSQL_URL
// and skips when unset, e.g.
//   MYSQL_URL=mysql://root:root@127.0.0.1:3306/better_drizzle \
//     bun test tests/core/where.mysql.test.ts
const MYSQL_URL = process.env.MYSQL_URL;

test('compiles literal MySQL patterns with an explicit escape character', () => {
	const items = mysqlTable('pattern_items', {
		name: varchar('name', { length: 255 }),
	});
	const db = better(drizzle.mock({ relations: defineRelations({ items }) }));
	for (const operator of ['contains', 'startsWith'] as const)
		for (const mode of [undefined, 'insensitive'] as const)
			for (const prepared of [false, true]) {
				const predicate = db.items.$where({
					name: {
						[operator]: prepared ? param('value') : 'A%_!\\',
						mode,
					},
				});
				const query = new MySqlDialect().sqlToQuery(predicate!);
				expect(query.sql).toContain("escape '!'");
				expect(
					fillPlaceholders(query.params, { value: 'A%_!\\' }),
				).toEqual([
					operator === 'contains' ? '%A!%!_!!\\%' : 'A!%!_!!\\%',
				]);
			}
});

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

describe.skipIf(!MYSQL_URL)('insensitive string filters (mysql)', () => {
	let ctx: MysqlTestContext;

	const names = (rows: { name: string }[]) => rows.map((row) => row.name);

	beforeAll(async () => {
		ctx = await createMysqlTestContext(MYSQL_URL as string);
		// A binary collation makes plain LIKE case-sensitive.
		await ctx.raw.execute(
			sql`ALTER TABLE test_users MODIFY name VARCHAR(255) NOT NULL COLLATE utf8mb4_bin`,
		);
	});

	afterAll(async () => {
		await ctx?.close();
	});

	const find = (filter: object) =>
		ctx.better.users.findMany({
			orderBy: { id: 'asc' },
			where: { name: filter },
		});

	test('matches literal metacharacters in regular and prepared patterns', async () => {
		const values = [
			'A%_!\\literal',
			'Axy!\\literal',
			'prefix A%_!\\literal',
		];
		await ctx.better.users.createMany({
			data: values.map((name, index) => ({
				id: 100 + index,
				name,
				email: `literal-${index}@example.com`,
				age: 30,
				active: true,
			})),
		});
		try {
			for (const operator of ['contains', 'startsWith'] as const) {
				const expected =
					operator === 'contains'
						? [values[0], values[2]]
						: [values[0]];
				expect(names(await find({ [operator]: 'A%_!\\' }))).toEqual(
					expected,
				);
				const statement = ctx.better.users
					.findMany({
						orderBy: { id: 'asc' },
						where: {
							name: {
								[operator]: param('value'),
								mode: 'insensitive',
							},
						},
					})
					.prepare();
				expect(
					names(await statement.execute({ value: 'a%_!\\' })),
				).toEqual(expected);
			}
		} finally {
			await ctx.better.users.deleteMany({
				where: { id: { in: [100, 101, 102] } },
			});
		}
	});

	test('contains, startsWith, and endsWith ignore case', async () => {
		expect(await find({ contains: 'LI' })).toHaveLength(0);
		expect(
			names(await find({ contains: 'LI', mode: 'insensitive' })),
		).toEqual(['Alice', 'Charlie']);
		expect(
			names(await find({ startsWith: 'a', mode: 'insensitive' })),
		).toEqual(['Alice']);
		expect(
			names(await find({ endsWith: 'E', mode: 'insensitive' })),
		).toEqual(['Alice', 'Charlie', 'Eve']);
	});

	test('equals, in, notIn, and scalar not ignore case', async () => {
		expect(await find({ equals: 'ALICE' })).toHaveLength(0);
		expect(
			names(await find({ equals: 'ALICE', mode: 'insensitive' })),
		).toEqual(['Alice']);
		expect(
			names(await find({ in: ['bob', 'EVE'], mode: 'insensitive' })),
		).toEqual(['Bob', 'Eve']);
		expect(
			names(await find({ notIn: ['bob', 'EVE'], mode: 'insensitive' })),
		).toEqual(['Alice', 'Charlie', 'Diana']);
		expect(
			names(await find({ not: 'alice', mode: 'insensitive' })),
		).toEqual(['Bob', 'Charlie', 'Diana', 'Eve']);

		const byName = ctx.better.users
			.findMany({
				where: { name: { equals: param('name'), mode: 'insensitive' } },
			})
			.prepare();
		expect(names(await byName.execute({ name: 'cHaRlIe' }))).toEqual([
			'Charlie',
		]);
	});

	test('prepared LIKE params ignore case', async () => {
		const search = ctx.better.users
			.findMany({
				orderBy: { id: 'asc' },
				where: {
					name: { contains: param('part'), mode: 'insensitive' },
				},
			})
			.prepare();

		expect(names(await search.execute({ part: 'LI' }))).toEqual([
			'Alice',
			'Charlie',
		]);
		expect(names(await search.execute({ part: 'bO' }))).toEqual(['Bob']);
	});
});

describe.skipIf(!MYSQL_URL)('binary values (mysql)', () => {
	const files = mysqlTable('test_binary_files', {
		hash: blob('hash', { mode: 'buffer' }).notNull().unique(),
		id: int('id').primaryKey(),
		name: varchar('name', { length: 255 }).notNull(),
	});
	const hash = Buffer.from('a1b2c3', 'hex');
	const other = Buffer.from('d4e5f6', 'hex');
	let conn: mysql.Connection;

	beforeAll(async () => {
		conn = await mysql.createConnection(MYSQL_URL as string);
		await conn.query('DROP TABLE IF EXISTS test_binary_files');
		await conn.query(
			'CREATE TABLE test_binary_files (id INT PRIMARY KEY, hash BLOB NOT NULL, name VARCHAR(255) NOT NULL, UNIQUE KEY (hash(32)))',
		);
	});

	afterAll(async () => {
		await conn?.query('DROP TABLE IF EXISTS test_binary_files');
		await conn?.end();
	});

	test('Buffer values match blob columns and pin unique keys', async () => {
		const queries: string[] = [];
		const db = better(
			drizzle({
				client: conn,
				logger: { logQuery: (query) => queries.push(query) },
				relations: defineRelations({ files }),
			}),
		);
		await db.files.createMany({
			data: [
				{ hash, id: 1, name: 'a' },
				{ hash: other, id: 2, name: 'b' },
			],
		});

		expect(await db.files.findFirst({ where: { hash } })).toMatchObject({
			id: 1,
		});
		expect(await db.files.findUnique({ where: { hash } })).toMatchObject({
			id: 1,
		});
		expect(await db.files.count({ where: { hash: { not: hash } } })).toBe(
			1,
		);

		queries.length = 0;
		expect(
			await db.files.update({
				data: { name: 'renamed' },
				where: { hash },
			}),
		).toMatchObject({ name: 'renamed' });
		expect(queries).not.toContainEqual(
			expect.stringContaining('for update'),
		);

		expect(await db.files.delete({ where: { hash } })).toMatchObject({
			id: 1,
		});
		expect(await db.files.count()).toBe(1);
	});
});

describe.skipIf(!MYSQL_URL)('orderBy relation fields (mysql)', () => {
	let ctx: MysqlTestContext;

	beforeAll(async () => {
		ctx = await createMysqlTestContext(MYSQL_URL as string);
	});

	afterAll(async () => {
		await ctx?.close();
	});

	test('sorts by nested one relation fields with emulated NULL placement', async () => {
		const rows = await ctx.better.comments.findMany({
			orderBy: [
				{
					post: {
						author: { name: { direction: 'desc', nulls: 'first' } },
					},
				},
				{ id: 'asc' },
			],
		});
		expect(rows.map((row) => row.id)).toEqual([5, 3, 4, 1, 2]);
	});

	test('sorts by to-many counts, including nested paginated includes', async () => {
		const users = await ctx.better.users.findMany({
			orderBy: [{ comments: { _count: 'desc' } }, { id: 'desc' }],
		});
		expect(users.map((row) => row.id)).toEqual([3, 1, 2, 5, 4]);

		const withPosts = await ctx.better.users.findMany({
			include: {
				posts: {
					orderBy: [{ comments: { _count: 'desc' } }, { id: 'asc' }],
					take: 1,
				},
			},
			orderBy: { id: 'asc' },
			where: { id: { in: [1, 2] } },
		});
		expect(
			withPosts.map((row) => row.posts.map((post) => post.id)),
		).toEqual([[1], [3]]);
	});
});
