import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';

import { DrizzleQueryError, defineRelations, sql } from 'drizzle-orm';
import { int, mysqlTable, serial, varchar } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import {
	BetterDrizzleError,
	better,
	definePlugin,
	getDatabaseErrorInfo,
	isUniqueViolation,
} from '../../src';

// MySQL side of the drizzle-orm 1.x migration coverage: mysql2 write results
// are [ResultSetHeader, FieldPacket[]] tuples, and ON DUPLICATE KEY UPDATE
// fires on any unique key, so upsert must not use it when another one exists.

const members = mysqlTable('better_drizzle_v1_members', {
	email: varchar('email', { length: 255 }).notNull().unique(),
	id: int('id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
});

const counters = mysqlTable('better_drizzle_v1_counters', {
	id: int('id').primaryKey(),
	value: int('value').notNull(),
});

const tags = mysqlTable('better_drizzle_v1_tags', {
	id: serial('id').primaryKey(),
	label: varchar('label', { length: 255 }).notNull(),
	slug: varchar('slug', { length: 255 }).notNull().unique(),
});

const relations = defineRelations({ counters, members, tags });

const MYSQL_URL = process.env.MYSQL_URL;

const captureError = async (run: () => unknown) => {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error('Expected the call to throw.');
};

describe.skipIf(!MYSQL_URL)('Drizzle 1.x migration (MySQL)', () => {
	let connection: mysql.Connection;
	let db: ReturnType<typeof drizzle<typeof relations>>;
	let client: ReturnType<typeof better<typeof relations>>;

	beforeAll(async () => {
		connection = await mysql.createConnection({
			multipleStatements: true,
			uri: MYSQL_URL,
		});
		await connection.query(`
			drop table if exists better_drizzle_v1_members, better_drizzle_v1_counters, better_drizzle_v1_tags;
			create table better_drizzle_v1_members (
				id int primary key,
				email varchar(255) not null unique,
				name varchar(255) not null
			);
			create table better_drizzle_v1_counters (
				id int primary key,
				value int not null
			);
			create table better_drizzle_v1_tags (
				id serial primary key,
				slug varchar(255) not null unique,
				label varchar(255) not null
			);
		`);
		db = drizzle({ client: connection, mode: 'default', relations });
		client = better(db);
	});

	beforeEach(async () => {
		await connection.query(`
			delete from better_drizzle_v1_members;
			delete from better_drizzle_v1_counters;
			delete from better_drizzle_v1_tags;
			insert into better_drizzle_v1_tags (slug, label) values ('orm', 'ORM');
			insert into better_drizzle_v1_members (id, email, name) values
				(1, 'alice@example.com', 'Alice'),
				(2, 'bob@example.com', 'Bob');
			insert into better_drizzle_v1_counters (id, value) values (1, 10);
		`);
	});

	afterAll(async () => {
		await connection?.query(
			'drop table if exists better_drizzle_v1_members, better_drizzle_v1_counters, better_drizzle_v1_tags',
		);
		await connection?.end();
	});

	test('upsert never updates a row matched by another unique key', async () => {
		// With ON DUPLICATE KEY UPDATE, the email collision would rename Alice.
		const error = await captureError(() =>
			client.members.upsert({
				create: { email: 'alice@example.com', id: 3, name: 'Intruder' },
				update: { name: 'Intruder' },
				where: { id: 3 },
			}),
		);

		expect(isUniqueViolation(error)).toBe(true);
		const alice = await client.members.findUnique({ where: { id: 1 } });
		expect(alice?.name).toBe('Alice');
		expect(await client.members.count()).toBe(2);
	});

	test('upsert on a table with another unique key still creates and updates', async () => {
		const created = await client.members.upsert({
			create: { email: 'carol@example.com', id: 3, name: 'Carol' },
			update: { name: 'Carol' },
			where: { id: 3 },
		});
		expect(created).toMatchObject({ id: 3, name: 'Carol' });

		const updated = await client.members.upsert({
			create: { email: 'bob@example.com', id: 2, name: 'Bob' },
			update: { name: 'Robert' },
			where: { id: 2 },
		});
		expect(updated).toMatchObject({ id: 2, name: 'Robert' });
		expect(await client.members.count()).toBe(3);
	});

	test('upsert on a primary-key-only table uses the native path', async () => {
		const updated = await client.counters.upsert({
			create: { id: 1, value: 0 },
			update: { value: { increment: 5 } },
			where: { id: 1 },
		});
		expect(updated).toMatchObject({ id: 1, value: 15 });

		const created = await client.counters.upsert({
			create: { id: 2, value: 1 },
			update: { value: { increment: 5 } },
			where: { id: 2 },
		});
		expect(created).toMatchObject({ id: 2, value: 1 });
	});

	test('upsert by the only unique key next to an auto-increment id is native', async () => {
		const queries: string[] = [];
		const logged = better(
			drizzle({
				client: connection,
				logger: { logQuery: (query) => queries.push(query) },
				mode: 'default',
				relations,
			}),
		);

		const updated = await logged.tags.upsert({
			create: { label: 'Ignored', slug: 'orm' },
			update: { label: 'Object Relational' },
			where: { slug: 'orm' },
		});
		expect(updated).toMatchObject({
			label: 'Object Relational',
			slug: 'orm',
		});

		const created = await logged.tags.upsert({
			create: { label: 'SQL', slug: 'sql' },
			update: { label: 'Ignored' },
			where: { slug: 'sql' },
		});
		expect(created).toMatchObject({ label: 'SQL', slug: 'sql' });
		expect(
			queries.filter((query) =>
				query.includes('on duplicate key update'),
			),
		).toHaveLength(2);
	});

	test('upsert by a unique key keeps the fallback when the insert sets the primary key', async () => {
		const queries: string[] = [];
		const logged = better(
			drizzle({
				client: connection,
				logger: { logQuery: (query) => queries.push(query) },
				mode: 'default',
				relations,
			}),
		);

		const updated = await logged.members.upsert({
			create: { email: 'alice@example.com', id: 9, name: 'Ignored' },
			update: { name: 'Alicia' },
			where: { email: 'alice@example.com' },
		});
		expect(updated).toMatchObject({ id: 1, name: 'Alicia' });
		expect(
			queries.some((query) => query.includes('on duplicate key update')),
		).toBe(false);
	});

	test('update and delete touch one row when where matches several', async () => {
		await connection.query(`
			insert into better_drizzle_v1_members (id, email, name) values
				(3, 'same1@example.com', 'Same'),
				(4, 'same2@example.com', 'Same');
		`);

		const updated = await client.members.update({
			data: { name: 'Moved' },
			where: { name: 'Same' },
		});
		expect(updated).toMatchObject({ id: 3, name: 'Moved' });
		expect(await client.members.count({ where: { name: 'Same' } })).toBe(1);

		const deleted = await client.members.delete({
			where: { id: { in: [3, 4] } },
		});
		expect(deleted).toMatchObject({ id: 3, name: 'Moved' });
		expect(
			await client.members.findMany({
				select: { id: true },
				where: { id: { in: [3, 4] } },
			}),
		).toEqual([{ id: 4 }]);
	});

	const createTrackedClient = () => {
		const queries: string[] = [];
		const calls: string[] = [];
		const tracked = better(
			drizzle({
				client: connection,
				logger: { logQuery: (query) => queries.push(query) },
				mode: 'default',
				relations,
			}),
			{
				hooks: {
					afterDelete: (ctx) => {
						calls.push(`client:afterDelete:${ctx.isInTransaction}`);
					},
					afterUpdate: (ctx) => {
						calls.push(`client:afterUpdate:${ctx.isInTransaction}`);
					},
					beforeDelete: () => {
						calls.push('client:beforeDelete');
					},
					beforeUpdate: () => {
						calls.push('client:beforeUpdate');
					},
				},
				plugins: [
					definePlugin({
						hooks: {
							afterDelete: () => {
								calls.push('plugin:afterDelete');
							},
							afterUpdate: () => {
								calls.push('plugin:afterUpdate');
							},
							beforeDelete: () => {
								calls.push('plugin:beforeDelete');
							},
							beforeUpdate: () => {
								calls.push('plugin:beforeUpdate');
							},
						},
						id: 'track-writes',
					}),
				],
			},
		);
		return { calls, queries, tracked };
	};

	const seedSame = () =>
		connection.query(`
			insert into better_drizzle_v1_members (id, email, name) values
				(3, 'same1@example.com', 'Same'),
				(4, 'same2@example.com', 'Same');
		`);

	test('non-pinned update and delete lock the row and write by primary key', async () => {
		await seedSame();
		const { calls, queries, tracked } = createTrackedClient();

		const updated = await tracked.members.update({
			data: { name: 'Moved' },
			where: { name: 'Same' },
		});
		expect(updated).toMatchObject({ id: 3, name: 'Moved' });
		expect(await client.members.count({ where: { name: 'Same' } })).toBe(1);
		expect(queries.some((query) => query.endsWith(' for update'))).toBe(
			true,
		);
		expect(
			queries.some((query) =>
				/^update .* where .*`id` = \?$/.test(query),
			),
		).toBe(true);
		expect(calls).toEqual([
			'plugin:beforeUpdate',
			'client:beforeUpdate',
			'client:afterUpdate:true',
			'plugin:afterUpdate',
		]);

		calls.length = 0;
		queries.length = 0;
		const deleted = await tracked.members.delete({
			select: { email: true, id: true },
			where: { id: { in: [3, 4] } },
		});
		expect(deleted).toEqual({ email: 'same1@example.com', id: 3 });
		expect(queries.some((query) => query.endsWith(' for update'))).toBe(
			true,
		);
		expect(
			queries.some((query) =>
				/^delete from .* where .*`id` = \?$/.test(query),
			),
		).toBe(true);
		expect(calls).toEqual([
			'plugin:beforeDelete',
			'client:beforeDelete',
			'client:afterDelete:true',
			'plugin:afterDelete',
		]);
		expect(
			await client.members.findMany({
				select: { id: true },
				where: { id: { in: [3, 4] } },
			}),
		).toEqual([{ id: 4 }]);
	});

	test('non-pinned update and delete reuse an active transaction', async () => {
		await seedSame();
		const { calls, tracked } = createTrackedClient();

		const [updated, deleted] = await tracked.transaction(async (tx) => [
			await tx.members.update({
				data: { name: 'Moved' },
				where: { name: 'Same' },
			}),
			await tx.members.delete({ where: { name: 'Same' } }),
		]);
		expect(updated).toMatchObject({ id: 3, name: 'Moved' });
		expect(deleted).toMatchObject({ id: 4, name: 'Same' });
		expect(calls).toEqual([
			'plugin:beforeUpdate',
			'client:beforeUpdate',
			'client:afterUpdate:true',
			'plugin:afterUpdate',
			'plugin:beforeDelete',
			'client:beforeDelete',
			'client:afterDelete:true',
			'plugin:afterDelete',
		]);
		expect(
			await client.members.findMany({
				select: { id: true, name: true },
				where: { id: { in: [3, 4] } },
			}),
		).toEqual([{ id: 3, name: 'Moved' }]);
	});

	test('pinned update and delete stay outside a transaction', async () => {
		const { calls, queries, tracked } = createTrackedClient();

		expect(
			await tracked.members.update({
				data: { name: 'Alicia' },
				where: { id: 1 },
			}),
		).toMatchObject({ id: 1, name: 'Alicia' });
		expect(
			await tracked.members.delete({
				where: { email: 'bob@example.com' },
			}),
		).toMatchObject({ id: 2 });
		expect(queries.some((query) => query.endsWith(' for update'))).toBe(
			false,
		);
		expect(calls).toContain('client:afterUpdate:false');
		expect(calls).toContain('client:afterDelete:false');
	});

	test('batch counts come from the mysql2 result tuple', async () => {
		expect(
			await client.members.updateMany({
				data: { name: 'Renamed' },
				select: { id: true },
				where: { id: { in: [1, 2] } },
			}),
		).toEqual({ count: 2 });
		expect(
			await client.members.createMany({
				data: [
					{ email: 'alice@example.com', id: 1, name: 'Dup' },
					{ email: 'dave@example.com', id: 4, name: 'Dave' },
				],
				skipDuplicates: true,
			}),
		).toMatchObject({ count: 1 });
		expect(
			await client.members.deleteMany({
				select: { id: true },
				where: { id: { in: [2, 4, 99] } },
			}),
		).toEqual({ count: 2 });
	});

	test('driver errors are wrapped, helpers read errno from the cause', async () => {
		const error = await captureError(() =>
			db.insert(members).values({
				email: 'bob@example.com',
				id: 5,
				name: 'Dup',
			}),
		);

		expect(error).toBeInstanceOf(DrizzleQueryError);
		expect(getDatabaseErrorInfo(error)).toMatchObject({
			driver: 'mysql',
			errno: 1062,
		});
		expect(isUniqueViolation(error)).toBe(true);

		const hooked = better(db, { hooks: { beforeCreate() {} } });
		const wrapped = await captureError(() =>
			hooked.members.create({
				data: { email: 'bob@example.com', id: 5, name: 'Dup' },
			}),
		);
		expect(wrapped).toBeInstanceOf(BetterDrizzleError);
		expect(isUniqueViolation(wrapped)).toBe(true);
	});

	test('upsertMany uses ON DUPLICATE KEY UPDATE on the primary key', async () => {
		const result = await client.counters.upsertMany({
			data: [
				{ id: 1, value: 99 },
				{ id: 2, value: 5 },
			],
			target: ['id'],
			update: ({ excluded }) => ({ value: excluded.value }),
		});

		expect(result).toEqual({ count: 2 });
		expect(
			await client.counters.findMany({ orderBy: { id: 'asc' } }),
		).toEqual([
			{ id: 1, value: 99 },
			{ id: 2, value: 5 },
		]);
	});

	test('upsertMany targets a unique key next to an auto-increment id', async () => {
		await client.tags.upsertMany({
			data: [
				{ label: 'Object-relational mapping', slug: 'orm' },
				{ label: 'SQL', slug: 'sql' },
			],
			target: ['slug'],
			update: ['label'],
		});

		const rows = await client.tags.findMany({ orderBy: { slug: 'asc' } });
		expect(rows.map(({ label, slug }) => ({ label, slug }))).toEqual([
			{ label: 'Object-relational mapping', slug: 'orm' },
			{ label: 'SQL', slug: 'sql' },
		]);
	});

	test('upsertMany rejects targets MySQL cannot honor', async () => {
		const notUnique = await captureError(() =>
			client.members.upsertMany({
				data: [{ email: 'alice@example.com', id: 1, name: 'A' }],
				target: ['name'],
				update: ['email'],
			}),
		);
		expect((notUnique as Error).message).toBe(
			'upsertMany target must be the primary key or a unique key on MySQL.',
		);

		// rows set id, the primary key, so a collision there would update Alice
		const otherKey = await captureError(() =>
			client.members.upsertMany({
				data: [{ email: 'new@example.com', id: 1, name: 'Intruder' }],
				target: ['email'],
				update: ['name'],
			}),
		);
		expect((otherKey as Error).message).toContain(
			'another unique key can match',
		);

		const withWhere = await captureError(() =>
			client.counters.upsertMany({
				data: [{ id: 1, value: 1 }],
				target: ['id'],
				update: ['value'],
				where: sql`1 = 1`,
			}),
		);
		expect((withWhere as Error).message).toBe(
			'upsertMany where is not supported on MySQL.',
		);
		const withTypedWhere = await captureError(() =>
			client.counters.upsertMany({
				data: [{ id: 1, value: 1 }],
				target: ['id'],
				update: ['value'],
				where: { value: { gt: 0 } },
			}),
		);
		expect((withTypedWhere as Error).message).toBe(
			'upsertMany where is not supported on MySQL.',
		);

		expect(
			await client.members.findUnique({ where: { id: 1 } }),
		).toMatchObject({ name: 'Alice' });
	});
});
