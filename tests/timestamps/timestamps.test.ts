import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';
import { timestamps } from '../../src/plugins/timestamps';

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

const textRecords = sqliteTable('timestamp_text_records', {
	createdAt: text('created_at'),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	updatedAt: text('updated_at'),
});

const schema = { basicRecords, records, textRecords };

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
		CREATE TABLE timestamp_text_records (
			id INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			created_at TEXT,
			updated_at TEXT
		);
		INSERT INTO timestamp_records (id, name, created_at, updated_at)
		VALUES (1, 'Alice', NULL, NULL);
	`);

	return {
		db: drizzle({
			client: sqlite,
			relations: defineRelations(schema),
		}),
		close() {
			sqlite.close();
		},
	};
};

describe('better-drizzle/timestamps', () => {
	test('serializes timestamps for text columns on create and update', async () => {
		const ctx = createContext();
		try {
			const client = better(ctx.db, { plugins: [timestamps()] });
			const created = await client.textRecords.create({
				data: { id: 1, name: 'Text timestamp' },
			});
			expect(created?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(created?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

			const updated = await client.textRecords.update({
				data: { name: 'Updated' },
				where: { id: 1 },
			});
			expect(updated?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		} finally {
			ctx.close();
		}
	});

	test('sets createdAt and updatedAt on create in app mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps()],
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
		});

		const updated = await client.records.update({
			data: { name: 'Alice Updated' },
			where: { id: 1 },
		});

		expect(updated?.updatedAt).toBeInstanceOf(Date);
		ctx.close();
	});

	test('sets updatedAt on updateEach in app mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps()],
		});

		const result = await client.records.updateEach({
			by: schema.records.id,
			data: [{ id: 1, name: 'Alice Updated' }],
			select: { id: true, updatedAt: true },
			update: {
				name: (row) => row.name,
			},
		});

		expect(result.count).toBe(1);
		expect(result.data?.[0]?.updatedAt).toBeInstanceOf(Date);
		ctx.close();
	});

	test('sets timestamps for createMany in app mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps()],
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

	test('stamps insert rows and conflict updates on upsertMany in app mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps()],
		});

		const result = await client.records.upsertMany({
			data: [
				{ id: 1, name: 'Alice Updated' },
				{ id: 2, name: 'Bob' },
			],
			target: 'id',
			update: 'all',
		});

		const updated = await client.records.findFirst({ where: { id: 1 } });
		const created = await client.records.findFirst({ where: { id: 2 } });

		expect(result.count).toBe(2);
		expect(updated?.updatedAt).toBeInstanceOf(Date);
		expect(updated?.createdAt ?? null).toBeNull();
		expect(created?.createdAt).toBeInstanceOf(Date);
		expect(created?.updatedAt).toBeInstanceOf(Date);
		ctx.close();
	});

	test('does nothing in database mode', async () => {
		const ctx = createContext();
		const client = better(ctx.db, {
			plugins: [timestamps({ mode: 'database' })],
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

		const db = drizzle({
			client: sqlite,
			relations: defineRelations(customSchema),
		});
		const client = better(db, {
			plugins: [
				timestamps({
					createdAt: 'created_on',
					updatedAt: 'updated_on',
				}),
			],
		});

		const created = await client.customRecords.create({
			data: { id: 1, name: 'Custom' },
		});

		expect(created?.created_on).toBeInstanceOf(Date);
		expect(created?.updated_on).toBeInstanceOf(Date);
		sqlite.close();
		ctx.close();
	});

	describe('now', () => {
		const fixed = new Date('2026-01-02T03:04:05.000Z');
		const now = () => fixed;

		test('stamps creates with one exact value', async () => {
			const ctx = createContext();
			try {
				const client = better(ctx.db, {
					plugins: [timestamps({ now })],
				});
				const created = await client.records.create({
					data: { id: 2, name: 'Bob' },
				});
				expect(created?.createdAt?.getTime()).toBe(fixed.getTime());
				expect(created?.updatedAt?.getTime()).toBe(fixed.getTime());

				const text = await client.textRecords.create({
					data: { id: 1, name: 'Text' },
				});
				expect(text?.createdAt).toBe(fixed.toISOString());
				expect(text?.updatedAt).toBe(fixed.toISOString());

				const many = await client.records.createMany({
					data: [
						{ id: 3, name: 'Carol' },
						{ id: 4, name: 'Dan' },
					],
				});
				for (const row of many.data ?? []) {
					expect(row.createdAt?.getTime()).toBe(fixed.getTime());
					expect(row.updatedAt?.getTime()).toBe(fixed.getTime());
				}
			} finally {
				ctx.close();
			}
		});

		test('calls the clock once per write', async () => {
			const ctx = createContext();
			try {
				let calls = 0;
				const client = better(ctx.db, {
					plugins: [
						timestamps({
							now: () => {
								calls += 1;
								return new Date(calls * 1000);
							},
						}),
					],
				});
				const created = await client.records.create({
					data: { id: 2, name: 'Bob' },
				});
				expect(calls).toBe(1);
				expect(created?.createdAt?.getTime()).toBe(1000);
				expect(created?.updatedAt?.getTime()).toBe(1000);
			} finally {
				ctx.close();
			}
		});

		test('stamps updates and upserts with the clock', async () => {
			const ctx = createContext();
			try {
				const client = better(ctx.db, {
					plugins: [timestamps({ now })],
				});
				const time = fixed.getTime();

				const updated = await client.records.update({
					data: { name: 'Alice Updated' },
					where: { id: 1 },
				});
				expect(updated?.updatedAt?.getTime()).toBe(time);

				await client.records.create({ data: { id: 2, name: 'Bob' } });
				const many = await client.records.updateMany({
					data: { name: 'All' },
					where: { id: { in: [1, 2] } },
				});
				expect(many.count).toBe(2);

				const each = await client.records.updateEach({
					by: schema.records.id,
					data: [{ id: 1, name: 'One' }],
					select: { id: true, updatedAt: true },
					update: { name: (row) => row.name },
				});
				expect(each.data?.[0]?.updatedAt?.getTime()).toBe(time);

				const upserted = await client.records.upsert({
					create: { id: 3, name: 'Carol' },
					update: { name: 'Carol Updated' },
					where: { id: 3 },
				});
				expect(upserted?.createdAt?.getTime()).toBe(time);
				expect(upserted?.updatedAt?.getTime()).toBe(time);

				await client.records.upsertMany({
					data: [
						{ id: 1, name: 'Alice Again' },
						{ id: 4, name: 'Dan' },
					],
					target: 'id',
					update: 'all',
				});
				const rows = await client.records.findMany({
					orderBy: { id: 'asc' },
				});
				expect(rows).toHaveLength(4);
				for (const row of rows)
					expect(row.updatedAt?.getTime()).toBe(time);
				expect(rows[0]?.createdAt ?? null).toBeNull();
				expect(rows[3]?.createdAt?.getTime()).toBe(time);
			} finally {
				ctx.close();
			}
		});
	});

	describe('models', () => {
		const createCustomContext = () => {
			const legacy = sqliteTable('timestamp_legacy_records', {
				created: integer('created', { mode: 'timestamp' }),
				createdAt: integer('created_at', { mode: 'timestamp' }),
				id: integer('id').primaryKey(),
				modified: integer('modified', { mode: 'timestamp' }),
			});
			const customSchema = { ...schema, legacy };
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
				CREATE TABLE timestamp_text_records (
					id INTEGER PRIMARY KEY NOT NULL,
					name TEXT NOT NULL,
					created_at TEXT,
					updated_at TEXT
				);
				CREATE TABLE timestamp_legacy_records (
					id INTEGER PRIMARY KEY NOT NULL,
					created INTEGER,
					created_at INTEGER,
					modified INTEGER
				);
			`);
			return {
				close: () => sqlite.close(),
				db: drizzle({
					client: sqlite,
					relations: defineRelations(customSchema),
				}),
			};
		};

		test('overrides column names per model', async () => {
			const ctx = createCustomContext();
			try {
				const client = better(ctx.db, {
					plugins: [
						timestamps({
							models: {
								legacy: {
									createdAt: 'created',
									updatedAt: 'modified',
								},
							},
						}),
					],
				});
				const legacy = await client.legacy.create({ data: { id: 1 } });
				expect(legacy?.created).toBeInstanceOf(Date);
				expect(legacy?.modified).toBeInstanceOf(Date);
				expect(legacy?.createdAt ?? null).toBeNull();

				const record = await client.records.create({
					data: { id: 1, name: 'Default' },
				});
				expect(record?.createdAt).toBeInstanceOf(Date);
			} finally {
				ctx.close();
			}
		});

		test('disables a model with false', async () => {
			const ctx = createCustomContext();
			try {
				const client = better(ctx.db, {
					plugins: [timestamps({ models: { records: false } })],
				});
				const created = await client.records.create({
					data: { id: 1, name: 'Off' },
				});
				expect(created?.createdAt ?? null).toBeNull();
				expect(created?.updatedAt ?? null).toBeNull();

				const updated = await client.records.update({
					data: { name: 'Still off' },
					where: { id: 1 },
				});
				expect(updated?.updatedAt ?? null).toBeNull();

				const text = await client.textRecords.create({
					data: { id: 1, name: 'On' },
				});
				expect(text?.createdAt).toMatch(/^\d{4}-/);
			} finally {
				ctx.close();
			}
		});

		test('fails fast when an overridden column is missing', () => {
			const ctx = createCustomContext();
			try {
				expect(() =>
					better(ctx.db, {
						plugins: [
							timestamps({
								models: { records: { updatedAt: 'modified' } },
							}),
						],
					}),
				).toThrow(
					expect.objectContaining({
						code: 'PLUGIN_REQUIRED_COLUMN_MISSING',
						column: 'modified',
						table: 'records',
					}),
				);
			} finally {
				ctx.close();
			}
		});

		test('ignores unknown model keys', async () => {
			const ctx = createCustomContext();
			try {
				const client = better(ctx.db, {
					plugins: [timestamps({ models: { missing: false } })],
				});
				const created = await client.records.create({
					data: { id: 1, name: 'Bob' },
				});
				expect(created?.createdAt).toBeInstanceOf(Date);
			} finally {
				ctx.close();
			}
		});
	});
});
