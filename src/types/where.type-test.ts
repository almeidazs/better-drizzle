import { defineRelations, sql } from 'drizzle-orm';
import {
	int,
	json as mysqlJson,
	mysqlTable,
	varchar,
} from 'drizzle-orm/mysql-core';
import {
	bigint,
	boolean,
	doublePrecision,
	integer,
	json,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uuid,
	varchar as pgVarchar,
} from 'drizzle-orm/pg-core';
import {
	integer as sqliteInteger,
	sqliteTable,
	text as sqliteText,
} from 'drizzle-orm/sqlite-core';

import type {
	ArrayWhereField,
	BetterDrizzleClient,
	OrderByInput,
	ScalarWhereField,
	WhereArg,
	WhereInput,
} from '../index';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

// ---------------------------------------------------------------------------
// PostgreSQL schema: TS keys differ from DB names on purpose.
// ---------------------------------------------------------------------------

type Settings = {
	theme: { mode: 'dark' | 'light'; fontSize: number };
	beta: boolean;
	nickname?: string | null;
	tags: string[];
};

const role = pgEnum('crm_role', ['admin', 'member', 'guest']);
const accounts = pgTable('crm_accounts', {
	id: serial('account_id').primaryKey(),
	name: text('account_name').notNull(),
	nickname: pgVarchar('nick', { length: 50 }),
	age: integer('age_years').notNull(),
	score: doublePrecision('score_value'),
	balance: bigint('balance_cents', { mode: 'bigint' }).notNull(),
	createdAt: timestamp('created_at').notNull(),
	deletedAt: timestamp('deleted_at'),
	active: boolean('is_active').notNull(),
	verified: boolean('is_verified'),
	role: role('account_role').notNull(),
	code: uuid('public_code'),
	tags: text('tag_list').array().notNull(),
	luckyNumbers: integer('lucky_numbers').array(),
	roles: role('extra_roles').array().notNull(),
	settings: jsonb('settings_doc').$type<Settings>().notNull(),
	legacy: json('legacy_doc').$type<{ theme: { dark: boolean } }>(),
	rawJson: jsonb('raw_doc'),
	jsonList: jsonb('json_list').$type<string[]>(),
});
const orders = pgTable('crm_orders', {
	id: integer('order_id').primaryKey(),
	accountId: integer('account_fk').notNull(),
	total: integer('total_cents').notNull(),
	note: text('order_note'),
});
const lineItems = pgTable('crm_line_items', {
	id: integer('line_item_id').primaryKey(),
	orderId: integer('order_fk').notNull(),
	sku: text('sku_code').notNull(),
	quantity: integer('qty').notNull(),
});
const profiles = pgTable('crm_profiles', {
	id: integer('profile_id').primaryKey(),
	accountId: integer('account_fk').notNull(),
	bio: text('bio_text'),
});
const teams = pgTable('crm_teams', {
	id: integer('team_id').primaryKey(),
	name: text('team_name').notNull(),
});
const teamMembers = pgTable('crm_team_members', {
	accountId: integer('member_account_id').notNull(),
	teamId: integer('member_team_id').notNull(),
});

const relations = defineRelations(
	{ accounts, orders, lineItems, profiles, teams, teamMembers },
	(r) => ({
		accounts: {
			orders: r.many.orders(),
			profile: r.one.profiles({
				from: r.accounts.id,
				to: r.profiles.accountId,
			}),
			teams: r.many.teams({
				from: r.accounts.id.through(r.teamMembers.accountId),
				to: r.teams.id.through(r.teamMembers.teamId),
			}),
		},
		orders: {
			account: r.one.accounts({
				from: r.orders.accountId,
				to: r.accounts.id,
			}),
			items: r.many.lineItems(),
		},
		lineItems: {
			order: r.one.orders({ from: r.lineItems.orderId, to: r.orders.id }),
		},
		teams: {
			accounts: r.many.accounts({
				from: r.teams.id.through(r.teamMembers.teamId),
				to: r.accounts.id.through(r.teamMembers.accountId),
			}),
		},
	}),
);
type S = typeof relations;
declare const db: BetterDrizzleClient<S>;
const a = db.accounts;

// Type-level shape of the where input.
type AccountWhere = WhereInput<S, 'accounts'>;
assertType<
	Equal<NonNullable<AccountWhere['name']>, ScalarWhereField<string>>
>();
assertType<
	Equal<AccountWhere['nickname'], ScalarWhereField<string | null> | undefined>
>();
assertType<Equal<null extends AccountWhere['nickname'] ? 1 : 0, 1>>();
assertType<Equal<null extends AccountWhere['name'] ? 1 : 0, 0>>();
assertType<
	Equal<NonNullable<AccountWhere['tags']>, ArrayWhereField<string[]>>
>();
assertType<
	Equal<
		AccountWhere['luckyNumbers'],
		ArrayWhereField<number[] | null> | undefined
	>
>();
assertType<
	Equal<keyof NonNullable<AccountWhere['orders']>, 'some' | 'every' | 'none'>
>();
assertType<
	Equal<keyof NonNullable<AccountWhere['teams']>, 'some' | 'every' | 'none'>
>();
assertType<Equal<keyof NonNullable<AccountWhere['profile']>, 'is' | 'isNot'>>();
assertType<
	Equal<keyof NonNullable<WhereInput<S, 'orders'>['account']>, 'is' | 'isNot'>
>();

// Structural helpers typed like the delegate args (non-generic, so excess
// property checks apply).
const where = (value: WhereArg<S, 'accounts'>) => value;
const orderBy = (value: OrderByInput<S, 'accounts'>) => value;

export const scalarFilters = () => {
	// strings
	void a.findMany({ where: { name: 'Ada' } });
	void a.findMany({ where: { name: { equals: 'Ada' } } });
	void a.findMany({
		where: {
			name: {
				contains: 'd',
				startsWith: 'A',
				endsWith: 'a',
				mode: 'insensitive',
			},
		},
	});
	void a.findMany({ where: { name: { in: ['Ada'], notIn: ['Bob'] } } });
	void a.findMany({ where: { name: { mode: 'default', contains: 'x' } } });
	void a.findMany({ where: { name: { not: 'Ada' } } });
	void a.findMany({ where: { name: { not: { contains: 'x' } } } });
	void a.findMany({ where: { nickname: null } });
	void a.findMany({ where: { nickname: { equals: null } } });
	void a.findMany({ where: { nickname: { not: null } } });
	void a.findMany({ where: { nickname: { in: ['a', null] } } });
	void a.findMany({ where: { code: { startsWith: '0000' } } });
	// @ts-expect-error string columns reject numbers
	void a.findMany({ where: { name: 5 } });
	// @ts-expect-error contains takes a string
	void a.findMany({ where: { name: { contains: 5 } } });
	// @ts-expect-error string filters have no range operators
	void a.findMany({ where: { name: { gt: 'a' } } });
	// @ts-expect-error unknown query mode
	void a.findMany({ where: { name: { mode: 'caseless' } } });
	// @ts-expect-error in takes an array
	void a.findMany({ where: { name: { in: 'Ada' } } });
	// @ts-expect-error non-nullable columns reject null
	void a.findMany({ where: { name: null } });
	// @ts-expect-error nested not cannot nest not again
	where({ name: { not: { not: 'x' } } });

	// numbers
	void a.findMany({ where: { age: 30 } });
	void a.findMany({ where: { age: { gt: 1, gte: 2, lt: 90, lte: 91 } } });
	void a.findMany({ where: { age: { in: [1, 2], notIn: [3] } } });
	void a.findMany({ where: { age: { not: { gte: 18 } } } });
	void a.findMany({ where: { score: null } });
	void a.findMany({ where: { score: { lt: 1.5 } } });
	// @ts-expect-error number columns reject strings
	void a.findMany({ where: { age: '30' } });
	// @ts-expect-error comparisons are typed by column
	void a.findMany({ where: { age: { gt: '1' } } });
	// @ts-expect-error number filters have no string operators
	void a.findMany({ where: { age: { contains: '3' } } });
	// @ts-expect-error non-nullable columns reject null
	void a.findMany({ where: { age: null } });

	// bigint
	void a.findMany({ where: { balance: 10n } });
	void a.findMany({ where: { balance: { gte: 10n, in: [1n] } } });
	// @ts-expect-error bigint columns reject plain numbers
	void a.findMany({ where: { balance: { gte: 10 } } });

	// dates
	void a.findMany({ where: { createdAt: new Date() } });
	void a.findMany({
		where: { createdAt: { gte: new Date(), lt: new Date() } },
	});
	void a.findMany({ where: { deletedAt: null } });
	void a.findMany({ where: { deletedAt: { not: null } } });
	// @ts-expect-error date columns reject ISO strings
	void a.findMany({ where: { createdAt: { gte: '2024-01-01' } } });
	// @ts-expect-error date columns reject numbers
	void a.findMany({ where: { createdAt: 0 } });

	// booleans
	void a.findMany({ where: { active: true } });
	void a.findMany({ where: { active: { equals: false } } });
	void a.findMany({ where: { active: { not: true } } });
	void a.findMany({ where: { verified: null } });
	// @ts-expect-error boolean columns reject strings
	void a.findMany({ where: { active: 'yes' } });
	// @ts-expect-error boolean filters have no range operators
	void a.findMany({ where: { active: { gt: true } } });

	// enums
	void a.findMany({ where: { role: 'admin' } });
	void a.findMany({ where: { role: { in: ['admin', 'member'] } } });
	void a.findMany({ where: { role: { not: 'guest' } } });
	// @ts-expect-error enum columns only accept declared values
	void a.findMany({ where: { role: 'owner' } });
	// @ts-expect-error enum lists only accept declared values
	void a.findMany({ where: { role: { in: ['owner'] } } });
	// @ts-expect-error enum equality only accepts declared values
	void a.findMany({ where: { role: { equals: 'root' } } });

	// unknown columns
	// @ts-expect-error unknown column
	void a.findMany({ where: { nope: 1 } });
	// @ts-expect-error DB column names are not where keys
	void a.findMany({ where: { account_name: 'Ada' } });
	// @ts-expect-error unknown column next to a valid one
	where({ name: 'Ada', nope: 1 });

	// raw SQL
	void a.findMany({ where: sql`${accounts.age} > 18` });
	void a.count({ where: sql`true` });
};

export const logicalFilters = () => {
	void a.findMany({
		where: {
			AND: [{ active: true }, { age: { gte: 18 } }],
			OR: [{ role: 'admin' }, { name: { startsWith: 'A' } }],
			NOT: { deletedAt: { not: null } },
		},
	});
	void a.findMany({ where: { NOT: [{ role: 'guest' }, { active: false }] } });
	void a.findMany({
		where: {
			OR: [
				{ AND: [{ active: true }, { NOT: { age: { lt: 18 } } }] },
				{ orders: { some: { total: { gt: 100 } } } },
			],
		},
	});
	void a.exists({ where: { OR: [{ tags: { has: 'vip' } }] } });
	// @ts-expect-error AND takes an array
	void a.findMany({ where: { AND: { active: true } } });
	// @ts-expect-error OR takes an array
	void a.findMany({ where: { OR: { active: true } } });
	// @ts-expect-error nested logical branches are type-checked
	void a.findMany({ where: { AND: [{ age: 'x' }] } });
	// @ts-expect-error NOT branches are type-checked
	void a.findMany({ where: { NOT: { role: 'owner' } } });
};

export const relationFilters = () => {
	// one relations
	void a.findMany({ where: { profile: { is: { bio: 'x' } } } });
	void a.findMany({ where: { profile: { isNot: { bio: null } } } });
	void a.findMany({ where: { profile: { is: null } } });
	void a.findMany({ where: { profile: { isNot: null } } });
	void db.orders.findMany({
		where: { account: { is: { active: true, role: 'admin' } } },
	});

	// many relations
	void a.findMany({ where: { orders: { some: { total: { gt: 100 } } } } });
	void a.findMany({ where: { orders: { every: { note: { not: null } } } } });
	void a.findMany({ where: { orders: { none: {} } } });
	void a.findMany({
		where: {
			orders: {
				some: { total: { gte: 1 } },
				every: { total: { lte: 1000 } },
				none: { note: 'refund' },
			},
		},
	});

	// many-to-many (through)
	void a.findMany({ where: { teams: { some: { name: 'core' } } } });
	void a.findMany({
		where: { teams: { none: { name: { contains: 'x' } } } },
	});
	void db.teams.findMany({
		where: { accounts: { every: { active: true } } },
	});

	// two levels deep
	void a.findMany({
		where: { orders: { some: { items: { some: { sku: 'A-1' } } } } },
	});
	void a.findMany({
		where: {
			orders: { every: { items: { none: { quantity: { gt: 10 } } } } },
		},
	});
	void db.lineItems.findMany({
		where: {
			order: {
				is: { account: { is: { teams: { some: { name: 'core' } } } } },
			},
		},
	});
	void db.teams.findMany({
		where: {
			accounts: { some: { profile: { is: { bio: { contains: 'x' } } } } },
		},
	});

	// relation filters inside include/count
	void a.findMany({
		include: {
			orders: { where: { items: { some: { quantity: { gt: 1 } } } } },
			_count: {
				select: {
					orders: { where: { account: { is: { active: true } } } },
				},
			},
		},
	});

	// @ts-expect-error `some` is only valid on many relations
	void a.findMany({ where: { profile: { some: { bio: 'x' } } } });
	// @ts-expect-error `is` is only valid on one relations
	void a.findMany({ where: { orders: { is: { total: 1 } } } });
	// @ts-expect-error `isNot` is only valid on one relations
	void a.findMany({ where: { teams: { isNot: { name: 'x' } } } });
	void db.orders.findMany({
		// @ts-expect-error `every` is only valid on many relations
		where: { account: { every: { active: true } } },
	});
	// @ts-expect-error many relation filters cannot be null
	void a.findMany({ where: { orders: { some: null } } });
	// @ts-expect-error relation filters use the related table columns
	void a.findMany({ where: { orders: { some: { name: 'x' } } } });
	// @ts-expect-error related columns are type-checked
	void a.findMany({ where: { profile: { is: { bio: 5 } } } });
	// @ts-expect-error second-level relation kinds are enforced
	void a.findMany({ where: { orders: { some: { items: { is: {} } } } } });
	void a.findMany({
		// @ts-expect-error second-level columns are type-checked
		where: { orders: { some: { items: { some: { sku: 1 } } } } },
	});
	// @ts-expect-error unknown relation
	void a.findMany({ where: { invoices: { some: {} } } });
	// @ts-expect-error relation values are filter objects, not rows
	void a.findMany({ where: { profile: { bio: 'x' } } });
};

export const arrayFilters = () => {
	void a.findMany({ where: { tags: { has: 'vip' } } });
	void a.findMany({
		where: {
			tags: {
				hasEvery: ['a', 'b'],
				hasSome: ['c'],
				hasNone: ['d'],
				containedBy: ['a', 'b', 'c'],
			},
		},
	});
	void a.findMany({ where: { tags: { isEmpty: true } } });
	void a.findMany({ where: { tags: { length: 3 } } });
	void a.findMany({ where: { tags: { length: { gte: 1, lt: 5 } } } });
	void a.findMany({ where: { tags: ['a', 'b'] } });
	void a.findMany({ where: { tags: { equals: [] } } });
	void a.findMany({ where: { tags: { not: { has: 'x' } } } });
	void a.findMany({ where: { tags: { not: ['x'] } } });
	void a.findMany({
		where: {
			tags: {
				some: { startsWith: 'a', mode: 'insensitive' },
				every: { in: ['a', 'b'] },
				none: { equals: 'z' },
			},
		},
	});
	void a.findMany({ where: { luckyNumbers: null } });
	void a.findMany({ where: { luckyNumbers: { has: 7 } } });
	void a.findMany({ where: { luckyNumbers: { some: { gt: 5 } } } });
	void a.findMany({ where: { luckyNumbers: { every: { lte: 100 } } } });
	void a.findMany({ where: { roles: { has: 'admin' } } });
	void a.findMany({ where: { roles: { hasSome: ['admin', 'guest'] } } });
	void a.findMany({ where: { roles: { some: { in: ['admin'] } } } });
	void a.findMany({
		where: { tags: { hasEvery: ['a'] as readonly string[] } },
	});

	// @ts-expect-error element type is enforced
	void a.findMany({ where: { tags: { has: 5 } } });
	// @ts-expect-error hasEvery takes an array
	void a.findMany({ where: { tags: { hasEvery: 'a' } } });
	// @ts-expect-error element lists are typed
	void a.findMany({ where: { luckyNumbers: { hasSome: ['1'] } } });
	// @ts-expect-error enum elements remain narrow
	void a.findMany({ where: { roles: { has: 'owner' } } });
	// @ts-expect-error length is numeric
	void a.findMany({ where: { tags: { length: 'x' } } });
	// @ts-expect-error isEmpty is boolean
	void a.findMany({ where: { tags: { isEmpty: 'yes' } } });
	// @ts-expect-error a bare element is not an array filter
	void a.findMany({ where: { tags: 'a' } });
	// @ts-expect-error non-nullable array columns reject null
	void a.findMany({ where: { tags: null } });
	// @ts-expect-error element predicates are typed by element
	void a.findMany({ where: { luckyNumbers: { some: { contains: 'x' } } } });
	// @ts-expect-error string element predicates have no range operators
	void a.findMany({ where: { tags: { every: { gt: 'a' } } } });
	// @ts-expect-error array filters are unavailable on text columns
	void a.findMany({ where: { name: { has: 'x' } } });
	// @ts-expect-error array filters are unavailable on number columns
	void a.findMany({ where: { age: { isEmpty: true } } });
	// @ts-expect-error array filters are unavailable on JSONB arrays
	where({ jsonList: { has: 'x' } });
	// @ts-expect-error array length filters are unavailable on JSONB arrays
	where({ jsonList: { length: 1 } });
};

export const jsonFilters = () => {
	// dotted shorthand
	void a.findMany({
		where: {
			settings: {
				'theme.mode': 'dark',
				'theme.fontSize': { gte: 12 },
			},
		},
	});
	void a.findMany({
		where: { settings: { 'theme.mode': { in: ['dark'] } } },
	});
	void a.findMany({ where: { legacy: { 'theme.dark': true } } });
	void a.findMany({ where: { rawJson: { 'any.path': 1 } } });
	void a.findMany({ where: { rawJson: { 'a.b.c': { contains: 'x' } } } });
	void a.findMany({ where: { rawJson: { 'a.b': null } } });
	void a.findMany({
		where: { settings: { 'theme.fontSize': { gt: 1, lt: 99 } } },
	});

	// legacy wrapper (typed by $type)
	void a.findMany({
		where: {
			settings: {
				json: {
					'theme.mode': 'light',
					'theme.fontSize': { lte: 20 },
					beta: true,
					nickname: null,
				},
			},
		},
	});
	void a.findMany({
		where: { settings: { json: { nickname: { contains: 'x' } } } },
	});
	void a.findMany({ where: { legacy: { json: { 'theme.dark': false } } } });

	// whole-document equality
	void a.findMany({
		where: {
			settings: {
				theme: { mode: 'dark', fontSize: 12 },
				beta: false,
				tags: [],
			},
		},
	});

	// @ts-expect-error json wrapper paths must exist
	void a.findMany({ where: { settings: { json: { 'theme.missing': 1 } } } });
	void a.findMany({
		// @ts-expect-error json wrapper leaf values are typed
		where: { settings: { json: { 'theme.mode': 'blue' } } },
	});
	void a.findMany({
		// @ts-expect-error json wrapper number leaves reject strings
		where: { settings: { json: { 'theme.fontSize': '12' } } },
	});
	// @ts-expect-error json wrapper boolean leaves reject numbers
	void a.findMany({ where: { settings: { json: { beta: 1 } } } });
	void a.findMany({
		// @ts-expect-error json wrapper exposes scalar leaves only
		where: { settings: { json: { theme: { mode: 'dark' } } } },
	});
	// @ts-expect-error json wrapper does not address arrays
	void a.findMany({ where: { settings: { json: { tags: 'x' } } } });
	// Untyped JSONB columns (data `unknown`) accept any where value.
	void a.findMany({ where: { rawJson: { json: { a: 1 } } } });
	// @ts-expect-error dotted paths only accept JSON scalar filter operators
	void a.findMany({ where: { settings: { 'theme.fontSize': { has: 1 } } } });
	// @ts-expect-error dotted shorthand cannot be mixed with the json wrapper
	where({ settings: { 'theme.mode': 'dark', json: { beta: true } } });
	// @ts-expect-error JSON paths are unavailable on text columns
	void a.findMany({ where: { name: { 'a.b': 1 } } });
	// @ts-expect-error JSON paths are unavailable on array columns
	void a.findMany({ where: { tags: { 'a.b': 1 } } });
	// @ts-expect-error json wrapper is unavailable on text columns
	void a.findMany({ where: { name: { json: { a: 1 } } } });
};

export const typedDottedJsonPaths = () => {
	void a.findMany({
		// @ts-expect-error dotted path values follow $type<...>()
		where: { settings: { 'theme.fontSize': 'big' } },
	});
	void a.findMany({
		// @ts-expect-error dotted paths must exist on $type<...>()
		where: { settings: { 'theme.missing': 1 } },
	});
	void a.findMany({
		// @ts-expect-error enum-like path values are closed
		where: { settings: { 'theme.mode': 'blue' } },
	});
};

export const ordering = () => {
	void a.findMany({ orderBy: { name: 'asc' } });
	void a.findMany({ orderBy: { createdAt: 'desc', age: 'asc' } });
	void a.findMany({
		orderBy: { score: { direction: 'desc', nulls: 'last' } },
	});
	void a.findMany({
		orderBy: { deletedAt: { direction: 'asc', nulls: 'first' } },
	});
	void a.findMany({ orderBy: { nickname: { direction: 'asc' } } });
	void a.findMany({ orderBy: [{ role: 'asc' }, { createdAt: 'desc' }] });
	void a.findMany({
		orderBy: [
			{ score: { direction: 'asc', nulls: 'last' } },
			{ id: 'desc' },
		],
	});
	void a.findFirst({ orderBy: { balance: 'desc' } });
	void a.paginate({ limit: 5, orderBy: [{ age: 'desc' }] });
	void a.cursor({ limit: 5, orderBy: { id: 'asc' } });
	void a.findMany({
		include: {
			orders: {
				orderBy: { total: { direction: 'desc', nulls: 'last' } },
			},
		},
	});
	orderBy({ settings: 'asc' });
	// @ts-expect-error unknown order key
	void a.findMany({ orderBy: { nope: 'asc' } });
	// @ts-expect-error bad direction
	void a.findMany({ orderBy: { name: 'up' } });
	// @ts-expect-error direction strings are lowercase
	void a.findMany({ orderBy: { name: 'ASC' } });
	void a.findMany({
		// @ts-expect-error bad nulls placement
		orderBy: { name: { direction: 'desc', nulls: 'middle' } },
	});
	// @ts-expect-error config objects require a direction
	void a.findMany({ orderBy: { name: { nulls: 'first' } } });
	// @ts-expect-error relations are not orderable
	void a.findMany({ orderBy: { orders: 'asc' } });
	// @ts-expect-error DB column names are not order keys
	void a.findMany({ orderBy: { account_name: 'asc' } });
	// @ts-expect-error array entries are type-checked
	void a.findMany({ orderBy: [{ name: 'asc' }, { age: 'sideways' }] });
	// @ts-expect-error nested orderBy uses related columns
	void a.findMany({ include: { orders: { orderBy: { name: 'asc' } } } });
	// @ts-expect-error unknown key next to a valid one
	orderBy({ name: 'asc', nope: 'desc' });
	// @ts-expect-error count does not accept orderBy
	void a.count({ orderBy: { name: 'asc' } });
};

// ---------------------------------------------------------------------------
// SQLite and MySQL: no PostgreSQL array or JSONB path filters.
// ---------------------------------------------------------------------------

const liteUsers = sqliteTable('lite_users', {
	id: sqliteInteger('user_id').primaryKey(),
	handle: sqliteText('user_handle').notNull(),
	karma: sqliteInteger('karma_points'),
	admin: sqliteInteger('is_admin', { mode: 'boolean' }).notNull(),
	seenAt: sqliteInteger('seen_at', { mode: 'timestamp' }),
	tags: sqliteText('tags_json', { mode: 'json' }).$type<string[]>(),
	prefs: sqliteText('prefs_json', { mode: 'json' }).$type<{
		ui: { dense: boolean };
	}>(),
});
const liteRelations = defineRelations({ liteUsers });
declare const lite: BetterDrizzleClient<typeof liteRelations>;

const myUsers = mysqlTable('my_users', {
	id: int('user_id').primaryKey(),
	handle: varchar('user_handle', { length: 64 }).notNull(),
	prefs: mysqlJson('prefs_json').$type<{ ui: { dense: boolean } }>(),
});
const myRelations = defineRelations({ myUsers });
declare const my: BetterDrizzleClient<typeof myRelations>;

export const otherDialects = () => {
	void lite.liteUsers.findMany({
		where: {
			handle: { contains: 'a', mode: 'insensitive' },
			karma: { gte: 1 },
			admin: false,
			seenAt: { lt: new Date() },
			OR: [{ karma: null }, { seenAt: null }],
		},
		orderBy: { karma: { direction: 'desc', nulls: 'last' } },
	});
	void lite.liteUsers.findMany({ where: { tags: { equals: ['a'] } } });
	void my.myUsers.findMany({ where: { handle: { startsWith: 'x' } } });
	void my.myUsers.findMany({ where: { prefs: null } });
	// @ts-expect-error SQLite JSON text columns have no array filters
	void lite.liteUsers.findMany({ where: { tags: { has: 'a' } } });
	// @ts-expect-error SQLite JSON text columns have no JSON path filters
	void lite.liteUsers.findMany({ where: { prefs: { 'ui.dense': true } } });
	void lite.liteUsers.findMany({
		// @ts-expect-error SQLite JSON text columns have no json wrapper
		where: { prefs: { json: { 'ui.dense': true } } },
	});
	// @ts-expect-error MySQL JSON columns have no JSON path filters
	void my.myUsers.findMany({ where: { prefs: { 'ui.dense': true } } });
	// @ts-expect-error SQLite boolean-mode integers are booleans
	void lite.liteUsers.findMany({ where: { admin: 1 } });
	// @ts-expect-error SQLite timestamp-mode integers are dates
	void lite.liteUsers.findMany({ where: { seenAt: { gt: 0 } } });
	// @ts-expect-error DB column names are not where keys on delegate calls
	void my.myUsers.findMany({ where: { user_handle: 'x' } });
	const myWhere = (value: WhereArg<typeof myRelations, 'myUsers'>) => value;
	// @ts-expect-error DB column names are not where keys
	myWhere({ user_handle: 'x' });
};
