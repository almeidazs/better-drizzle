import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';

import { DrizzleQueryError, defineRelations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
	check,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';
import { Client } from 'pg';

import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	better,
	definePlugin,
	getDatabaseErrorInfo,
	isCheckViolation,
	isForeignKeyViolation,
	isNotNullViolation,
	isUniqueViolation,
} from '../../src';
import { timestamps } from '../../src/plugins/timestamps';

// PostgreSQL side of the drizzle-orm 1.x migration coverage: SQLSTATE codes
// now arrive on DrizzleQueryError.cause, arrays are element columns with
// `dimensions`, and dataType is "<type> <constraint>".

const accounts = pgTable('better_drizzle_v1_accounts', {
	createdAt: timestamp('created_at', { withTimezone: true }),
	email: text('email')
		.notNull()
		.unique('better_drizzle_v1_accounts_email_key'),
	id: integer('id').primaryKey(),
	metadata: jsonb('metadata').$type<{ plan: { tier: string } }>(),
	name: text('name').notNull(),
	tags: text('tags').array(),
	updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }),
});

const invoices = pgTable(
	'better_drizzle_v1_invoices',
	{
		accountId: integer('account_id')
			.notNull()
			.references(() => accounts.id),
		amount: integer('amount').notNull(),
		id: integer('id').primaryKey(),
	},
	(table) => [
		check(
			'better_drizzle_v1_invoices_amount_check',
			sql`${table.amount} >= 0`,
		),
	],
);

const relations = defineRelations({ accounts, invoices }, (r) => ({
	accounts: { invoices: r.many.invoices() },
	invoices: {
		account: r.one.accounts({
			from: r.invoices.accountId,
			to: r.accounts.id,
		}),
	},
}));

const DATABASE_URL = process.env.DATABASE_URL;

const captureError = async (run: () => unknown) => {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error('Expected the call to throw.');
};

describe.skipIf(!DATABASE_URL)('Drizzle 1.x migration (PostgreSQL)', () => {
	let pg: Client;
	let db: ReturnType<typeof drizzle<typeof relations>>;
	let client: ReturnType<typeof better<typeof relations>>;

	beforeAll(async () => {
		pg = new Client({ connectionString: DATABASE_URL });
		await pg.connect();
		await pg.query(
			'drop table if exists better_drizzle_v1_invoices, better_drizzle_v1_accounts',
		);
		await pg.query(`
			create table better_drizzle_v1_accounts (
				id integer primary key,
				email text not null constraint better_drizzle_v1_accounts_email_key unique,
				name text not null,
				metadata jsonb,
				tags text[],
				created_at timestamptz,
				updated_at timestamptz
			);
			create table better_drizzle_v1_invoices (
				id integer primary key,
				account_id integer not null references better_drizzle_v1_accounts(id),
				amount integer not null
					constraint better_drizzle_v1_invoices_amount_check check (amount >= 0)
			);
		`);
		db = drizzle({ client: pg, relations });
		client = better(db);
	});

	beforeEach(async () => {
		await pg.query(
			'truncate better_drizzle_v1_invoices, better_drizzle_v1_accounts',
		);
		await pg.query(`
			insert into better_drizzle_v1_accounts (id, email, name, metadata, tags) values
				(1, 'alice@example.com', 'Alice', '{"plan":{"tier":"pro"}}', '{a,b}'),
				(2, 'bob@example.com', 'Bob', '{"plan":{"tier":"free"}}', '{}');
			insert into better_drizzle_v1_invoices (id, account_id, amount) values (1, 1, 100);
		`);
	});

	afterAll(async () => {
		await pg?.query(
			'drop table if exists better_drizzle_v1_invoices, better_drizzle_v1_accounts',
		);
		await pg?.end();
	});

	describe('single-row writes', () => {
		beforeEach(async () => {
			await pg.query(`
				insert into better_drizzle_v1_accounts (id, email, name) values
					(3, 'same1@example.com', 'Same'),
					(4, 'same2@example.com', 'Same');
			`);
		});

		test('update and delete touch one row when where matches several', async () => {
			const updated = await client.accounts.update({
				data: { name: 'Renamed' },
				where: { name: 'Same' },
			});
			expect(updated?.name).toBe('Renamed');
			expect(
				await client.accounts.count({ where: { name: 'Same' } }),
			).toBe(1);

			const deleted = await client.accounts.delete({
				where: { id: { in: [3, 4] } },
			});
			expect([3, 4]).toContain(deleted?.id ?? 0);
			expect(
				await client.accounts.count({ where: { id: { in: [3, 4] } } }),
			).toBe(1);
		});

		test('tables without a primary key are restricted through ctid', async () => {
			await pg.query(`
				drop table if exists better_drizzle_v1_tags;
				create table better_drizzle_v1_tags (label text not null, hits integer not null);
				insert into better_drizzle_v1_tags values ('a', 0), ('a', 0), ('a', 0);
			`);
			const tags = pgTable('better_drizzle_v1_tags', {
				hits: integer('hits').notNull(),
				label: text('label').notNull(),
			});
			const tagClient = better(
				drizzle({ client: pg, relations: defineRelations({ tags }) }),
			);

			try {
				await tagClient.tags.update({
					data: { hits: 1 },
					where: { label: 'a' },
				});
				expect(await tagClient.tags.count({ where: { hits: 1 } })).toBe(
					1,
				);
				await tagClient.tags.delete({ where: { label: 'a' } });
				expect(await tagClient.tags.count()).toBe(2);
			} finally {
				await pg.query('drop table better_drizzle_v1_tags');
			}
		});

		test('upsert by a unique column uses one ON CONFLICT statement', async () => {
			const queries: string[] = [];
			const logged = better(
				drizzle({
					client: pg,
					logger: { logQuery: (query) => queries.push(query) },
					relations,
				}),
			);

			const updated = await logged.accounts.upsert({
				create: { email: 'alice@example.com', id: 10, name: 'Ignored' },
				update: { name: 'Alice Upserted' },
				where: { email: 'alice@example.com' },
			});
			expect(updated).toMatchObject({ id: 1, name: 'Alice Upserted' });

			const created = await logged.accounts.upsert({
				create: { email: 'new@example.com', id: 11, name: 'New' },
				select: { id: true, name: true },
				update: { name: 'Ignored' },
				where: { email: 'new@example.com' },
			});
			expect(created).toEqual({ id: 11, name: 'New' });
			expect(
				queries.filter((query) =>
					query.includes('on conflict ("email") do update'),
				),
			).toHaveLength(2);
		});
	});

	describe('batch writes', () => {
		test('typed upsert predicates filter existing conflicts while new rows still insert', async () => {
			const result = await client.accounts.upsertMany({
				batchSize: 1,
				data: [
					{
						id: 1,
						email: 'alice@example.com',
						name: 'Alice updated',
					},
					{ id: 2, email: 'bob@example.com', name: 'Bob skipped' },
					{ id: 3, email: 'new@example.com', name: 'New account' },
				],
				target: 'email',
				update: ['name'],
				select: { id: true, name: true },
				where: {
					AND: [
						{ id: { lt: 3 } },
						{ metadata: { 'plan.tier': 'pro' } },
					],
				},
			});
			expect(result).toEqual({
				count: 2,
				data: [
					{ id: 1, name: 'Alice updated' },
					{ id: 3, name: 'New account' },
				],
			});
			expect(
				await client.accounts.findUnique({ where: { id: 2 } }),
			).toMatchObject({ name: 'Bob' });
		});

		test('createMany batchSize concatenates returned rows in input order', async () => {
			expect(
				await client.accounts.createMany({
					batchSize: 2,
					data: [
						{ email: 'c@example.com', id: 10, name: 'C' },
						{ email: 'alice@example.com', id: 11, name: 'Dup' },
						{ email: 'd@example.com', id: 12, name: 'D' },
						{ email: 'e@example.com', id: 13, name: 'E' },
						{ email: 'f@example.com', id: 14, name: 'F' },
					],
					select: { id: true, name: true },
					skipDuplicates: true,
				}),
			).toEqual({
				count: 4,
				data: [
					{ id: 10, name: 'C' },
					{ id: 12, name: 'D' },
					{ id: 13, name: 'E' },
					{ id: 14, name: 'F' },
				],
			});
		});

		test('updateMany returns complete changed rows and scalar projections', async () => {
			const before = await client.accounts.findUnique({
				where: { id: 2 },
			});
			expect(
				await client.accounts.updateMany({
					data: { name: 'Renamed' },
					where: { name: 'Bob' },
				}),
			).toEqual({ count: 1, data: [{ ...before, name: 'Renamed' }] });
			expect(
				await client.accounts.updateMany({
					data: { name: 'Projected' },
					select: { id: true, name: true },
					where: { id: 2 },
				}),
			).toEqual({ count: 1, data: [{ id: 2, name: 'Projected' }] });
		});

		test('deleteMany returns deleted preimages and scalar projections', async () => {
			const before = await client.accounts.findUnique({
				where: { id: 2 },
			});
			expect(
				await client.accounts.deleteMany({ where: { id: 2 } }),
			).toEqual({ count: 1, data: [before] });
			expect(
				await client.invoices.deleteMany({
					select: { id: true, amount: true },
					where: { id: 1 },
				}),
			).toEqual({ count: 1, data: [{ id: 1, amount: 100 }] });
			expect(
				await client.accounts.findUnique({ where: { id: 2 } }),
			).toBeNull();
		});
	});

	describe('driver errors', () => {
		test('raw Drizzle wraps the pg error, helpers read its SQLSTATE', async () => {
			const error = await captureError(() =>
				db.insert(accounts).values({
					email: 'alice@example.com',
					id: 3,
					name: 'Dup',
				}),
			);

			expect(error).toBeInstanceOf(DrizzleQueryError);
			expect((error as { code?: unknown }).code).toBeUndefined();
			expect((error as { cause?: { code?: string } }).cause?.code).toBe(
				'23505',
			);
			expect(getDatabaseErrorInfo(error)).toMatchObject({
				code: '23505',
				constraint: 'better_drizzle_v1_accounts_email_key',
				driver: 'pg',
			});
			expect(
				isUniqueViolation(
					error,
					'better_drizzle_v1_accounts_email_key',
				),
			).toBe(true);
			expect(isUniqueViolation(error, 'another_constraint')).toBe(false);
		});

		test('delegates surface every constraint class', async () => {
			const unique = await captureError(() =>
				client.accounts.create({
					data: { email: 'bob@example.com', id: 3, name: 'Dup' },
				}),
			);
			expect(isUniqueViolation(unique)).toBe(true);

			const foreignKey = await captureError(() =>
				client.invoices.create({
					data: { accountId: 404, amount: 1, id: 2 },
				}),
			);
			expect(isForeignKeyViolation(foreignKey)).toBe(true);

			const notNull = await captureError(() =>
				client.accounts.create({
					data: {
						email: 'n@example.com',
						id: 4,
						name: null as never,
					},
				}),
			);
			expect(isNotNullViolation(notNull)).toBe(true);

			const checkError = await captureError(() =>
				client.invoices.create({
					data: { accountId: 1, amount: -1, id: 3 },
				}),
			);
			expect(
				isCheckViolation(
					checkError,
					'better_drizzle_v1_invoices_amount_check',
				),
			).toBe(true);
		});

		test('BetterDrizzleError.from keeps SQLSTATE and constraint', async () => {
			const error = await captureError(() =>
				db.insert(accounts).values({
					email: 'bob@example.com',
					id: 3,
					name: 'Dup',
				}),
			);
			const normalized = BetterDrizzleError.from(error);

			expect(normalized).toMatchObject({
				code: BetterDrizzleErrorCode.DatabaseError,
				constraint: 'better_drizzle_v1_accounts_email_key',
				driver: 'pg',
				sqlState: '23505',
			});
		});

		// The transaction wraps the DrizzleQueryError in an OPERATION_ERROR;
		// the helpers must still reach the driver error underneath.
		test('a failed statement inside a transaction still classifies', async () => {
			const error = await captureError(() =>
				client.transaction(async (tx) => {
					await tx.accounts.create({
						data: {
							email: 'c@example.com',
							id: 3,
							name: 'Carol',
						},
					});
					await tx.accounts.create({
						data: {
							email: 'alice@example.com',
							id: 4,
							name: 'Dup',
						},
					});
				}),
			);

			expect(isUniqueViolation(error)).toBe(true);
			expect(await client.accounts.count()).toBe(2);
		});

		test('helpers classify pg errors when an operation hook is configured', async () => {
			const hooked = better(db, { hooks: { beforeCreate() {} } });

			const error = await captureError(() =>
				hooked.accounts.create({
					data: {
						email: 'alice@example.com',
						id: 3,
						name: 'Dup',
					},
				}),
			);
			expect(error).toBeInstanceOf(BetterDrizzleError);
			expect(
				isUniqueViolation(
					error,
					'better_drizzle_v1_accounts_email_key',
				),
			).toBe(true);
		});
	});

	describe('column metadata', () => {
		test('array columns are element columns with dimensions', () => {
			let tags: Record<string, unknown> | undefined;

			better(db, {
				plugins: [
					definePlugin({
						id: 'inspect-columns',
						setup(context) {
							tags = context.models.accounts?.columns
								.tags as never;
						},
					}),
				],
			});

			expect(tags?.columnType).toBe('PgText');
			expect(tags?.dimensions).toBe(1);
			expect(tags?.baseColumn).toBeUndefined();
		});

		test('array filters and mutations run on the element column', async () => {
			expect(
				await client.accounts.count({ where: { tags: { has: 'a' } } }),
			).toBe(1);
			expect(
				await client.accounts.count({
					where: { tags: { isEmpty: true } },
				}),
			).toBe(1);

			await client.accounts.update({
				data: { tags: { append: ['c'] } },
				where: { id: 1 },
			});
			const alice = await client.accounts.findUnique({
				select: { tags: true },
				where: { id: 1 },
			});
			expect(alice?.tags).toEqual(['a', 'b', 'c']);
		});

		test('jsonb path filters and mutations work on the 1.x jsonb column', async () => {
			expect(
				await client.accounts.count({
					where: { metadata: { 'plan.tier': { equals: 'pro' } } },
				}),
			).toBe(1);

			await client.accounts.update({
				data: { metadata: { 'plan.tier': 'team' } },
				where: { id: 2 },
			});
			const bob = await client.accounts.findUnique({
				select: { metadata: true },
				where: { id: 2 },
			});
			expect(bob?.metadata).toEqual({ plan: { tier: 'team' } });
		});

		test('timestamps writes Date or string based on the column mode', async () => {
			const stamped = better(db, { plugins: [timestamps()] });

			await stamped.accounts.create({
				data: { email: 't@example.com', id: 9, name: 'Stamped' },
			});
			const row = await client.accounts.findUnique({ where: { id: 9 } });

			expect(row?.createdAt).toBeInstanceOf(Date);
			expect(typeof row?.updatedAt).toBe('string');
			expect(Number.isNaN(Date.parse(row?.updatedAt ?? ''))).toBe(false);
		});
	});
});
