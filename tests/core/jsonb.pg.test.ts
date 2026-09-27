import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { sql } from 'drizzle-orm';
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core';
import { Client } from 'pg';

import { BetterDrizzleErrorCode, better } from '../../src';

type Metadata = {
	profile: {
		active: boolean;
		age: number;
		location: { city: string; country: string };
		name: string;
		status?: { label: string };
	};
	preferences?: { alerts?: { weekly?: boolean }; email?: boolean };
	untouched?: { marker: string };
};
const events = pgTable('better_drizzle_jsonb_test_events', {
	id: integer('id').primaryKey(),
	metadata: jsonb('metadata').$type<Metadata>().notNull(),
	nullableMetadata: jsonb('nullable_metadata').$type<Metadata | null>(),
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
			'create table better_drizzle_jsonb_test_events (id integer primary key, metadata jsonb not null, nullable_metadata jsonb)',
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
					{ metadata: { 'profile.age': { gte: 40 } } },
					{ metadata: { 'profile.active': true } },
					{
						metadata: {
							'profile.name': { startsWith: 'User 1' },
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

	test('supports in, notIn, and insensitive mode on JSONB paths', async () => {
		const inRows = await db.events.findMany({
			where: {
				metadata: {
					'profile.name': { in: ['User 1', 'User 2', 'User 3'] },
					'profile.age': { in: [19, 20] },
				},
			},
		});
		expect(inRows.map((row) => row.id).sort((a, b) => a - b)).toEqual([
			1, 2,
		]);

		const empty = await db.events.findMany({
			where: { metadata: { 'profile.name': { in: [] } } },
		});
		expect(empty).toEqual([]);

		const notIn = await db.events.count({
			where: {
				metadata: { 'profile.active': { notIn: [true] } },
			},
		});
		expect(notIn).toBe(5000);

		const insensitive = await db.events.findMany({
			where: {
				metadata: {
					'profile.name': {
						startsWith: 'user 999',
						mode: 'insensitive',
					},
				},
			},
		});
		expect(insensitive.map((row) => row.id).sort((a, b) => a - b)).toEqual([
			999, 9990, 9991, 9992, 9993, 9994, 9995, 9996, 9997, 9998, 9999,
		]);

		const sensitive = await db.events.count({
			where: {
				metadata: { 'profile.name': { startsWith: 'user' } },
			},
		});
		expect(sensitive).toBe(0);
	});

	test('preserves ordinary JSON document equality', async () => {
		const metadata: Metadata = {
			profile: { active: false, age: 19, name: 'User 1' },
		};
		const rows = await db.events.findMany({ where: { metadata } });

		expect(rows.map((row) => row.id)).toEqual([1]);
	});

	test('matches an equivalent raw PostgreSQL predicate', async () => {
		const betterRows = await db.events.findMany({
			where: { metadata: { 'profile.age': { gte: 60 } } },
		});
		const legacyRows = await db.events.findMany({
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
		expect(legacyRows.map((row) => row.id)).toEqual(
			betterRows.map((row) => row.id),
		);
	});

	const seededMetadata = (): Metadata => ({
		profile: {
			active: true,
			age: 32,
			location: { city: 'Recife', country: 'BR' },
			name: 'Mutation seed',
		},
		preferences: { alerts: { weekly: true }, email: true },
		untouched: { marker: 'keep me' },
	});

	const insertMutationRows = async (ids: readonly number[]) => {
		for (const id of ids) {
			await client.query(
				`insert into better_drizzle_jsonb_test_events (id, metadata) values ($1, $2::jsonb)`,
				[id, JSON.stringify(seededMetadata())],
			);
		}
	};

	test('applies JSONB path mutations through update and preserves other fields', async () => {
		const id = 20_001;
		await insertMutationRows([id]);

		const result = await db.events.update({
			where: { id },
			data: {
				metadata: {
					'preferences.email': false,
					'profile.age': 41,
					'profile.status.label': 'verified',
				},
			},
		});

		expect(result?.metadata).toMatchObject({
			preferences: { alerts: { weekly: true }, email: false },
			profile: {
				active: true,
				age: 41,
				location: { city: 'Recife', country: 'BR' },
				name: 'Mutation seed',
				status: { label: 'verified' },
			},
			untouched: { marker: 'keep me' },
		});
	});

	test('applies JSONB path mutations through updateMany', async () => {
		const ids = [20_002, 20_003];
		await insertMutationRows(ids);

		const result = await db.events.updateMany({
			where: { id: { in: ids } },
			data: {
				metadata: {
					'preferences.alerts.weekly': false,
					'profile.age': 45,
				},
			},
		});

		expect(result.count).toBe(2);
		const rows = await db.events.findMany({ where: { id: { in: ids } } });
		expect(rows.map((row) => row.metadata.profile.age)).toEqual([45, 45]);
		expect(
			rows.every((row) => !row.metadata.preferences?.alerts?.weekly),
		).toBe(true);
		expect(
			rows.every((row) => row.metadata.untouched?.marker === 'keep me'),
		).toBe(true);
	});

	test('applies row-specific JSONB path mutations through updateEach', async () => {
		const ids = [20_004, 20_005];
		await insertMutationRows(ids);

		const result = await db.events.updateEach({
			by: events.id,
			data: [
				{ id: ids[0]!, age: 51, label: 'first' },
				{ id: ids[1]!, age: 52, label: 'second' },
			],
			update: {
				metadata: (row) => ({
					'profile.age': row.age as number,
					'profile.status.label': row.label as string,
				}),
			},
		});

		expect(result.count).toBe(2);
		const rows = await db.events.findMany({
			orderBy: { id: 'asc' },
			where: { id: { in: ids } },
		});
		expect(rows.map((row) => row.metadata.profile.age)).toEqual([51, 52]);
		expect(rows.map((row) => row.metadata.profile.status?.label)).toEqual([
			'first',
			'second',
		]);
		expect(
			rows.every((row) => row.metadata.untouched?.marker === 'keep me'),
		).toBe(true);
	});

	test('applies JSONB path mutations on the conflict branch of upsert', async () => {
		const id = 20_006;
		await insertMutationRows([id]);

		const result = await db.events.upsert({
			where: { id },
			create: { id, metadata: seededMetadata() },
			update: { metadata: { 'profile.age': 63 } },
		});

		expect(result?.metadata.profile.age).toBe(63);
		expect(result?.metadata.profile.location).toEqual({
			city: 'Recife',
			country: 'BR',
		});
		expect(result?.metadata.untouched).toEqual({ marker: 'keep me' });
	});

	test('applies JSONB path mutations on conflicts in upsertMany', async () => {
		const ids = [20_007, 20_008];
		await insertMutationRows(ids);

		const result = await db.events.upsertMany({
			data: ids.map((id) => ({ id, metadata: seededMetadata() })),
			target: 'id',
			update: {
				metadata: {
					'preferences.email': false,
					'profile.age': 70,
				},
			},
		});

		expect(result.count).toBe(2);
		const rows = await db.events.findMany({ where: { id: { in: ids } } });
		expect(rows.map((row) => row.metadata.profile.age)).toEqual([70, 70]);
		expect(
			rows.every((row) => row.metadata.preferences?.email === false),
		).toBe(true);
		expect(
			rows.every((row) => row.metadata.untouched?.marker === 'keep me'),
		).toBe(true);
	});

	test('creates missing object ancestors and normalizes SQL NULL and JSON non-object roots', async () => {
		const ids = [20_009, 20_010, 20_011, 20_012, 20_013];
		await client.query(
			`insert into better_drizzle_jsonb_test_events (id, metadata, nullable_metadata) values
			($1, '{}'::jsonb, null),
			($2, 'null'::jsonb, null),
			($3, '"old root"'::jsonb, null),
			($4, '[]'::jsonb, null),
			($5, '{}'::jsonb, null)`,
			ids,
		);
		await client.query(
			`update better_drizzle_jsonb_test_events set nullable_metadata = null where id = $1`,
			[ids[4]],
		);

		await db.events.updateMany({
			where: { id: { in: ids.slice(0, 4) } },
			data: {
				metadata: { 'profile.status.label': 'created' },
			},
		});
		await db.events.update({
			where: { id: ids[4] },
			data: { nullableMetadata: { 'profile.age': 77 } },
		});

		const rows = await db.events.findMany({
			orderBy: { id: 'asc' },
			where: { id: { in: ids } },
		});
		expect(rows.slice(0, 4).map((row) => row.metadata)).toEqual([
			{ profile: { status: { label: 'created' } } },
			{ profile: { status: { label: 'created' } } },
			{ profile: { status: { label: 'created' } } },
			{ profile: { status: { label: 'created' } } },
		]);
		expect(rows[4]?.nullableMetadata).toEqual({ profile: { age: 77 } });
	});

	test('replaces non-object intermediate ancestors and preserves other object keys', async () => {
		const id = 20_014;
		await client.query(
			`insert into better_drizzle_jsonb_test_events (id, metadata) values ($1, $2::jsonb)`,
			[
				id,
				JSON.stringify({
					profile: 'stale',
					untouched: { marker: 'keep me' },
				}),
			],
		);

		const result = await db.events.update({
			where: { id },
			data: { metadata: { 'profile.age': 35 } },
		});

		expect(result?.metadata).toEqual({
			profile: { age: 35 },
			untouched: { marker: 'keep me' },
		});
	});

	test('rejects overlapping JSONB paths and nested undefined before SQL', async () => {
		const id = 20_015;
		await insertMutationRows([id]);
		const rawDb = db.events as unknown as {
			update(args: unknown): Promise<unknown>;
		};

		await expect(
			rawDb.update({
				where: { id },
				data: {
					metadata: {
						json: {
							'profile.location': {
								city: 'Boston',
								country: 'US',
							},
							'profile.location.city': 'Paris',
						},
					},
				},
			}),
		).rejects.toThrow('cannot overlap');
		await expect(
			rawDb.update({
				where: { id },
				data: {
					metadata: {
						json: {
							'profile.location': {
								city: undefined,
								country: 'US',
							},
						},
					},
				},
			}),
		).rejects.toThrow('cannot contain undefined');
		await expect(
			rawDb.update({
				where: { id },
				data: { metadata: { 'profile..age': 40 } },
			}),
		).rejects.toThrow('Invalid JSONB mutation path');
	});
});

describe('JSONB path mutation dialect checks', () => {
	const unsupportedSchema = { events };
	const unsupportedMutation = {
		where: { id: 1 },
		data: { metadata: { 'profile.age': 33 } },
	};

	test('rejects JSONB path mutations on SQLite with the explicit feature error', async () => {
		const sqlite = new Database(':memory:');
		const client = better(drizzleSqlite(sqlite), {
			schema: unsupportedSchema,
		});

		await expect(
			(
				client.events as unknown as {
					update: (args: unknown) => Promise<unknown>;
				}
			).update(unsupportedMutation),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.JsonbMutationUnsupported,
			message: 'JSONB path mutations are only supported by PostgreSQL.',
		});
		sqlite.close();
	});

	test('rejects JSONB path mutations on MySQL with the explicit feature error', async () => {
		const raw = drizzleMysql({} as never, {
			mode: 'default',
			schema: unsupportedSchema,
		});
		const client = better(raw, { schema: unsupportedSchema });

		await expect(
			(
				client.events as unknown as {
					update: (args: unknown) => Promise<unknown>;
				}
			).update(unsupportedMutation),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.JsonbMutationUnsupported,
			message: 'JSONB path mutations are only supported by PostgreSQL.',
		});
	});
});
