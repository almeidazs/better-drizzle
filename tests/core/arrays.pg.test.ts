import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { drizzle } from 'drizzle-orm/node-postgres';
import {
	customType,
	integer,
	pgEnum,
	pgTable,
	text,
	uuid,
} from 'drizzle-orm/pg-core';
import { Client } from 'pg';

import { better } from '../../src';

const role = pgEnum('better_drizzle_array_role', ['admin', 'member']);
const encodedText = customType<{ data: { value: string }; driverData: string }>(
	{
		dataType: () => 'text',
		fromDriver: (value) => ({ value }),
		toDriver: (value) => value.value,
	},
);
const users = pgTable('better_drizzle_array_users', {
	id: integer('id').primaryKey(),
	ids: uuid('ids').array().notNull(),
	roles: role('roles').array().notNull(),
	scores: integer('scores').array().notNull(),
	tags: text('tags').array(),
});
const tokens = pgTable('better_drizzle_array_tokens', {
	id: integer('id').primaryKey(),
	values: encodedText('values').array().notNull(),
});
const schema = { tokens, users };
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('PostgreSQL array filters', () => {
	let client: Client;
	let db: ReturnType<typeof better<typeof schema>>;

	beforeAll(async () => {
		client = new Client({ connectionString: DATABASE_URL });
		await client.connect();
		await client.query('drop table if exists better_drizzle_array_tokens');
		await client.query('drop table if exists better_drizzle_array_users');
		await client.query('drop type if exists better_drizzle_array_role');
		await client.query(
			"create type better_drizzle_array_role as enum ('admin', 'member')",
		);
		await client.query(`create table better_drizzle_array_users (
			id integer primary key,
			ids uuid[] not null,
			roles better_drizzle_array_role[] not null,
			scores integer[] not null,
			tags text[]
		)`);
		await client.query(`insert into better_drizzle_array_users values
			(1, array['00000000-0000-0000-0000-000000000001']::uuid[], array['admin']::better_drizzle_array_role[], array[10, 20], array['typescript', 'orm']),
			(2, array['00000000-0000-0000-0000-000000000002']::uuid[], array['member']::better_drizzle_array_role[], array[20, 30], array[]::text[]),
			(3, array['00000000-0000-0000-0000-000000000003']::uuid[], array['admin', 'member']::better_drizzle_array_role[], array[10, 20, 30], null)`);
		await client.query(`create table better_drizzle_array_tokens (
			id integer primary key,
			values text[] not null
		)`);
		await client.query(`insert into better_drizzle_array_tokens values
			(1, array['x']),
			(2, array['y'])`);
		db = better(drizzle(client, { schema }), { schema });
	});

	afterAll(async () => {
		await client?.query('drop table if exists better_drizzle_array_tokens');
		await client?.query('drop table if exists better_drizzle_array_users');
		await client?.query('drop type if exists better_drizzle_array_role');
		await client?.end();
	});

	const ids = (rows: { id: number }[]) => rows.map((row) => row.id).sort();

	test('compiles equality, membership, containment, emptiness, and length', async () => {
		expect(
			ids(await db.users.findMany({ where: { scores: [10, 20] } })),
		).toEqual([1]);
		expect(
			ids(
				await db.users.findMany({ where: { roles: { has: 'admin' } } }),
			),
		).toEqual([1, 3]);
		expect(
			ids(
				await db.users.findMany({
					where: { scores: { hasEvery: [10, 20] } },
				}),
			),
		).toEqual([1, 3]);
		expect(
			ids(
				await db.users.findMany({
					where: { scores: { hasSome: [30] } },
				}),
			),
		).toEqual([2, 3]);
		expect(
			ids(
				await db.users.findMany({
					where: { scores: { hasNone: [30] } },
				}),
			),
		).toEqual([1]);
		expect(
			ids(
				await db.users.findMany({
					where: { scores: { containedBy: [10, 20] } },
				}),
			),
		).toEqual([1]);
		expect(
			ids(
				await db.users.findMany({ where: { tags: { isEmpty: true } } }),
			),
		).toEqual([2]);
		expect(
			ids(
				await db.users.findMany({
					where: { scores: { length: { gt: 2 } } },
				}),
			),
		).toEqual([3]);
	});

	test('combines operators and preserves SQL NULL semantics', async () => {
		expect(
			ids(
				await db.users.findMany({
					where: { roles: { has: 'admin', length: { lte: 1 } } },
				}),
			),
		).toEqual([1]);
		expect(
			ids(
				await db.users.findMany({
					where: { roles: { not: { has: 'admin' } } },
				}),
			),
		).toEqual([2]);
		expect(
			ids(
				await db.users.findMany({
					where: { tags: { isEmpty: false } },
				}),
			),
		).toEqual([1]);
		expect(
			ids(await db.users.findMany({ where: { tags: { not: null } } })),
		).toEqual([1, 2]);
	});

	test('filters array elements with some, every, and none', async () => {
		await client.query(`insert into better_drizzle_array_users values
			(4, array['00000000-0000-0000-0000-000000000004']::uuid[], array['member']::better_drizzle_array_role[], array[10, null, 20], array['hello'])`);
		expect(
			ids(
				await db.users.findMany({
					where: { scores: { some: { gt: 25 } } },
				}),
			),
		).toEqual([2, 3]);
		expect(
			ids(
				await db.users.findMany({
					where: { scores: { every: { gte: 0 } } },
				}),
			),
		).toEqual([1, 2, 3]);
		expect(
			ids(
				await db.users.findMany({
					where: { scores: { none: { gt: 25 } } },
				}),
			),
		).toEqual([1, 4]);
		expect(
			ids(
				await db.users.findMany({
					where: {
						tags: {
							some: {
								endsWith: '@rockfeller.com.br',
								mode: 'insensitive',
							},
						},
					},
				}),
			),
		).toEqual([]);
		expect(
			ids(
				await db.users.findMany({
					where: { tags: { every: { contains: 'x' } } },
				}),
			),
		).toEqual([2]);
		expect(
			ids(
				await db.users.findMany({
					where: { tags: { none: { contains: 'x' } } },
				}),
			),
		).toEqual([1, 2, 4]);
	});

	test('uses array operators for element equality and membership', async () => {
		expect(
			ids(
				await db.users.findMany({
					where: { roles: { some: { equals: 'admin' } } },
				}),
			),
		).toEqual([1, 3]);
		expect(
			ids(
				await db.users.findMany({
					where: { roles: { some: { in: ['member'] } } },
				}),
			),
		).toEqual([2, 3, 4]);
		expect(
			ids(
				await db.users.findMany({
					where: { tags: { every: { in: ['typescript', 'orm'] } } },
				}),
			),
		).toEqual([1, 2]);
		expect(
			ids(
				await db.users.findMany({
					where: { tags: { none: { equals: 'typescript' } } },
				}),
			),
		).toEqual([2, 4]);
	});

	test('encodes values for generic element predicates', async () => {
		expect(
			ids(
				await db.tokens.findMany({
					where: {
						values: { some: { not: { equals: { value: 'x' } } } },
					},
				}),
			),
		).toEqual([2]);
	});

	test('mutates arrays atomically across every write path', async () => {
		await db.users.update({
			data: { scores: { append: [40] } },
			where: { id: 1 },
		});
		await db.users.updateMany({
			data: { scores: { prepend: 5 } } as never,
			where: { id: 1 },
		});
		await db.users.updateEach({
			by: users.id,
			data: [
				{ id: 1, from: 10, to: 11 },
				{ id: 2, from: 20, to: 21 },
			],
			update: {
				scores: (row) => ({ replace: { from: row.from, to: row.to } }),
			},
		});
		await db.users.upsert({
			create: {
				id: 1,
				ids: ['00000000-0000-0000-0000-000000000001'],
				roles: ['admin'],
				scores: [1],
			},
			update: { scores: { remove: [20, 40] } } as never,
			where: { id: 1 },
		});
		await db.users.upsertMany({
			data: [
				{
					id: 1,
					ids: ['00000000-0000-0000-0000-000000000001'],
					roles: ['admin'],
					scores: [1],
				},
				{
					id: 3,
					ids: ['00000000-0000-0000-0000-000000000003'],
					roles: ['admin'],
					scores: [1],
					tags: ['created-only'],
				},
			],
			target: 'id',
			update: {
				scores: { addUnique: [11, 12, 13] },
				tags: { addUnique: 'new-tag' },
			},
		});

		expect(
			(await db.users.findFirst({ where: { id: 1 } }))?.scores,
		).toEqual([5, 11, 12, 13]);
		expect(
			(await db.users.findFirst({ where: { id: 2 } }))?.scores,
		).toEqual([21, 30]);
		expect(
			(await db.users.findFirst({ where: { id: 3 } }))?.tags,
		).toBeNull();

		await db.users.update({
			data: { tags: { addUnique: ['drizzle', 'drizzle', 'orm'] } },
			where: { id: 2 },
		});
		expect((await db.users.findFirst({ where: { id: 2 } }))?.tags).toEqual([
			'drizzle',
			'orm',
		]);

		await db.users.update({
			data: { scores: [1, 1, 2] },
			where: { id: 2 },
		});
		await db.users.update({
			data: { scores: { remove: 1 } },
			where: { id: 2 },
		});
		expect(
			(await db.users.findFirst({ where: { id: 2 } }))?.scores,
		).toEqual([2]);

		await db.users.update({
			data: {
				scores: {
					replace: [
						{ from: 2, to: 3 },
						{ from: 3, to: 4 },
					],
				},
			},
			where: { id: 2 },
		});
		expect(
			(await db.users.findFirst({ where: { id: 2 } }))?.scores,
		).toEqual([4]);

		await db.users.upsertMany({
			data: [
				{
					id: 2,
					ids: ['00000000-0000-0000-0000-000000000002'],
					roles: ['member'],
					scores: [1],
				},
			],
			target: 'id',
			update: () => ({ scores: { addUnique: [4, 5, 5] } }),
		});
		expect(
			(await db.users.findFirst({ where: { id: 2 } }))?.scores,
		).toEqual([4, 5]);
	});

	test('rejects malformed array mutation input', async () => {
		await expect(
			db.users.update({
				data: { scores: { append: [], remove: 1 } } as never,
				where: { id: 1 },
			}),
		).rejects.toMatchObject({
			code: 'OPERATION_ERROR',
			message:
				'PostgreSQL array mutations must specify exactly one operation.',
		});
	});

	test('rejects empty array element predicates', async () => {
		await expect(
			db.users.findMany({ where: { scores: { some: {} } } } as never),
		).rejects.toMatchObject({
			code: 'OPERATION_ERROR',
			message:
				'Array some predicate must be a non-empty scalar filter object.',
		});
		await expect(
			db.users.findMany({
				where: { scores: { some: { equals: null } } },
			} as never),
		).rejects.toMatchObject({
			code: 'OPERATION_ERROR',
			message:
				'Array some predicate cannot compare against a NULL array element.',
		});
	});
});
