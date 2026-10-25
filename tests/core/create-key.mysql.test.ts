import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';

import { defineRelations, sql } from 'drizzle-orm';
import {
	int,
	json,
	mysqlTable,
	primaryKey,
	varchar,
} from 'drizzle-orm/mysql-core';
import { drizzle as drizzleProxy } from 'drizzle-orm/mysql-proxy';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { BetterDrizzleError, better } from '../../src';

let generatedKeys = 0;
const generated = mysqlTable('better_drizzle_create_generated', {
	recordKey: varchar('record_key', { length: 64 })
		.primaryKey()
		.$defaultFn(() => `generated-${++generatedKeys}`),
	payload: json('payload').$type<{ same: boolean }>().notNull(),
	label: varchar('label', { length: 64 }).notNull(),
});
const automatic = mysqlTable('better_drizzle_create_automatic', {
	recordKey: int('record_key').primaryKey().autoincrement(),
	payload: json('payload').$type<{ same: boolean }>().notNull(),
});
const compositeAutomatic = mysqlTable(
	'better_drizzle_create_composite_automatic',
	{
		recordKey: int('record_key').autoincrement().notNull(),
		tenantKey: int('tenant_key').notNull(),
		label: varchar('label', { length: 64 }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.recordKey, table.tenantKey] })],
);
const composite = mysqlTable(
	'better_drizzle_create_composite',
	{
		tenantKey: int('tenant_key').notNull(),
		recordKey: int('record_key').notNull().default(7),
		label: varchar('label', { length: 64 }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.tenantKey, table.recordKey] })],
);
const keyless = mysqlTable('better_drizzle_create_keyless', {
	label: varchar('label', { length: 64 }).notNull(),
});
const compositeGenerated = mysqlTable(
	'better_drizzle_create_composite_generated',
	{
		tenantKey: int('tenant_key').notNull(),
		recordKey: varchar('record_key', { length: 64 })
			.notNull()
			.$defaultFn(() => `generated-${++generatedKeys}`),
		label: varchar('label', { length: 64 }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.tenantKey, table.recordKey] })],
);
const serverGenerated = mysqlTable('better_drizzle_create_server_generated', {
	recordKey: varchar('record_key', { length: 64 })
		.primaryKey()
		.default(sql`(uuid())`),
	label: varchar('label', { length: 64 }).notNull(),
});
const children = mysqlTable('better_drizzle_create_children', {
	id: int('id').primaryKey(),
	parentKey: varchar('parent_key', { length: 64 }),
});
const profiles = mysqlTable('better_drizzle_create_profiles', {
	recordKey: varchar('record_key', { length: 64 }).primaryKey(),
	label: varchar('label', { length: 64 }).notNull(),
});
const relations = defineRelations(
	{
		generated,
		automatic,
		compositeAutomatic,
		composite,
		compositeGenerated,
		keyless,
		serverGenerated,
		children,
		profiles,
	},
	(r) => ({
		generated: { children: r.many.children() },
		children: {
			parent: r.one.generated({
				from: r.children.parentKey,
				to: r.generated.recordKey,
			}),
		},
		profiles: {
			parent: r.one.generated({
				from: r.profiles.recordKey,
				to: r.generated.recordKey,
			}),
		},
	}),
);
const MYSQL_URL = process.env.MYSQL_URL;

describe.skipIf(!MYSQL_URL)('create reload identity (MySQL)', () => {
	let connection: mysql.Connection;
	let db: ReturnType<typeof drizzle<typeof relations>>;
	let client: ReturnType<typeof better<typeof relations>>;
	let queries: string[];

	beforeAll(async () => {
		connection = await mysql.createConnection({
			uri: MYSQL_URL,
			multipleStatements: true,
		});
		await connection.query(`
			drop table if exists better_drizzle_create_generated, better_drizzle_create_automatic,
				better_drizzle_create_composite, better_drizzle_create_composite_generated,
				better_drizzle_create_keyless, better_drizzle_create_server_generated, better_drizzle_create_children,
				better_drizzle_create_composite_automatic, better_drizzle_create_profiles;
			create table better_drizzle_create_generated (
				record_key varchar(64) primary key, payload json not null, label varchar(64) not null
			);
			create table better_drizzle_create_automatic (
				record_key int primary key auto_increment, payload json not null
			);
			create table better_drizzle_create_composite (
				tenant_key int not null, record_key int not null default 7,
				label varchar(64) not null, primary key (tenant_key, record_key)
			);
			create table better_drizzle_create_keyless (label varchar(64) not null);
			create table better_drizzle_create_composite_automatic (
				record_key int not null auto_increment, tenant_key int not null,
				label varchar(64) not null, primary key (record_key, tenant_key)
			);
			create table better_drizzle_create_children (id int primary key, parent_key varchar(64));
			create table better_drizzle_create_profiles (record_key varchar(64) primary key, label varchar(64) not null);
			create table better_drizzle_create_composite_generated (
				tenant_key int not null, record_key varchar(64) not null,
				label varchar(64) not null, primary key (tenant_key, record_key)
			);
			create table better_drizzle_create_server_generated (
				record_key varchar(64) primary key default (uuid()), label varchar(64) not null
			);
		`);
		queries = [];
		db = drizzle({
			client: connection,
			relations,
			mode: 'default',
			logger: { logQuery: (query) => queries.push(query) },
		});
		client = better(db);
	});

	beforeEach(async () => {
		await connection.query(`
			delete from better_drizzle_create_generated;
			delete from better_drizzle_create_automatic;
			delete from better_drizzle_create_composite;
			delete from better_drizzle_create_composite_generated;
			delete from better_drizzle_create_keyless;
			delete from better_drizzle_create_server_generated;
			delete from better_drizzle_create_children;
			delete from better_drizzle_create_profiles;
			delete from better_drizzle_create_composite_automatic;
		`);
		generatedKeys = 0;
		queries.length = 0;
	});

	afterAll(async () => {
		await connection?.query(`drop table if exists better_drizzle_create_generated,
			better_drizzle_create_automatic, better_drizzle_create_composite, better_drizzle_create_composite_generated,
			better_drizzle_create_keyless, better_drizzle_create_server_generated, better_drizzle_create_children,
			better_drizzle_create_composite_automatic, better_drizzle_create_profiles`);
		await connection?.end();
	});

	test('uses the executed defaultFn key with mapped column names and duplicate JSON data', async () => {
		await db.insert(generated).values({
			recordKey: 'existing',
			payload: { same: true },
			label: 'same',
		});
		queries.length = 0;
		const created = await client.generated.create({
			data: { payload: { same: true }, label: 'same' },
		});
		expect(created).toEqual({
			recordKey: 'generated-1',
			payload: { same: true },
			label: 'same',
		});
		expect(generatedKeys).toBe(1);
		expect(
			queries.filter((query) => query.startsWith('insert ')),
		).toHaveLength(1);
		expect(
			queries
				.filter((query) => query.startsWith('select '))
				.every((query) => /where.*record_key/.test(query)),
		).toBe(true);
	});

	test('keeps projections and comments when reloading a generated key', async () => {
		const created = await client.generated.create({
			comment: 'generated.create',
			data: { payload: { same: true }, label: 'projected' },
			select: { label: true },
		});
		expect(created).toEqual({ label: 'projected' });
		expect(generatedKeys).toBe(1);
		expect(
			queries.filter((query) => query.includes('select ')),
		).toHaveLength(1);
		expect(
			queries.every((query) => query.startsWith('/* generated.create')),
		).toBe(true);
	});

	test('preserves caller-supplied keys on defaultFn columns', async () => {
		const created = await client.generated.create({
			data: {
				recordKey: 'explicit',
				payload: { same: true },
				label: 'explicit',
			},
		});
		expect(created?.recordKey).toBe('explicit');
		expect(generatedKeys).toBe(0);
	});

	test('returns null for a skipped duplicate without reloading the existing row', async () => {
		await db.insert(generated).values({
			recordKey: 'existing',
			payload: { same: true },
			label: 'old',
		});
		queries.length = 0;
		const created = await client.generated.create({
			data: {
				recordKey: 'existing',
				payload: { same: true },
				label: 'new',
			},
			skipDuplicates: true,
		});
		expect(created).toBeNull();
		expect(
			queries.filter((query) => query.startsWith('select ')),
		).toHaveLength(0);
	});

	test('uses the generated auto-increment key for identical JSON data', async () => {
		const first = await client.automatic.create({
			data: { payload: { same: true } },
		});
		const second = await client.automatic.create({
			data: { payload: { same: true } },
		});
		expect(second?.recordKey).toBeGreaterThan(first?.recordKey ?? 0);
		expect(second?.payload).toEqual({ same: true });
	});

	test('reloads MySQL auto-increment values generated from explicit zero', async () => {
		const created = await client.automatic.create({
			data: { recordKey: 0, payload: { same: true } },
		});
		expect(created?.recordKey).toBeGreaterThan(0);
	});

	test('preserves an explicit zero with NO_AUTO_VALUE_ON_ZERO', async () => {
		await connection.query(
			'set @better_drizzle_create_sql_mode = @@session.sql_mode',
		);
		try {
			await connection.query(
				"set session sql_mode = concat_ws(',', @@session.sql_mode, 'NO_AUTO_VALUE_ON_ZERO')",
			);
			const created = await client.automatic.create({
				data: { recordKey: 0, payload: { same: true } },
			});
			expect(created).toEqual({ recordKey: 0, payload: { same: true } });
		} finally {
			await connection.query(
				'set session sql_mode = @better_drizzle_create_sql_mode',
			);
		}
	});

	test('uses every supplied component of a composite primary key', async () => {
		await db
			.insert(composite)
			.values({ tenantKey: 1, recordKey: 1, label: 'same' });
		const created = await client.composite.create({
			data: { tenantKey: 1, recordKey: 2, label: 'same' },
		});
		expect(created).toEqual({ tenantKey: 1, recordKey: 2, label: 'same' });
	});

	test('materializes a composite primary key defaultFn exactly once', async () => {
		await db
			.insert(compositeGenerated)
			.values({ tenantKey: 1, recordKey: 'existing', label: 'same' });
		const created = await client.compositeGenerated.create({
			data: { tenantKey: 1, label: 'same' },
		});
		expect(created).toEqual({
			tenantKey: 1,
			recordKey: 'generated-1',
			label: 'same',
		});
		expect(generatedKeys).toBe(1);
	});

	test('uses a scalar default for an omitted composite primary key field', async () => {
		await db
			.insert(composite)
			.values({ tenantKey: 1, recordKey: 1, label: 'same' });
		const created = await client.composite.create({
			data: { tenantKey: 1, label: 'same' },
		});
		expect(created).toEqual({ tenantKey: 1, recordKey: 7, label: 'same' });
	});

	test('recovers the auto-increment component of a composite primary key', async () => {
		const first = await client.compositeAutomatic.create({
			data: { tenantKey: 1, label: 'same' },
		});
		const second = await client.compositeAutomatic.create({
			data: { tenantKey: 1, label: 'same' },
		});
		expect(second?.recordKey).toBeGreaterThan(first?.recordKey ?? 0);
		expect(second).toMatchObject({ tenantKey: 1, label: 'same' });
	});

	test('connects relations to the generated parent key and preserves include', async () => {
		await db.insert(children).values({ id: 1 });
		const created = await client.generated.create({
			data: {
				label: 'parent',
				payload: { same: true },
				children: { connect: { id: 1 } },
			},
			include: { children: true },
		});
		expect(created?.recordKey).toBe('generated-1');
		expect(created?.children).toEqual([
			{ id: 1, parentKey: 'generated-1' },
		]);
		expect(generatedKeys).toBe(1);
	});

	test('accepts a shared primary key supplied by a relation connect', async () => {
		await db.insert(generated).values({
			recordKey: 'shared',
			label: 'parent',
			payload: { same: true },
		});
		const created = await client.profiles.create({
			data: {
				label: 'profile',
				parent: { connect: { recordKey: 'shared' } },
			},
			include: { parent: true },
		});
		expect(created).toEqual({
			recordKey: 'shared',
			label: 'profile',
			parent: {
				recordKey: 'shared',
				label: 'parent',
				payload: { same: true },
			},
		});
	});

	test('rolls back a generated parent insert when relation connection fails', async () => {
		await db.insert(generated).values({
			recordKey: 'existing',
			label: 'same',
			payload: { same: true },
		});
		await expect(
			Promise.resolve(
				client.generated.create({
					data: {
						label: 'same',
						payload: { same: true },
						children: { connect: { id: 999 } },
					},
				}),
			),
		).rejects.toBeInstanceOf(BetterDrizzleError);
		expect(await client.generated.count()).toBe(1);
		expect(
			await client.generated.findUnique({
				where: { recordKey: 'existing' },
			}),
		).toMatchObject({ recordKey: 'existing' });
	});

	for (const [name, create, count] of [
		[
			'incomplete composite primary key',
			() =>
				client.compositeGenerated.create({
					data: { label: 'same' } as never,
				}),
			() => client.compositeGenerated.count(),
		],
		[
			'SQL-valued primary key',
			() =>
				client.composite.create({
					data: {
						tenantKey: 1,
						recordKey: sql`7`,
						label: 'same',
					} as never,
				}),
			() => client.composite.count(),
		],
		[
			'table without a primary key',
			() => client.keyless.create({ data: { label: 'same' } }),
			() => client.keyless.count(),
		],
		[
			'unavailable server-generated primary key',
			() => client.serverGenerated.create({ data: { label: 'same' } }),
			() => client.serverGenerated.count(),
		],
	] as const) {
		test(`rejects ${name} before inserting`, async () => {
			let error: unknown;
			try {
				await create();
			} catch (caught) {
				error = caught;
			}
			expect(error).toBeInstanceOf(BetterDrizzleError);
			expect((error as BetterDrizzleError).code).toBe('INVALID_ARGS');
			expect(await count()).toBe(0);
			expect(queries.some((query) => query.startsWith('insert '))).toBe(
				false,
			);
		});
	}
});

test('MySQL create rejects missing insertId for an auto-increment zero before reloading', async () => {
	const queries: string[] = [];
	const client = better(
		drizzleProxy(
			async (query) => {
				queries.push(query);
				return { rows: [{ affectedRows: 1 }] };
			},
			{ relations: defineRelations({ automatic }) },
		),
	);
	await expect(
		client.automatic.create({
			data: { recordKey: 0, payload: { same: true } },
		}),
	).rejects.toMatchObject({ code: 'OPERATION_ERROR' });
	expect(queries).toHaveLength(1);
	expect(queries[0]).toStartWith('insert ');
});
