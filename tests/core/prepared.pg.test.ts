import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { Client } from 'pg';

import { better, param } from '../../src';

const users = pgTable('better_drizzle_prepared_users', {
	id: integer('id').primaryKey(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	tags: text('tags').array().notNull(),
	profile: jsonb('profile')
		.$type<{ city: string; score: number }>()
		.notNull(),
});
const relations = defineRelations({ users });
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('prepared statements (pg)', () => {
	let client: Client;
	let db: ReturnType<typeof better<typeof relations>>;

	beforeAll(async () => {
		client = new Client({ connectionString: DATABASE_URL });
		await client.connect();
		await client.query(
			'drop table if exists better_drizzle_prepared_users',
		);
		await client.query(`create table better_drizzle_prepared_users (
			id integer primary key,
			email text not null unique,
			name text not null,
			created_at timestamptz not null,
			tags text[] not null,
			profile jsonb not null
		)`);
		await client.query(`insert into better_drizzle_prepared_users values
			(1, 'ada@example.com', 'Ada', '2024-01-01T00:00:00Z', array['math', 'engines'], '{"city":"London","score":90}'),
			(2, 'grace@example.com', 'Grace', '2024-02-01T00:00:00Z', array['navy', 'compilers'], '{"city":"New York","score":95}'),
			(3, 'linus@example.com', 'Linus', '2024-03-01T00:00:00Z', array['kernels'], '{"city":"Helsinki","score":80}')`);
		db = better(drizzle({ client, relations }));
	});

	afterAll(async () => {
		await client?.query(
			'drop table if exists better_drizzle_prepared_users',
		);
		await client?.end();
	});

	test('named statements are reused across executions', async () => {
		const byEmail = db.users
			.findUnique({ where: { email: param('email') } })
			.prepare('prepared_users_by_email');

		expect((await byEmail.execute({ email: 'ada@example.com' }))?.id).toBe(
			1,
		);
		expect(
			(await byEmail.execute({ email: 'grace@example.com' }))?.id,
		).toBe(2);
		expect(await byEmail.execute({ email: 'none@example.com' })).toBeNull();
	});

	test('Date params go through the column encoder', async () => {
		const since = db.users
			.findMany({
				orderBy: { id: 'asc' },
				where: { createdAt: { gte: param('since') } },
			})
			.prepare();

		expect(
			(
				await since.execute({ since: new Date('2024-02-01T00:00:00Z') })
			).map((user) => user.id),
		).toEqual([2, 3]);
	});

	test('in / notIn params bind one array', async () => {
		const byIds = db.users
			.findMany({
				orderBy: { id: 'asc' },
				where: {
					id: { in: param('ids') },
					name: { notIn: param('names') },
				},
			})
			.prepare();

		expect(
			(await byIds.execute({ ids: [1, 2, 3], names: ['Grace'] })).map(
				(user) => user.id,
			),
		).toEqual([1, 3]);
		expect(await byIds.execute({ ids: [], names: [] })).toEqual([]);
	});

	test('array filters and element predicates take params', async () => {
		const tagged = db.users
			.findMany({
				orderBy: { id: 'asc' },
				where: {
					tags: { has: param('tag') },
				},
			})
			.prepare();
		const anyTag = db.users
			.findMany({
				orderBy: { id: 'asc' },
				where: {
					tags: {
						hasSome: param('tags'),
						some: { startsWith: param('prefix') },
					},
				},
			})
			.prepare();

		expect(
			(await tagged.execute({ tag: 'navy' })).map((user) => user.id),
		).toEqual([2]);
		expect(
			(
				await anyTag.execute({ prefix: 'k', tags: ['kernels', 'math'] })
			).map((user) => user.id),
		).toEqual([3]);
	});

	test('JSONB path filters take params', async () => {
		const byCity = db.users
			.findMany({ where: { profile: { json: { city: param('city') } } } })
			.prepare();
		const scored = db.users
			.findMany({
				orderBy: { id: 'asc' },
				where: {
					profile: { json: { score: { gte: param('score') } } },
				},
			})
			.prepare();
		const cities = db.users
			.findMany({
				orderBy: { id: 'asc' },
				where: { profile: { json: { city: { in: param('cities') } } } },
			})
			.prepare();

		expect(
			(await byCity.execute({ city: 'London' })).map((user) => user.id),
		).toEqual([1]);
		expect(
			(await scored.execute({ score: 90 })).map((user) => user.id),
		).toEqual([1, 2]);
		expect(
			(await cities.execute({ cities: ['London', 'Helsinki'] })).map(
				(user) => user.id,
			),
		).toEqual([1, 3]);
	});

	test('case-insensitive LIKE params', async () => {
		const search = db.users
			.findMany({
				orderBy: { id: 'asc' },
				where: {
					name: { contains: param('part'), mode: 'insensitive' },
				},
			})
			.prepare();

		expect(
			(await search.execute({ part: 'A' })).map((user) => user.id),
		).toEqual([1, 2]);
	});

	test('cursor and paginate match the regular reads', async () => {
		const next = db.users
			.cursor({
				after: param('after'),
				limit: 1,
				orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
			})
			.prepare('prepared_users_cursor');
		const page = db.users
			.paginate({
				orderBy: { id: 'asc' },
				page: param('page'),
				perPage: 2,
			})
			.prepare('prepared_users_page');
		const after = { createdAt: new Date('2024-03-01T00:00:00Z'), id: 3 };

		expect(await next.execute({ after })).toEqual(
			await db.users.cursor({
				after,
				limit: 1,
				orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
			}),
		);
		expect(await page.execute({ page: 2 })).toEqual(
			await db.users.paginate({
				orderBy: { id: 'asc' },
				page: 2,
				perPage: 2,
			}),
		);
	});
});
