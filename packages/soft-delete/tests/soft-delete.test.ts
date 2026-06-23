import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { better } from '../../core/src';

import { softDelete } from '../src';

const records = sqliteTable('soft_delete_records', {
	deletedAt: integer('deleted_at', { mode: 'timestamp' }),
	deletedById: text('deleted_by_id'),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const basicRecords = sqliteTable('soft_delete_basic_records', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const schema = { basicRecords, records };

const createContext = () => {
	const sqlite = new Database(':memory:');

	sqlite.exec(`
		CREATE TABLE soft_delete_records (
			id INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			deleted_at INTEGER,
			deleted_by_id TEXT
		);
		CREATE TABLE soft_delete_basic_records (
			id INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL
		);
		INSERT INTO soft_delete_records (id, name, deleted_at, deleted_by_id)
		VALUES
			(1, 'Alice', NULL, NULL),
			(2, 'Bob', 1710000000, 'seed-user');
	`);

	return {
		db: drizzle(sqlite, { schema }),
		close() {
			sqlite.close();
		},
	};
};

describe('@better-drizzle/soft-delete', () => {
	test('filters deleted rows by default and supports visibility overrides', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [softDelete()],
			schema,
		});

		const visible = await client.records.findMany({
			orderBy: { id: 'asc' },
		});
		const allRows = await client.records.findMany({
			deleted: 'with',
			orderBy: { id: 'asc' },
		});
		const onlyDeleted = await client.records.findMany({
			deleted: 'only',
			orderBy: { id: 'asc' },
		});

		expect(visible).toHaveLength(1);
		expect(allRows).toHaveLength(2);
		expect(onlyDeleted).toHaveLength(1);
		expect(onlyDeleted[0]?.id).toBe(2);
		ctx.close();
	});

	test('applies visibility rules to count and exists', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [softDelete()],
			schema,
		});

		const visibleCount = await client.records.count();
		const totalCount = await client.records.count({ deleted: 'with' });
		const deletedExists = await client.records.exists({
			deleted: 'only',
			where: { id: 2 },
		});

		expect(visibleCount).toBe(1);
		expect(totalCount).toBe(2);
		expect(deletedExists).toBe(true);
		ctx.close();
	});

	test('soft deletes by default and records deletedBy when available', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [softDelete()],
			schema,
		});

		const deleted = await client.records.delete({
			deletedBy: 'admin-user',
			where: { id: 1 },
		});
		const afterDelete = await client.records.findMany({
			deleted: 'only',
			orderBy: { id: 'asc' },
		});

		expect(deleted?.deletedAt).toBeInstanceOf(Date);
		expect(deleted?.deletedById).toBe('admin-user');
		expect(afterDelete).toHaveLength(2);
		expect(afterDelete.map((row) => row.id)).toEqual([1, 2]);
		ctx.close();
	});

	test('supports hard delete mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [softDelete()],
			schema,
		});

		await client.records.delete({
			mode: 'hard',
			where: { id: 1 },
		});

		const allRows = await client.records.findMany({
			deleted: 'with',
			orderBy: { id: 'asc' },
		});

		expect(allRows).toHaveLength(1);
		expect(allRows[0]?.id).toBe(2);
		ctx.close();
	});

	test('restore and restoreById clear soft delete fields', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [softDelete()],
			schema,
		});

		const restored = await client.records.restore({
			where: { id: 2 },
		});

		expect(restored?.deletedAt ?? null).toBeNull();
		expect(restored?.deletedById ?? null).toBeNull();

		await client.records.delete({
			deletedBy: 'admin-user',
			where: { id: 1 },
		});
		const restoredById = await client.records.restoreById(1);

		expect(restoredById?.deletedAt ?? null).toBeNull();
		expect(restoredById?.deletedById ?? null).toBeNull();
		ctx.close();
	});

	test('skips models without the configured soft delete column', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [softDelete()],
			schema,
		});

		const created = await client.basicRecords.create({
			data: { id: 1, name: 'Plain' },
		});

		expect(created?.name).toBe('Plain');
		ctx.close();
	});

	test('supports custom columns and default visibility mode', async () => {
		const customRecords = sqliteTable('soft_delete_custom_records', {
			deleted_by: text('deleted_by'),
			deleted_on: integer('deleted_on', { mode: 'timestamp' }),
			id: integer('id').primaryKey(),
			name: text('name').notNull(),
		});
		const customSchema = { customRecords };
		const sqlite = new Database(':memory:');

		sqlite.exec(`
			CREATE TABLE soft_delete_custom_records (
				id INTEGER PRIMARY KEY NOT NULL,
				name TEXT NOT NULL,
				deleted_on INTEGER,
				deleted_by TEXT
			);
			INSERT INTO soft_delete_custom_records (id, name, deleted_on, deleted_by)
			VALUES
				(1, 'Visible', NULL, NULL),
				(2, 'Archived', 1710000000, 'seed-user');
		`);

		const db = drizzle(sqlite, { schema: customSchema });
		const client = better(db, {
			plugins: [
				softDelete({
					column: 'deleted_on',
					deletedByColumn: 'deleted_by',
					defaults: {
						mode: 'hard',
						visibility: 'with',
					},
				}),
			],
			schema: customSchema,
		});

		const allRows = await client.customRecords.findMany({
			orderBy: { id: 'asc' },
		});

		expect(allRows).toHaveLength(2);

		await client.customRecords.delete({
			deletedBy: 'admin-user',
			where: { id: 1 },
		});

		const afterDelete = await client.customRecords.findMany({
			deleted: 'with',
			orderBy: { id: 'asc' },
		});

		expect(afterDelete).toHaveLength(1);
		expect(afterDelete[0]?.id).toBe(2);
		sqlite.close();
	});
});
