import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { Client } from 'pg';

import { better } from '../../src';

const role = pgEnum('better_drizzle_array_role', ['admin', 'member']);
const users = pgTable('better_drizzle_array_users', {
	id: integer().primaryKey(),
	ids: uuid().array().notNull(),
	roles: role().array().notNull(),
	scores: integer().array().notNull(),
	tags: text().array(),
});
const schema = { users };
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('PostgreSQL array filters', () => {
	let client: Client;
	let db: ReturnType<typeof better<typeof schema>>;

	beforeAll(async () => {
		client = new Client({ connectionString: DATABASE_URL });
		await client.connect();
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
		db = better(drizzle(client, { schema }), { schema });
	});

	afterAll(async () => {
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
});
