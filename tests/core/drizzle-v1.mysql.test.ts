import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';

import { DrizzleQueryError, defineRelations } from 'drizzle-orm';
import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import {
	BetterDrizzleError,
	better,
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

const relations = defineRelations({ counters, members });

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
			drop table if exists better_drizzle_v1_members, better_drizzle_v1_counters;
			create table better_drizzle_v1_members (
				id int primary key,
				email varchar(255) not null unique,
				name varchar(255) not null
			);
			create table better_drizzle_v1_counters (
				id int primary key,
				value int not null
			);
		`);
		db = drizzle({ client: connection, mode: 'default', relations });
		client = better(db);
	});

	beforeEach(async () => {
		await connection.query(`
			delete from better_drizzle_v1_members;
			delete from better_drizzle_v1_counters;
			insert into better_drizzle_v1_members (id, email, name) values
				(1, 'alice@example.com', 'Alice'),
				(2, 'bob@example.com', 'Bob');
			insert into better_drizzle_v1_counters (id, value) values (1, 10);
		`);
	});

	afterAll(async () => {
		await connection?.query(
			'drop table if exists better_drizzle_v1_members, better_drizzle_v1_counters',
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

	test('batch counts come from the mysql2 result tuple', async () => {
		expect(
			await client.members.updateMany({
				data: { name: 'Renamed' },
				where: { id: { in: [1, 2] } },
			}),
		).toMatchObject({ count: 2 });
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
				where: { id: { in: [2, 4, 99] } },
			}),
		).toMatchObject({ count: 2 });
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
});
