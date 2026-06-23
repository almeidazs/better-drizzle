import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { better } from '../../core/src';

import { timestamps } from '../src';

const records = sqliteTable('timestamp_records', {
	createdAt: integer('created_at', { mode: 'timestamp' }),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

const basicRecords = sqliteTable('timestamp_basic_records', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const schema = { basicRecords, records };

const createContext = () => {
	const sqlite = new Database(':memory:');

	sqlite.exec(`
		CREATE TABLE timestamp_records (
			id INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			created_at INTEGER,
			updated_at INTEGER
		);
		CREATE TABLE timestamp_basic_records (
			id INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL
		);
		INSERT INTO timestamp_records (id, name, created_at, updated_at)
		VALUES (1, 'Alice', NULL, NULL);
	`);

	return {
		db: drizzle(sqlite, { schema }),
		close() {
			sqlite.close();
		},
	};
};

describe('@better-drizzle/timestamps', () => {
	test('sets createdAt and updatedAt on create in app mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps()],
			schema,
		});

		const created = await client.records.create({
			data: { id: 2, name: 'Bob' },
		});

		expect(created?.createdAt).toBeInstanceOf(Date);
		expect(created?.updatedAt).toBeInstanceOf(Date);
		ctx.close();
	});

	test('sets updatedAt on update in app mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps()],
			schema,
		});

		const updated = await client.records.update({
			data: { name: 'Alice Updated' },
			where: { id: 1 },
		});

		expect(updated?.updatedAt).toBeInstanceOf(Date);
		ctx.close();
	});

	test('sets timestamps for createMany in app mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps()],
			schema,
		});

		const result = await client.records.createMany({
			data: [
				{ id: 2, name: 'Bob' },
				{ id: 3, name: 'Carol' },
			],
		});

		expect(result.data?.[0]?.createdAt).toBeInstanceOf(Date);
		expect(result.data?.[1]?.updatedAt).toBeInstanceOf(Date);
		ctx.close();
	});

	test('sets create and update payloads on upsert in app mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps()],
			schema,
		});

		const created = await client.records.upsert({
			create: { id: 2, name: 'Bob' },
			update: { name: 'Bob Updated' },
			where: { id: 2 },
		});

		const updated = await client.records.upsert({
			create: { id: 1, name: 'Alice' },
			update: { name: 'Alice Updated' },
			where: { id: 1 },
		});

		expect(created?.createdAt).toBeInstanceOf(Date);
		expect(created?.updatedAt).toBeInstanceOf(Date);
		expect(updated?.updatedAt).toBeInstanceOf(Date);
		ctx.close();
	});

	test('does nothing in database mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps({ mode: 'database' })],
			schema,
		});

		const created = await client.records.create({
			data: { id: 2, name: 'Bob' },
		});

		expect(created?.createdAt ?? null).toBeNull();
		expect(created?.updatedAt ?? null).toBeNull();
		ctx.close();
	});

	test('skips models without timestamp columns', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps()],
			schema,
		});

		const created = await client.basicRecords.create({
			data: { id: 1, name: 'Plain' },
		});

		expect(created?.name).toBe('Plain');
		ctx.close();
	});

	test('supports custom column names', async () => {
		const ctx = createContext();
		const customRecords = sqliteTable('timestamp_custom_records', {
			created_on: integer('created_on', { mode: 'timestamp' }),
			id: integer('id').primaryKey(),
			name: text('name').notNull(),
			updated_on: integer('updated_on', { mode: 'timestamp' }),
		});
		const customSchema = { customRecords };
		const sqlite = new Database(':memory:');

		sqlite.exec(`
			CREATE TABLE timestamp_custom_records (
				id INTEGER PRIMARY KEY NOT NULL,
				name TEXT NOT NULL,
				created_on INTEGER,
				updated_on INTEGER
			);
		`);

		const db = drizzle(sqlite, { schema: customSchema });
		const client = better(db, {
			plugins: [
				timestamps({
					createdAt: 'created_on',
					updatedAt: 'updated_on',
				}),
			],
			schema: customSchema,
		});

		const created = await client.customRecords.create({
			data: { id: 1, name: 'Custom' },
		});

		expect(created?.created_on).toBeInstanceOf(Date);
		expect(created?.updated_on).toBeInstanceOf(Date);
		sqlite.close();
		ctx.close();
	});
});
