import {
	better,
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	BetterDrizzleTransactionRollbackError,
	definePlugin,
	getDatabaseErrorInfo,
	isCheckViolation,
	isDatabaseError,
	isForeignKeyViolation,
	isNotNullViolation,
	isUniqueViolation,
	version,
} from 'better-drizzle';
import type {
	AnyPlugin,
	BatchResult,
	BetterClientOptions,
	BetterDrizzleClient,
	BetterDrizzleModelDelegate,
	BetterDrizzleTransactionClient,
	BetterRecord,
	BetterRepositoryKey,
	BetterTableKey,
	DatabaseErrorInfo,
	PluginSetupContext,
	RawExecutionResult,
	WhereArg,
} from 'better-drizzle';
import { definePlugin as definePluginFromPlugins } from 'better-drizzle/plugins';
import rulesDefault, {
	merge,
	recommended,
	rules,
	safe,
	strict,
} from 'better-drizzle/rules';
import type { RulesPluginOptions } from 'better-drizzle/rules';
import softDeleteDefault, { softDelete } from 'better-drizzle/soft-delete';
import type { SoftDeleteVisibility } from 'better-drizzle/soft-delete';
import timestampsDefault, { timestamps } from 'better-drizzle/timestamps';
import zodDefault, { zod } from 'better-drizzle/zod';
import { defineRelations, sql } from 'drizzle-orm';
import type { Table } from 'drizzle-orm';
import { int, mysqlTable, varchar as myVarchar } from 'drizzle-orm/mysql-core';
import {
	boolean,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';
import {
	integer as sqliteInteger,
	sqliteTable,
	text as sqliteText,
} from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';

import ataDefault, { ata } from '../plugins/ata/index';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

// ---------------------------------------------------------------------------
// Schemas (TS keys differ from DB names on purpose)
// ---------------------------------------------------------------------------

const people = pgTable('client_pg_people', {
	id: serial('person_id').primaryKey(),
	email: text('email_address').notNull(),
	tenantId: text('tenant_ref').notNull(),
	deletedAt: timestamp('deleted_at'),
	deletedById: text('deleted_by'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
	active: boolean('is_active').notNull().default(true),
});
const notes = pgTable('client_pg_notes', {
	id: serial('note_id').primaryKey(),
	personId: integer('owner_person_id').notNull(),
	body: text('note_body').notNull(),
});
const relations = defineRelations({ people, notes }, (r) => ({
	people: { notes: r.many.notes() },
	notes: {
		person: r.one.people({ from: r.notes.personId, to: r.people.id }),
	},
}));
type Schema = typeof relations;
type Person = typeof people.$inferSelect;
type Note = typeof notes.$inferSelect;

declare const raw: { readonly _: { readonly relations: typeof relations } };

const sqliteThings = sqliteTable('client_sqlite_things', {
	id: sqliteInteger('thing_id').primaryKey(),
	label: sqliteText('thing_label').notNull(),
});
const sqliteRelations = defineRelations({ sqliteThings });
declare const sqliteRaw: {
	readonly _: { readonly relations: typeof sqliteRelations };
};

const mysqlWidgets = mysqlTable('client_mysql_widgets', {
	id: int('widget_id').primaryKey().autoincrement(),
	sku: myVarchar('sku_code', { length: 64 }).notNull(),
});
const mysqlRelations = defineRelations({ mysqlWidgets });
declare const mysqlRaw: {
	readonly _: { readonly relations: typeof mysqlRelations };
};

// ---------------------------------------------------------------------------
// better(...) inference and options
// ---------------------------------------------------------------------------

const db = better(raw);
assertType<Equal<typeof db, BetterDrizzleClient<Schema>>>();

const sqliteDb = better(sqliteRaw);
assertType<
	Equal<typeof sqliteDb, BetterDrizzleClient<typeof sqliteRelations>>
>();
const mysqlDb = better(mysqlRaw);
assertType<Equal<typeof mysqlDb, BetterDrizzleClient<typeof mysqlRelations>>>();

// @ts-expect-error `schema` is no longer an option; it is inferred from db._.relations
better(raw, { schema: { people, notes } });
// @ts-expect-error the Drizzle instance must expose `_.relations`
better({});
// @ts-expect-error a plain schema object is not a Drizzle instance
better({ people, notes });

better(raw, {
	raw: {
		enabled: true,
		allowUnsafe: true,
		requireComment: false,
		timeoutMs: 1000,
		log: true,
		unsupportedOptions: 'warn',
	},
	locks: { transactionsOnly: true },
	transaction: { unsupportedOptions: 'throw' },
});
// @ts-expect-error raw.unsupportedOptions is a closed union
better(raw, { raw: { unsupportedOptions: 'explode' } });
// @ts-expect-error transaction.unsupportedOptions is a closed union
better(raw, { transaction: { unsupportedOptions: 'explode' } });
// @ts-expect-error locks.transactionsOnly is boolean
better(raw, { locks: { transactionsOnly: 'yes' } });

// hooks
better(raw, {
	hooks: {
		beforeQuery(ctx) {
			assertType<Equal<typeof ctx.schema, Schema>>();
			assertType<Equal<typeof ctx.table, 'people' | 'notes'>>();
			if (ctx.table === 'people') {
				assertType<Equal<typeof ctx.tableInstance, typeof people>>();
				assertType<
					Equal<
						typeof ctx.repository,
						BetterDrizzleModelDelegate<Schema, 'people'>
					>
				>();
				if (ctx.action === 'findMany') {
					const where: WhereArg<Schema, 'people'> | undefined =
						ctx.args?.where;
					void where;
				}
			}
		},
		afterQuery(ctx) {
			if (ctx.table === 'notes' && ctx.action === 'findMany')
				assertType<Equal<typeof ctx.result, Note[]>>();
			if (ctx.table === 'people' && ctx.action === 'findFirst')
				assertType<Equal<typeof ctx.result, Person | null>>();
			if (ctx.action === 'count')
				assertType<Equal<typeof ctx.result, number>>();
			if (ctx.action === 'exists')
				assertType<Equal<typeof ctx.result, boolean>>();
			if (ctx.table === 'people' && ctx.action === 'paginate')
				assertType<Equal<typeof ctx.result.data, Person[]>>();
			if (ctx.table === 'people' && ctx.action === 'cursor')
				assertType<
					Equal<typeof ctx.result.pagination.type, 'cursor'>
				>();
		},
		beforeCreate(ctx) {
			assertType<
				Equal<
					typeof ctx.action,
					'create' | 'upsert' | 'createMany' | 'upsertMany'
				>
			>();
			if (ctx.table === 'people' && ctx.action === 'createMany')
				assertType<
					Equal<typeof ctx.args.data, (typeof people.$inferInsert)[]>
				>();
		},
		afterCreate(ctx) {
			if (ctx.table === 'people' && ctx.action === 'create')
				assertType<Equal<typeof ctx.result, Person>>();
			if (ctx.table === 'people' && ctx.action === 'createMany')
				assertType<Equal<typeof ctx.result, BatchResult<Person>>>();
			assertType<
				Equal<
					typeof ctx.compiled,
					Readonly<Record<string, unknown>> | undefined
				>
			>();
		},
		beforeUpdate(ctx) {
			assertType<
				Equal<
					typeof ctx.action,
					'update' | 'upsert' | 'updateEach' | 'updateMany'
				>
			>();
		},
		afterUpdate(ctx) {
			if (ctx.table === 'people' && ctx.action === 'update')
				assertType<Equal<typeof ctx.result, Person | null>>();
			if (ctx.action === 'updateMany')
				assertType<Equal<typeof ctx.result, BatchResult<never>>>();
		},
		beforeDelete(ctx) {
			assertType<Equal<typeof ctx.action, 'delete' | 'deleteMany'>>();
		},
		afterDelete(ctx) {
			if (ctx.table === 'notes' && ctx.action === 'delete')
				assertType<Equal<typeof ctx.result, Note | null>>();
		},
		beforeTransaction(ctx) {
			assertType<Equal<typeof ctx.isInTransaction, true>>();
			assertType<Equal<typeof ctx.depth, number>>();
			assertType<
				Equal<typeof ctx.client, BetterDrizzleTransactionClient<Schema>>
			>();
			assertType<Equal<typeof ctx.schema, Schema>>();
		},
		afterTransactionRollback(ctx) {
			assertType<Equal<typeof ctx.reason, unknown>>();
		},
		onTransactionError(ctx) {
			assertType<Equal<typeof ctx.error, unknown>>();
		},
		beforeRaw(ctx) {
			assertType<
				Equal<typeof ctx.action, 'raw' | 'executeRaw' | 'rawUnsafe'>
			>();
			assertType<Equal<typeof ctx.query, string>>();
		},
		afterRaw(ctx) {
			if (ctx.action === 'executeRaw')
				assertType<Equal<typeof ctx.result, RawExecutionResult>>();
			else assertType<Equal<typeof ctx.result, unknown[]>>();
		},
		onRawError(ctx) {
			assertType<Equal<typeof ctx.error, unknown>>();
		},
		onError(ctx) {
			assertType<Equal<typeof ctx.table, 'people' | 'notes'>>();
			assertType<Equal<typeof ctx.tableInstance, Table>>();
			assertType<Equal<typeof ctx.schema, Schema>>();
		},
	},
});
better(raw, {
	hooks: {
		beforeQuery(ctx) {
			// @ts-expect-error ctx.table only contains TS table keys
			if (ctx.table === 'client_pg_people') return;
		},
	},
});
better(raw, {
	hooks: {
		// @ts-expect-error unknown hook names are rejected
		beforeEverything() {},
	},
});

// ---------------------------------------------------------------------------
// Client surface
// ---------------------------------------------------------------------------

export const clientSurface = async () => {
	// every table delegate exists
	assertType<
		Equal<typeof db.people, BetterDrizzleModelDelegate<Schema, 'people'>>
	>();
	assertType<
		Equal<typeof db.notes, BetterDrizzleModelDelegate<Schema, 'notes'>>
	>();
	assertType<
		Equal<typeof sqliteDb.sqliteThings.$model.name, 'sqliteThings'>
	>();
	assertType<Equal<typeof mysqlDb.mysqlWidgets.$model.dbName, string>>();
	// @ts-expect-error DB table names are not client properties
	void db.client_pg_people;
	// @ts-expect-error unknown tables do not exist
	void db.accounts;

	const delegateKeys = [
		'findMany',
		'findFirst',
		'findOne',
		'findUnique',
		'create',
		'createMany',
		'update',
		'updateEach',
		'updateMany',
		'delete',
		'deleteMany',
		'upsert',
		'upsertMany',
		'count',
		'exists',
		'paginate',
		'cursor',
		'$withState',
		'$withoutPlugins',
		'$model',
		'$state',
	] as const satisfies readonly (keyof typeof db.people)[];
	void delegateKeys;

	// repository(): TS key and DB name resolve to the same delegate
	assertType<
		Equal<ReturnType<typeof db.repository<'people'>>, typeof db.people>
	>();
	const byDbName = db.repository('client_pg_people');
	assertType<Equal<typeof byDbName, typeof db.people>>();
	assertType<
		Equal<
			ReturnType<typeof db.repository<'client_pg_notes'>>,
			typeof db.notes
		>
	>();
	assertType<
		Equal<
			BetterRepositoryKey<Schema>,
			'people' | 'notes' | 'client_pg_people' | 'client_pg_notes'
		>
	>();
	assertType<Equal<BetterTableKey<Schema>, 'people' | 'notes'>>();
	assertType<Equal<BetterRecord<Schema, 'notes'>, Note>>();
	// @ts-expect-error unknown repository names are rejected
	db.repository('accounts');
	const found = await byDbName.findMany();
	assertType<Equal<typeof found, Person[]>>();

	// $withState / $withoutPlugins keep the delegate type
	assertType<
		Equal<ReturnType<typeof db.people.$withState>, typeof db.people>
	>();
	assertType<
		Equal<ReturnType<typeof db.people.$withoutPlugins>, typeof db.people>
	>();
	db.people.$withState({ traceId: 'x' });
	// @ts-expect-error plugin state is an object record
	db.people.$withState('x');

	// $withContext
	const scoped = db.$withContext({ requestId: 'r1' });
	assertType<Equal<typeof scoped, typeof db>>();

	// raw SQL
	const tagged = await db.$raw`select 1`;
	assertType<Equal<typeof tagged, unknown[]>>();
	const typedRows = await db.$raw<{ id: number }>(sql`select 1 as id`);
	assertType<Equal<typeof typedRows, { id: number }[]>>();
	const mapped = await db.$raw(sql`select 1 as id`, {
		map: (row: { id: number }) => String(row.id),
		name: 'q',
		comment: 'c',
		timeoutMs: 10,
		meta: { a: 1 },
	});
	assertType<Equal<typeof mapped, string[]>>();
	// @ts-expect-error safe $raw rejects plain strings
	db.$raw('select 1');
	const exec = await db.$executeRaw`delete from x`;
	assertType<Equal<typeof exec, RawExecutionResult>>();
	assertType<Equal<typeof exec.rowsAffected, number | undefined>>();
	const exec2 = await db.$executeRaw(sql`delete from x`, { comment: 'c' });
	assertType<Equal<typeof exec2, RawExecutionResult>>();
	// @ts-expect-error safe $executeRaw rejects plain strings
	db.$executeRaw('delete from x');
	const unsafe = await db.$rawUnsafe('select ?', [1]);
	assertType<Equal<typeof unsafe, unknown[]>>();
	const unsafeTyped = await db.$rawUnsafe<{ n: number }>('select 1 as n');
	assertType<Equal<typeof unsafeTyped, { n: number }[]>>();
	const unsafeMapped = await db.$rawUnsafe('select 1 as n', undefined, {
		map: (row: { n: number }) => row.n > 0,
	});
	assertType<Equal<typeof unsafeMapped, boolean[]>>();
	// @ts-expect-error $rawUnsafe takes a string, not a SQL object
	db.$rawUnsafe(sql`select 1`);
	// @ts-expect-error $rawUnsafe params are an array
	db.$rawUnsafe('select ?', 1);

	// transactions
	const txResult = await db.transaction(
		async (tx) => {
			assertType<
				Equal<typeof tx, BetterDrizzleTransactionClient<Schema>>
			>();
			assertType<Equal<typeof tx.people, typeof db.people>>();
			assertType<Equal<ReturnType<typeof tx.rollback>, never>>();
			tx.afterCommit(() => undefined);
			tx.afterCommit(async () => {});
			tx.afterRollback(() => 1);
			const nested = await tx.transaction(async (inner) => {
				assertType<
					Equal<typeof inner, BetterDrizzleTransactionClient<Schema>>
				>();
				inner.rollback('reason');
				return 1 as const;
			});
			assertType<Equal<typeof nested, 1>>();
			const txScoped = tx.$withContext({ a: 1 });
			assertType<Equal<typeof txScoped.people, typeof tx.people>>();
			// scoped transaction clones keep the transaction methods
			assertType<
				Equal<typeof txScoped, BetterDrizzleTransactionClient<Schema>>
			>();
			txScoped.afterCommit(() => {});
			txScoped.afterRollback(() => {});
			await tx.$raw`select 1`;
			await tx.people.create({
				data: { email: 'a', tenantId: 't' },
			});
			return { ok: true as const };
		},
		{
			isolationLevel: 'serializable',
			readOnly: false,
			retries: { attempts: 3, on: ['deadlock'], delayMs: (n) => n * 10 },
			timeoutMs: 100,
			name: 'tx',
			comment: 'c',
			context: { k: 1 },
			meta: { requestId: 'r' },
		},
	);
	assertType<Equal<typeof txResult, { ok: true }>>();
	const syncTx = await db.transaction(() => 'sync');
	assertType<Equal<typeof syncTx, string>>();
	// @ts-expect-error unsupported isolation levels are rejected
	db.transaction(async () => {}, { isolationLevel: 'chaos' });
	db.transaction(async () => {}, {
		// @ts-expect-error retry reasons are a closed union
		retries: { attempts: 1, on: ['timeout'] },
	});
	// @ts-expect-error rollback only exists on transaction clients
	db.rollback();
	// root clients expose afterCommit/afterRollback (they throw outside a
	// transaction at runtime)
	db.afterCommit(() => {});
	db.afterRollback(() => {});

	// extends
	const extended = db.extends({ appName: 'bd', ping: () => 'pong' as const });
	assertType<Equal<typeof extended.appName, string>>();
	assertType<Equal<ReturnType<typeof extended.ping>, 'pong'>>();
	assertType<Equal<typeof extended.people, typeof db.people>>();
	const extendedFn = db.extends((client) => {
		assertType<Equal<typeof client, typeof db>>();
		return { countPeople: () => client.people.count() };
	});
	const counted = await extendedFn.countPeople();
	assertType<Equal<typeof counted, number>>();
	const extendedTwice = extended.extends({ second: 2 });
	assertType<Equal<typeof extendedTwice.second, number>>();
	// @ts-expect-error extensions must be objects
	db.extends('nope');
	await db.transaction(async (tx) => {
		const txExtended = tx.extends((client) => {
			assertType<
				Equal<typeof client, BetterDrizzleTransactionClient<Schema>>
			>();
			return { inTx: true as const };
		});
		assertType<Equal<typeof txExtended.inTx, true>>();
		assertType<Equal<typeof txExtended.people, typeof tx.people>>();
		// extended transaction clients keep the transaction methods
		txExtended.afterCommit(() => {});
		assertType<Equal<ReturnType<typeof txExtended.rollback>, never>>();
		// @ts-expect-error extensions cannot override transaction client keys
		tx.extends({ rollback: 1 });
	});
	// @ts-expect-error extensions cannot override table delegates
	db.extends({ people: 1 });
	// @ts-expect-error extensions cannot override built-in client keys
	db.extends(() => ({ transaction: 1 }));
	// @ts-expect-error nor keys added by an earlier extension
	extended.extends({ appName: 'other' });
};

// ---------------------------------------------------------------------------
// Typed Meta
// ---------------------------------------------------------------------------

type AppMeta = { tenantId: string; requestId?: string };
const metaDb = better<Schema, AppMeta>(raw, {
	hooks: {
		beforeQuery(ctx) {
			assertType<Equal<typeof ctx.meta, AppMeta | undefined>>();
		},
	},
});
export const typedMeta = async () => {
	const scoped = metaDb.$withContext({ tenantId: 't1' });
	assertType<Equal<typeof scoped, BetterDrizzleClient<Schema, AppMeta>>>();
	metaDb.$withContext({ requestId: 'r' });
	// @ts-expect-error scoped meta values are typed
	metaDb.$withContext({ tenantId: 1 });
	await metaDb.people.findMany({ meta: { tenantId: 't' } });
	// @ts-expect-error per-call meta is typed
	await metaDb.people.findMany({ meta: { tenantId: 1 } });
	await metaDb.transaction(async () => {}, { meta: { tenantId: 't' } });
	// @ts-expect-error transaction meta is typed
	await metaDb.transaction(async () => {}, { meta: { tenantId: 1 } });
	await metaDb.$raw(sql`select 1`, { meta: { tenantId: 't' } });
	// @ts-expect-error raw meta is typed
	await metaDb.$raw(sql`select 1`, { meta: { tenantId: 1 } });
};

// ---------------------------------------------------------------------------
// Custom plugins
// ---------------------------------------------------------------------------

const tenantPlugin = definePlugin({
	id: 'test/tenant',
	operationArgs: {
		findMany: { tenant: undefined as string | undefined },
		create: { audit: undefined as boolean | undefined },
	},
	hooks: {
		beforeQuery(ctx) {
			if (ctx.kind === 'findMany') {
				assertType<Equal<typeof ctx.args.tenant, string | undefined>>();
			}
			return undefined;
		},
	},
	setup(ctx) {
		assertType<Equal<typeof ctx.dialect, 'pg' | 'mysql' | 'sqlite'>>();
		ctx.addHook({ afterQuery() {} });
		ctx.addTransform((operation) => operation);
		assertType<Equal<ReturnType<typeof ctx.isColumnExists>, boolean>>();
	},
	extendClient() {
		return { tenantHelper: (id: string) => id.length };
	},
	extendModel() {
		return { modelHelper: () => true as const };
	},
});
const pluginDb = better(raw, { plugins: [tenantPlugin] });

export const customPlugins = async () => {
	await pluginDb.people.findMany({ tenant: 't1', where: { active: true } });
	await pluginDb.people.create({
		data: { email: 'a', tenantId: 't' },
		audit: true,
	});
	// @ts-expect-error plugin operation args are typed
	await pluginDb.people.findMany({ tenant: 1 });
	await pluginDb.people.create({
		data: { email: 'a', tenantId: 't' },
		// @ts-expect-error plugin operation args are typed per operation kind
		audit: 'y',
	});
	assertType<Equal<ReturnType<typeof pluginDb.tenantHelper>, number>>();
	// static model extensions reach every delegate, root and transaction
	assertType<Equal<ReturnType<typeof pluginDb.people.modelHelper>, true>>();
	// @ts-expect-error clients without the plugin do not get its extensions
	db.tenantHelper('x');
	// @ts-expect-error model extensions come only from installed plugins
	db.people.modelHelper();
	await pluginDb.transaction(async (tx) => {
		assertType<Equal<ReturnType<typeof tx.tenantHelper>, number>>();
		await tx.people.findMany({ tenant: 't' });
		assertType<Equal<ReturnType<typeof tx.people.modelHelper>, true>>();
	});
	const pluginScoped = pluginDb.$withContext({});
	assertType<Equal<ReturnType<typeof pluginScoped.tenantHelper>, number>>();
};

// definePlugin is re-exported from better-drizzle/plugins
assertType<Equal<typeof definePluginFromPlugins, typeof definePlugin>>();
// @ts-expect-error plugins require an id
definePlugin({ name: 'no id' });
// @ts-expect-error plugin config dialects are a closed union
definePlugin({ id: 'x', config: { dialects: ['oracle'] } });
definePlugin({
	id: 'x',
	config: {
		dialects: ['pg', 'sqlite', 'mysql'],
		requires: { columns: [{ column: 'tenantId', type: 'string' }] },
	},
});
// @ts-expect-error plugins must be Plugin objects
better(raw, { plugins: [{}] });
export const setupContextSchema = (ctx: PluginSetupContext<Schema>) => {
	assertType<Equal<typeof ctx.schema, Schema>>();
};
export const anyPlugin: AnyPlugin = tenantPlugin;
export const clientOptions: BetterClientOptions<Schema> = {
	plugins: [tenantPlugin],
	raw: { allowUnsafe: false },
};

// ---------------------------------------------------------------------------
// Official plugins
// ---------------------------------------------------------------------------

assertType<Equal<typeof softDeleteDefault, typeof softDelete>>();
assertType<Equal<typeof timestampsDefault, typeof timestamps>>();
assertType<Equal<typeof rulesDefault, typeof rules>>();
assertType<Equal<typeof zodDefault, typeof zod>>();
assertType<Equal<typeof ataDefault, typeof ata>>();

const softDb = better(raw, {
	plugins: [
		softDelete({
			column: 'deletedAt',
			deletedByColumn: 'deletedById',
			defaults: { mode: 'soft', visibility: 'without' },
		}),
		timestamps({
			createdAt: 'createdAt',
			updatedAt: 'updatedAt',
			mode: 'app',
		}),
		rules({
			noDeleteManyWithoutWhere: 'error',
			noUpdateManyWithoutWhere: true,
			maxLimit: { level: 'warn', value: 100, applyTo: ['findMany'] },
			requireOrderByForCursor: false,
		}),
	],
});
const zodDb = better(raw, {
	plugins: [
		zod<Schema>({ behavior: { coerce: true, unknownKeys: 'strip' } }),
	],
});
const ataDb = better(raw, { plugins: [ata<Schema>()] });

export const officialPlugins = async () => {
	// soft delete
	await softDb.people.findMany({ deleted: 'only' });
	await softDb.people.findFirst({ deleted: 'with' });
	await softDb.people.count({ deleted: 'without' });
	await softDb.people.exists({ deleted: 'only' });
	await softDb.people.delete({
		where: { id: 1 },
		mode: 'hard',
		deletedBy: 'admin',
	});
	const softRows = await softDb.people.findMany({ deleted: 'with' });
	assertType<Equal<typeof softRows, Person[]>>();
	// soft-delete model extensions
	await softDb.people.restore({ where: { id: 1 } });
	await softDb.people.restoreById(1);
	// @ts-expect-error restore needs a where filter
	await softDb.people.restore({});
	const visibility: SoftDeleteVisibility = 'with';
	void visibility;
	// @ts-expect-error soft-delete visibility is a closed union
	await softDb.people.findMany({ deleted: 'maybe' });
	// @ts-expect-error soft-delete mode is soft | hard
	await softDb.people.delete({ where: { id: 1 }, mode: 'purge' });
	// @ts-expect-error deletedBy is a string
	await softDb.people.delete({ where: { id: 1 }, deletedBy: 1 });
	// @ts-expect-error softDelete default visibility cannot be 'only'
	softDelete({ defaults: { visibility: 'only' } });

	// timestamps
	timestamps();
	timestamps({ mode: 'database' });
	// @ts-expect-error timestamps mode is app | database
	timestamps({ mode: 'manual' });
	await softDb.people.create({ data: { email: 'a', tenantId: 't' } });

	// rules
	rules(safe());
	rules(recommended({ maxLimit: { value: 10 } }));
	rules(strict());
	const merged: RulesPluginOptions = merge({
		extends: [safe(), recommended()],
		rules: { noRawUnsafe: 'warn' },
	});
	rules(merged);
	// @ts-expect-error rule severities in the shorthand form are a closed union
	rules({ noRawUnsafe: 'fatal' });
	// @ts-expect-error rule severities in the object form are a closed union
	rules({ noRawUnsafe: { level: 'fatal' } });
	// @ts-expect-error maxLimit object form requires a value
	rules({ maxLimit: { level: 'warn' } });

	// zod
	const zodCount = await zodDb.people.count({ validate: false });
	assertType<Equal<typeof zodCount, number>>();
	const zodRows = await zodDb.people.findMany({ validate: true });
	assertType<Equal<typeof zodRows, Person[]>>();
	type ZodCreate = z.output<typeof zodDb.people.$zod.create>;
	assertType<Equal<ZodCreate['email'], string>>();
	assertType<Equal<'id' extends keyof ZodCreate ? true : false, true>>();
	type ZodUpdate = z.output<typeof zodDb.people.$zod.update>;
	assertType<Equal<ZodUpdate, Partial<ZodUpdate>>>();
	// @ts-expect-error $zod exposes only the documented schemas
	void zodDb.people.$zod.nope;
	// @ts-expect-error validate is boolean
	await zodDb.people.findMany({ validate: 'yes' });
	// zod() without a Schema generic reads the schema from the client and
	// reflects inferred options in the $zod types
	const inferredZodDb = better(raw, {
		plugins: [zod({ schemas: { people: { create: { omit: ['id'] } } } })],
	});
	type InferredCreate = z.output<typeof inferredZodDb.people.$zod.create>;
	assertType<
		Equal<'id' extends keyof InferredCreate ? true : false, false>
	>();
	assertType<Equal<InferredCreate['email'], string>>();
	zod<Schema>({
		validate: { create: true, query: false, result: true },
		schemas: {
			people: { create: { omit: ['id'] }, update: { partial: true } },
		},
	});
	// @ts-expect-error zod schema customisations are keyed by TS table key
	zod<Schema>({ schemas: { client_pg_people: {} } });
	// @ts-expect-error unknownKeys is a closed union
	zod<Schema>({ behavior: { unknownKeys: 'drop' } });
	void zodDb;

	// ata
	await ataDb.people.findMany({ validate: true });
	await ataDb.people.create({
		data: { email: 'a', tenantId: 't' },
		validate: false,
	});
	// @ts-expect-error ata validate is boolean
	await ataDb.people.count({ validate: 1 });
	// ata model extension
	void ataDb.people.$ata;
	// @ts-expect-error model extensions come only from installed plugins
	void softDb.people.$ata;
};

// ---------------------------------------------------------------------------
// Errors and misc exports
// ---------------------------------------------------------------------------

export const errors = (error: unknown) => {
	assertType<
		Equal<
			typeof isUniqueViolation,
			(error: unknown, constraint?: string) => boolean
		>
	>();
	assertType<
		Equal<
			typeof isForeignKeyViolation,
			(error: unknown, constraint?: string) => boolean
		>
	>();
	assertType<
		Equal<
			typeof isNotNullViolation,
			(error: unknown, column?: string) => boolean
		>
	>();
	assertType<
		Equal<
			typeof isCheckViolation,
			(error: unknown, constraint?: string) => boolean
		>
	>();
	assertType<
		Equal<ReturnType<typeof getDatabaseErrorInfo>, DatabaseErrorInfo>
	>();
	assertType<Equal<typeof version extends string ? true : false, true>>();

	if (BetterDrizzleError.is(error)) {
		assertType<Equal<typeof error, BetterDrizzleError>>();
		assertType<Equal<typeof error.code, BetterDrizzleErrorCode>>();
		assertType<Equal<typeof error.status, number>>();
		assertType<
			Equal<
				typeof error.driver,
				'pg' | 'sqlite' | 'mysql' | 'unknown' | undefined
			>
		>();
		assertType<Equal<typeof error.table, string | undefined>>();
		assertType<
			Equal<typeof error.details, Record<string, unknown> | undefined>
		>();
	}
	if (isDatabaseError(error)) void error.code;

	const normalized = BetterDrizzleError.from(error, { operation: 'create' });
	assertType<Equal<typeof normalized, BetterDrizzleError>>();
	const fromDb = BetterDrizzleError.fromDatabaseError(error, { table: 'x' });
	assertType<Equal<typeof fromDb, BetterDrizzleError>>();
	const created = new BetterDrizzleError({
		code: BetterDrizzleErrorCode.ResultNotFound,
		message: 'x',
	});
	void created;
	// @ts-expect-error codes must be BetterDrizzleErrorCode members
	new BetterDrizzleError({ code: 'NOPE', message: 'x' });
	// @ts-expect-error message is required
	new BetterDrizzleError({ code: BetterDrizzleErrorCode.Unknown });

	const rollback = new BetterDrizzleTransactionRollbackError('why');
	const asBase: BetterDrizzleError = rollback;
	void asBase;
	assertType<Equal<typeof rollback.reason, unknown>>();
	assertType<
		Equal<
			`${BetterDrizzleErrorCode.TransactionRollback}`,
			'TRANSACTION_ROLLBACK'
		>
	>();
	assertType<
		Equal<`${BetterDrizzleErrorCode.ResultNotFound}`, 'RESULT_NOT_FOUND'>
	>();
};
