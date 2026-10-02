import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';
import { createTestContext, type TestContext } from './setup';

const nullOrderRecords = sqliteTable('null_order_records', {
	id: integer('id').primaryKey(),
	lastSeenAt: integer('last_seen_at'),
});
const nullOrderRelations = defineRelations({ nullOrderRecords });

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

test('contains and startsWith treat LIKE metacharacters literally', async () => {
	const names = ['A%_!\\literal', 'Axy!\\literal', 'prefix A%_!\\literal'];
	await ctx.better.users.createMany({
		data: names.map((name, index) => ({
			name,
			age: 30,
			active: true,
			email: `pattern-${index}@example.com`,
		})),
	});
	for (const mode of [undefined, 'insensitive'] as const) {
		const value = mode ? 'a%_!\\' : 'A%_!\\';
		for (const operator of ['contains', 'startsWith'] as const) {
			const rows = await ctx.better.users.findMany({
				orderBy: { id: 'asc' },
				where: { name: { [operator]: value, mode } },
			});
			expect(rows.map((row) => row.name)).toEqual(
				operator === 'contains' ? [names[0], names[2]] : [names[0]],
			);
		}
	}
	// endsWith intentionally retains SQL pattern behavior.
	expect(
		(
			await ctx.better.users.findMany({
				where: { name: { endsWith: '%' } },
			})
		).length,
	).toBe(8);
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

	test('insensitive mode compiles to lower() like lower()', () => {
		const { users } = ctx.schema;
		const query = ctx.raw
			.select({ id: users.id })
			.from(users)
			.where(
				ctx.better.users.$where({
					name: { contains: 'LI', mode: 'insensitive' },
				}),
			)
			.toSQL();

		expect(query.sql).toContain('lower("test_users"."name") like lower(?)');
		expect(query.sql).not.toContain('ilike');
		expect(query.params).toEqual(['%LI%']);
	});

	test('insensitive mode ignores case under case_sensitive_like', async () => {
		ctx.sqlite.exec('PRAGMA case_sensitive_like = ON');
		const names = async (where: object) =>
			(
				await ctx.better.users.findMany({
					orderBy: { id: 'asc' },
					where: { name: { ...where, mode: 'insensitive' } },
				})
			).map((user) => user.name);

		expect(
			await ctx.better.users.findMany({
				where: { name: { contains: 'LI' } },
			}),
		).toHaveLength(0);
		expect(await names({ contains: 'LI' })).toEqual(['Alice', 'Charlie']);
		expect(await names({ startsWith: 'a' })).toEqual(['Alice']);
		expect(await names({ endsWith: 'E' })).toEqual([
			'Alice',
			'Charlie',
			'Eve',
		]);
		expect(
			await names({ not: { contains: 'LI', mode: 'insensitive' } }),
		).toEqual(['Bob', 'Diana', 'Eve']);
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

	test('orderBy controls NULL placement', async () => {
		const sqlite = new Database(':memory:');
		try {
			sqlite.exec(
				'create table null_order_records (id integer primary key, last_seen_at integer)',
			);
			sqlite.run(
				'insert into null_order_records (id, last_seen_at) values (1, null), (2, 100), (3, null), (4, 300), (5, 200)',
			);
			const db = better(
				drizzle({ client: sqlite, relations: nullOrderRelations }),
			);

			const nullsLast = await db.nullOrderRecords.findMany({
				orderBy: { lastSeenAt: { direction: 'asc', nulls: 'last' } },
			});
			expect(
				nullsLast.slice(-2).every((user) => user.lastSeenAt === null),
			).toBe(true);

			const nullsFirst = await db.nullOrderRecords.findMany({
				orderBy: { lastSeenAt: { direction: 'desc', nulls: 'first' } },
			});
			expect(
				nullsFirst
					.slice(0, 2)
					.every((user) => user.lastSeenAt === null),
			).toBe(true);

			const firstPage = await db.nullOrderRecords.cursor({
				limit: 2,
				orderBy: [
					{ lastSeenAt: { direction: 'asc', nulls: 'last' } },
					{ id: 'asc' },
				],
			});
			expect(firstPage.data.map((row) => row.id)).toEqual([2, 5]);
			expect(firstPage.pagination.nextCursor).toEqual({
				lastSeenAt: 200,
				id: 5,
			});
			await expect(
				Promise.resolve(
					db.nullOrderRecords.cursor({
						after: { lastSeenAt: 200 },
						limit: 2,
						orderBy: [
							{ lastSeenAt: { direction: 'asc', nulls: 'last' } },
							{ id: 'asc' },
						],
					}),
				),
			).rejects.toThrow('Cursor must include orderBy field "id"');

			const afterNonNull = await db.nullOrderRecords.cursor({
				after: firstPage.pagination.nextCursor as {
					lastSeenAt: number;
					id: number;
				},
				limit: 2,
				orderBy: [
					{ lastSeenAt: { direction: 'asc', nulls: 'last' } },
					{ id: 'asc' },
				],
			});
			expect(afterNonNull.data.map((row) => row.id)).toEqual([4, 1]);
			expect(afterNonNull.pagination.hasNext).toBe(true);
			expect(afterNonNull.pagination.nextCursor).toEqual({
				lastSeenAt: null,
				id: 1,
			});

			const afterNull = await db.nullOrderRecords.cursor({
				after: afterNonNull.pagination.nextCursor as {
					lastSeenAt: number | null;
					id: number;
				},
				limit: 2,
				orderBy: [
					{ lastSeenAt: { direction: 'asc', nulls: 'last' } },
					{ id: 'asc' },
				],
			});
			expect(afterNull.data.map((row) => row.id)).toEqual([3]);
			expect(afterNull.pagination.hasNext).toBe(false);

			const beforeNull = await db.nullOrderRecords.cursor({
				before: { lastSeenAt: null, id: 3 },
				limit: 2,
				orderBy: [
					{ lastSeenAt: { direction: 'asc', nulls: 'last' } },
					{ id: 'asc' },
				],
			});
			expect(beforeNull.data.map((row) => row.id)).toEqual([4, 1]);
		} finally {
			sqlite.close();
		}
	});
});

describe('JSONB where', () => {
	test('rejects JSONB path filters outside PostgreSQL', async () => {
		await expect(
			Promise.resolve(
				ctx.better.users.findMany({
					where: { name: { json: { 'profile.age': { gte: 18 } } } },
				} as never),
			),
		).rejects.toMatchObject({
			code: 'JSONB_QUERY_UNSUPPORTED',
			dialect: 'sqlite',
		});
	});
});
