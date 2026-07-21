import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import { better } from '../src';

type Metadata = { profile: { active: boolean; age: number; name: string } };
const events = pgTable('better_drizzle_jsonb_test_events', {
	id: integer('id').primaryKey(),
	metadata: jsonb('metadata').$type<Metadata>().notNull(),
});
const schema = { events };
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('JSONB where (PostgreSQL)', () => {
	let client: Client;
	let db: ReturnType<typeof better<typeof schema>>;

	beforeAll(async () => {
		client = new Client({ connectionString: DATABASE_URL });
		await client.connect();
		await client.query(
			'drop table if exists better_drizzle_jsonb_test_events',
		);
		await client.query(
			'create table better_drizzle_jsonb_test_events (id integer primary key, metadata jsonb not null)',
		);
		await client.query(
			"create index better_drizzle_jsonb_test_events_age_idx on better_drizzle_jsonb_test_events (((metadata #>> '{profile,age}')::numeric))",
		);
		const values: unknown[] = [];
		const placeholders: string[] = [];
		for (let id = 1; id <= 10_000; id += 1) {
			placeholders.push(
				'($' +
					(values.length + 1) +
					', $' +
					(values.length + 2) +
					'::jsonb)',
			);
			values.push(
				id,
				JSON.stringify({
					profile: {
						active: id % 2 === 0,
						age: 18 + (id % 60),
						name: `User ${id}`,
					},
				}),
			);
		}
		await client.query(
			'insert into better_drizzle_jsonb_test_events (id, metadata) values ' +
				placeholders.join(', '),
			values,
		);
		db = better(drizzle(client, { schema }), { schema });
	});

	afterAll(async () => {
		await client?.query(
			'drop table if exists better_drizzle_jsonb_test_events',
		);
		await client?.end();
	});

	test('filters 10,000 typed JSONB records by scalar paths', async () => {
		const rows = await db.events.findMany({
			where: {
				AND: [
					{ metadata: { json: { 'profile.age': { gte: 40 } } } },
					{ metadata: { json: { 'profile.active': true } } },
					{
						metadata: {
							json: { 'profile.name': { startsWith: 'User 1' } },
						},
					},
				],
			},
		});
		expect(rows.length).toBeGreaterThan(0);
		expect(
			rows.every(
				(row) =>
					row.metadata.profile.age >= 40 &&
					row.metadata.profile.active &&
					row.metadata.profile.name.startsWith('User 1'),
			),
		).toBe(true);
	});

	test('matches an equivalent raw PostgreSQL predicate', async () => {
		const betterRows = await db.events.findMany({
			where: { metadata: { json: { 'profile.age': { gte: 60 } } } },
		});
		const rawRows = await drizzle(client, { schema })
			.select()
			.from(events)
			.where(
				sql`jsonb_typeof(${events.metadata} #> ARRAY['profile', 'age']::text[]) = 'number' and (${events.metadata} #>> ARRAY['profile', 'age']::text[])::numeric >= 60`,
			);
		expect(betterRows.map((row) => row.id)).toEqual(
			rawRows.map((row) => row.id),
		);
	});
});
