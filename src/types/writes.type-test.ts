import { defineRelations, sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';
import {
	boolean as myBoolean,
	int,
	json as myJson,
	mysqlTable,
	serial as mySerial,
	varchar as myVarchar,
} from 'drizzle-orm/mysql-core';
import {
	boolean,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core';
import {
	integer as sqliteInteger,
	sqliteTable,
	text as sqliteText,
} from 'drizzle-orm/sqlite-core';

import { better } from '../index';
import type {
	BatchResult,
	BetterDrizzleClient,
	BetterRecord,
	CreateArgs,
	CreateManyArgs,
	DeleteArgs,
	UpdateArgs,
	UpdateEachArgs,
	UpsertArgs,
	UpsertManyArgs,
} from '../index';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
type Simplify<T> = { [K in keyof T]: T[K] } & {};
const assertType = <_T extends true>() => {};

// ---------------------------------------------------------------------------
// PostgreSQL schema — TS keys intentionally differ from DB names.
// ---------------------------------------------------------------------------

type Settings = {
	theme: { mode: 'dark' | 'light'; accent: string };
	flags: { beta: boolean };
	limits: { daily: number };
};

const role = pgEnum('writes_role', ['admin', 'member']);

const members = pgTable('writes_pg_members', {
	id: integer('member_id').primaryKey().generatedAlwaysAsIdentity(),
	email: varchar('email_address', { length: 255 }).notNull().unique(),
	displayName: text('display_name'),
	role: role('member_role').notNull().default('member'),
	loginCount: integer('login_count').notNull().default(0),
	rating: integer('rating'),
	active: boolean('is_active').notNull().default(true),
	price: numeric('price'),
	tags: text('tag_list')
		.array()
		.notNull()
		.default(sql`'{}'`),
	roles: role('role_list').array(),
	settings: jsonb('settings_doc').$type<Settings>().notNull(),
	extra: jsonb('extra_doc'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	emailLower: text('email_lower').generatedAlwaysAs(
		sql`lower(email_address)`,
	),
	mentorId: integer('mentor_id'),
});

const articles = pgTable('writes_pg_articles', {
	id: serial('article_id').primaryKey(),
	authorId: integer('author_member_id').notNull(),
	editorId: integer('editor_member_id'),
	title: text('headline').notNull(),
	views: integer('view_count').notNull().default(0),
	published: boolean('is_published').notNull().default(false),
});

const teams = pgTable('writes_pg_teams', {
	id: serial('team_id').primaryKey(),
	name: text('team_name').notNull(),
});

const teamMemberships = pgTable(
	'writes_pg_team_memberships',
	{
		memberId: integer('member_ref').notNull(),
		teamId: integer('team_ref').notNull(),
	},
	(table) => [primaryKey({ columns: [table.memberId, table.teamId] })],
);

const badges = pgTable('writes_pg_badges', {
	id: serial('badge_id').primaryKey(),
	memberId: integer('owner_member_id').notNull().unique(),
	label: text('badge_label').notNull(),
});

const pgRelations = defineRelations(
	{ members, articles, teams, teamMemberships, badges },
	(r) => ({
		members: {
			articles: r.many.articles({ alias: 'authored' }),
			edited: r.many.articles({ alias: 'edited' }),
			badge: r.one.badges({
				from: r.members.id,
				to: r.badges.memberId,
			}),
			mentor: r.one.members({
				from: r.members.mentorId,
				to: r.members.id,
				alias: 'mentorship',
			}),
			mentees: r.many.members({ alias: 'mentorship' }),
			teams: r.many.teams({
				from: r.members.id.through(r.teamMemberships.memberId),
				to: r.teams.id.through(r.teamMemberships.teamId),
			}),
		},
		articles: {
			author: r.one.members({
				from: r.articles.authorId,
				to: r.members.id,
				alias: 'authored',
				optional: false,
			}),
			editor: r.one.members({
				from: r.articles.editorId,
				to: r.members.id,
				alias: 'edited',
			}),
		},
		teams: {
			members: r.many.members({
				from: r.teams.id.through(r.teamMemberships.teamId),
				to: r.members.id.through(r.teamMemberships.memberId),
			}),
		},
		badges: {
			owner: r.one.members({
				from: r.badges.memberId,
				to: r.members.id,
			}),
		},
	}),
);

declare const pgRaw: {
	readonly _: { readonly relations: typeof pgRelations };
};
const db = better(pgRaw);
type PgSchema = typeof pgRelations;

type Member = typeof members.$inferSelect;
type Article = typeof articles.$inferSelect;
type Team = typeof teams.$inferSelect;
type Badge = typeof badges.$inferSelect;

assertType<Equal<typeof db, BetterDrizzleClient<PgSchema>>>();
assertType<Equal<BetterRecord<PgSchema, 'members'>, Member>>();

// Never called: statements below are type-checked only.
export const pgWrites = async () => {
	// -----------------------------------------------------------------------
	// create — return shapes
	// -----------------------------------------------------------------------
	const created = await db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
	});
	assertType<Equal<typeof created, Member>>();

	const createdSelect = await db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		select: { id: true, email: true },
	});
	assertType<
		Equal<Simplify<typeof createdSelect>, { id: number; email: string }>
	>();

	const createdSelectFalse = await db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		select: { id: true, email: false },
	});
	assertType<Equal<Simplify<typeof createdSelectFalse>, { id: number }>>();

	const createdInclude = await db.articles.create({
		data: { authorId: 1, title: 'Hello' },
		include: { author: true, editor: true },
	});
	// `author` is declared with `optional: false`, so it is non-null
	assertType<Equal<typeof createdInclude.author, Member>>();
	const filteredInclude = await db.articles.create({
		data: { authorId: 1, title: 'Hello' },
		include: { author: { where: { active: true } } },
	});
	// a nested where can filter a required relation out
	assertType<Equal<typeof filteredInclude.author, Member | null>>();
	assertType<Equal<typeof createdInclude.editor, Member | null>>();
	assertType<Equal<typeof createdInclude.title, string>>();

	const createdNested = await db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		select: {
			id: true,
			articles: { select: { title: true } },
			teams: true,
			badge: true,
		},
	});
	assertType<Equal<typeof createdNested.id, number>>();
	assertType<
		Equal<
			Simplify<(typeof createdNested.articles)[number]>,
			{ title: string }
		>
	>();
	assertType<Equal<typeof createdNested.teams, Team[]>>();
	assertType<Equal<typeof createdNested.badge, Badge | null>>();

	const createdCount = await db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		include: { _count: { select: { articles: true, teams: true } } },
	});
	assertType<
		Equal<typeof createdCount._count, { articles: number; teams: number }>
	>();

	// skipDuplicates
	const skipTrue = await db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		skipDuplicates: true,
	});
	assertType<Equal<typeof skipTrue, Member | null>>();

	const skipFalse = await db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		skipDuplicates: false,
	});
	assertType<Equal<typeof skipFalse, Member>>();

	const skipColumns = await db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		skipDuplicates: ['email'],
	});
	assertType<Equal<typeof skipColumns, Member | null>>();

	const skipSelect = await db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		select: { email: true },
		skipDuplicates: ['email'] as const,
	});
	assertType<
		Equal<Simplify<NonNullable<typeof skipSelect>>, { email: string }>
	>();
	assertType<Equal<null extends typeof skipSelect ? true : false, true>>();

	db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		// @ts-expect-error skipDuplicates columns must be table keys
		skipDuplicates: ['email_address'],
	});
	db.members.create({
		data: { email: 'a@x.dev', settings: {} as Settings },
		// @ts-expect-error skipDuplicates only accepts boolean or a column list
		skipDuplicates: 'email',
	});

	// -----------------------------------------------------------------------
	// create — required vs optional insert columns
	// -----------------------------------------------------------------------
	db.members.create({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			displayName: null,
			role: 'admin',
			loginCount: 3,
			rating: null,
			active: false,
			price: '9.99',
			tags: ['a'],
			roles: ['admin'],
			extra: { anything: [1, 2] },
			createdAt: new Date(),
			mentorId: null,
		},
	});
	// @ts-expect-error email is required (notNull without default)
	db.members.create({ data: { settings: {} as Settings } });
	// @ts-expect-error settings is required (notNull jsonb without default)
	db.members.create({ data: { email: 'a@x.dev' } });
	db.members.create({
		data: {
			// @ts-expect-error notNull columns reject null
			email: null,
			settings: {} as Settings,
		},
	});
	db.members.create({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			// @ts-expect-error enum columns stay narrow
			role: 'owner',
		},
	});
	db.members.create({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			// @ts-expect-error wrong scalar value type
			loginCount: '3',
		},
	});
	db.members.create({
		data: {
			email: 'a@x.dev',
			// @ts-expect-error jsonb $type is enforced on insert
			settings: { theme: 'dark' },
		},
	});
	db.members.create({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			// @ts-expect-error array element types are enforced on insert
			tags: [1],
		},
	});
	// delegate calls reject unknown keys inside data, create, and update
	await db.members.create({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			// @ts-expect-error typos in data are rejected
			emial: 'a@x.dev',
		},
	});
	await db.members.createMany({
		data: [
			{
				email: 'a@x.dev',
				settings: {} as Settings,
				// @ts-expect-error typos in createMany rows are rejected
				emial: 'a@x.dev',
			},
		],
	});
	await db.members.update({
		where: { id: 1 },
		// @ts-expect-error typos in update data are rejected
		data: { emial: 'a@x.dev' },
	});
	// The exported arg types keep the same checks:
	const typedCreate = (args: CreateArgs<PgSchema, 'members'>) => args;
	typedCreate({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			// @ts-expect-error generatedAlwaysAs columns are not insertable
			emailLower: 'a@x.dev',
		},
	});
	typedCreate({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			// @ts-expect-error generatedAlwaysAsIdentity columns are not insertable
			id: 1,
		},
	});
	typedCreate({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			// @ts-expect-error DB column names are not insert keys
			email_address: 'a@x.dev',
		},
	});
	assertType<
		Equal<
			Exclude<keyof typeof members.$inferInsert, 'id' | 'emailLower'>,
			keyof typeof members.$inferInsert
		>
	>();
	// serial primary keys are optional but insertable
	db.articles.create({ data: { id: 10, authorId: 1, title: 'x' } });

	// -----------------------------------------------------------------------
	// createMany
	// -----------------------------------------------------------------------
	const many = await db.articles.createMany({
		data: [
			{ authorId: 1, title: 'a' },
			{ authorId: 2, title: 'b', views: 3 },
		],
	});
	assertType<Equal<typeof many, BatchResult<Article>>>();
	assertType<Equal<typeof many.count, number>>();
	assertType<Equal<typeof many.data, Article[] | undefined>>();

	const manySelect = await db.articles.createMany({
		data: [{ authorId: 1, title: 'a' }],
		select: { id: true },
		skipDuplicates: true,
	});
	assertType<
		Equal<
			Simplify<NonNullable<typeof manySelect.data>[number]>,
			{ id: number }
		>
	>();

	db.articles.createMany({
		data: [{ authorId: 1, title: 'a' }],
		skipDuplicates: ['title'],
	});
	db.articles.createMany({
		data: [{ authorId: 1, title: 'a' }],
		// @ts-expect-error skipDuplicates columns must exist
		skipDuplicates: ['headline'],
	});
	db.articles.createMany({
		// @ts-expect-error each row must satisfy the insert model
		data: [{ authorId: 1 }],
	});
	// createMany is scalar-only: relation-only rows fail (missing FK/required)
	db.articles.createMany({
		// @ts-expect-error relation connect cannot replace required scalars
		data: [{ title: 'a', author: { connect: { id: 1 } } }],
	});
	const typedCreateMany = (args: CreateManyArgs<PgSchema, 'articles'>) =>
		args;
	typedCreateMany({
		data: [
			{
				authorId: 1,
				title: 'a',
				// @ts-expect-error createMany rows reject relation commands
				author: { connect: { id: 1 } },
			},
		],
	});
	db.articles.createMany({
		// @ts-expect-error createMany data must be an array
		data: { authorId: 1, title: 'a' },
	});

	// -----------------------------------------------------------------------
	// update / updateMany
	// -----------------------------------------------------------------------
	const updated = await db.members.update({
		where: { id: 1 },
		data: { displayName: 'Ada' },
	});
	assertType<Equal<typeof updated, Member | null>>();

	const updatedThrow = await db.members
		.update({ where: { id: 1 }, data: { displayName: 'Ada' } })
		.throw();
	assertType<Equal<typeof updatedThrow, Member>>();

	const updatedThrowFactory = await db.members
		.update({
			where: { id: 1 },
			data: { displayName: 'Ada' },
			select: { email: true },
		})
		.throw(() => new Error('missing'));
	assertType<
		Equal<Simplify<typeof updatedThrowFactory>, { email: string }>
	>();

	const updatedInclude = await db.articles.update({
		where: { id: 1 },
		data: { title: 'x' },
		include: { author: { select: { email: true } } },
	});
	assertType<
		Equal<
			Simplify<NonNullable<NonNullable<typeof updatedInclude>['author']>>,
			{ email: string }
		>
	>();

	db.members.update({ where: sql`true`, data: { rating: null } });
	// @ts-expect-error update requires where
	db.members.update({ data: { displayName: 'x' } });
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error update data values are typed
			displayName: 1,
		},
	});
	db.members.update({
		where: { id: 1 },
		// @ts-expect-error update data rejects unknown-only payloads
		data: { nope: 1 },
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error notNull columns reject null on update
			email: null,
		},
	});
	db.members.update({
		// @ts-expect-error where keys are typed
		where: { nope: 1 },
		data: { displayName: 'x' },
	});

	const updatedMany = await db.members.updateMany({
		data: { active: false },
	});
	assertType<Equal<typeof updatedMany, BatchResult<never>>>();
	db.members.updateMany({ where: { active: true }, data: { rating: 1 } });
	db.members.updateMany({
		data: {
			active: false,
			// @ts-expect-error updateMany is scalar-only: no relation mutations
			articles: { connect: { id: 1 } },
		},
	});
	db.members.updateMany({
		data: {
			// @ts-expect-error updateMany values are typed
			active: 'no',
		},
	});

	// -----------------------------------------------------------------------
	// updateEach
	// -----------------------------------------------------------------------
	const each = await db.members.updateEach({
		by: members.id,
		data: [
			{ id: 1, displayName: 'A', bump: 1 },
			{ id: 2, displayName: 'B', bump: 2 },
		],
		update: {
			displayName: (row) => row.displayName ?? null,
			loginCount: (row) => ({ increment: row.bump as number }),
			active: () => ({ toggle: true }),
			rating: () => sql`rating + 1`,
		},
		where: { active: true },
		onEmpty: 'throw',
	});
	assertType<Equal<typeof each, BatchResult<Member>>>();

	const eachSelect = await db.members.updateEach({
		by: members.email,
		data: [{ email: 'a@x.dev' }],
		update: { displayName: () => 'x' },
		select: { id: true },
		onEmpty: 'return',
	});
	assertType<
		Equal<
			Simplify<NonNullable<typeof eachSelect.data>[number]>,
			{ id: number }
		>
	>();
	db.members.updateEach({
		by: members.id,
		data: [{ id: 1 }],
		update: { displayName: () => 'x' },
		select: {
			// @ts-expect-error updateEach cannot return relation projections
			articles: true,
		},
	});

	db.members.updateEach({
		// @ts-expect-error by must be a column of the same table
		by: articles.id,
		data: [{ id: 1 }],
		update: { displayName: () => 'x' },
	});
	db.members.updateEach({
		by: members.id,
		data: [{ id: 1 }],
		update: { displayName: () => 'x' },
		// @ts-expect-error onEmpty only accepts return | throw
		onEmpty: 'skip',
	});
	db.members.updateEach({
		by: members.id,
		data: [{ id: 1 }],
		update: {
			// @ts-expect-error update callbacks must return the column type
			displayName: () => 1,
		},
	});
	db.members.updateEach({
		by: members.id,
		data: [{ id: 1 }],
		update: {
			// @ts-expect-error updateEach is scalar-only: no relation keys
			articles: () => ({ connect: { id: 1 } }),
		},
	});
	db.members.updateEach({
		by: members.id,
		data: [
			{
				// @ts-expect-error known source-row keys keep their column type
				id: 'one',
			},
		],
		update: { displayName: () => 'x' },
	});

	// -----------------------------------------------------------------------
	// delete / deleteMany
	// -----------------------------------------------------------------------
	const deleted = await db.members.delete({ where: { id: 1 } });
	assertType<Equal<typeof deleted, Member | null>>();
	const deletedThrow = await db.members
		.delete({ where: { id: 1 }, select: { id: true } })
		.throw();
	assertType<Equal<Simplify<typeof deletedThrow>, { id: number }>>();
	const deletedInclude = await db.members.delete({
		where: { id: 1 },
		include: { articles: true },
	});
	assertType<
		Equal<NonNullable<typeof deletedInclude>['articles'], Article[]>
	>();
	// @ts-expect-error delete requires where
	db.members.delete({});

	const deletedMany = await db.members.deleteMany({
		where: { active: false },
	});
	assertType<Equal<typeof deletedMany, BatchResult<never>>>();
	db.members.deleteMany({});
	db.members.deleteMany({ where: sql`true` });
	// @ts-expect-error deleteMany where keys are typed
	db.members.deleteMany({ where: { unknown: 1 } });

	// -----------------------------------------------------------------------
	// upsert
	// -----------------------------------------------------------------------
	const upserted = await db.members.upsert({
		where: { email: 'a@x.dev' },
		create: { email: 'a@x.dev', settings: {} as Settings },
		update: { loginCount: { increment: 1 } },
	});
	assertType<Equal<typeof upserted, Member>>();

	const upsertedSelect = await db.members.upsert({
		where: { email: 'a@x.dev' },
		create: { email: 'a@x.dev', settings: {} as Settings },
		update: { displayName: 'x' },
		select: { id: true, badge: true },
	});
	assertType<Equal<typeof upsertedSelect.badge, Badge | null>>();
	assertType<Equal<typeof upsertedSelect.id, number>>();

	db.members.upsert({
		where: { id: 1 },
		create: {
			email: 'a@x.dev',
			settings: {} as Settings,
			teams: { connect: [{ id: 1 }] },
		},
		update: { teams: { set: [{ id: 2 }] } },
	});
	// @ts-expect-error upsert requires create
	db.members.upsert({ where: { id: 1 }, update: {} });
	db.members.upsert({
		where: { id: 1 },
		// @ts-expect-error upsert create must satisfy the insert model
		create: { displayName: 'x' },
		update: {},
	});

	// -----------------------------------------------------------------------
	// upsertMany
	// -----------------------------------------------------------------------
	const upsertedMany = await db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		update: 'all',
	});
	assertType<Equal<typeof upsertedMany, BatchResult<Member>>>();

	const upsertedManySelect = await db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: ['email'],
		update: ['displayName', 'loginCount'],
		select: { id: true, email: true },
		batchSize: 500,
		where: sql`true`,
	});
	db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		update: 'all',
		select: {
			// @ts-expect-error upsertMany cannot return relation projections
			articles: true,
		},
	});
	assertType<
		Equal<
			Simplify<NonNullable<typeof upsertedManySelect.data>[number]>,
			{ id: number; email: string }
		>
	>();

	db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		update: {
			loginCount: { increment: 1 },
			displayName: sql`excluded.display_name`,
			active: { toggle: true },
		},
	});
	db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		update: (ctx) => {
			assertType<Equal<typeof ctx.excluded.email, SQL>>();
			assertType<Equal<typeof ctx.table.email, AnyColumn>>();
			assertType<Equal<typeof ctx.sql, typeof sql>>();
			return { displayName: ctx.excluded.displayName };
		},
	});
	db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		// @ts-expect-error target must be a table key
		target: 'email_address',
		update: 'all',
	});
	db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		// @ts-expect-error update column lists must be table keys
		update: ['nope'],
	});
	db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		// @ts-expect-error update strategy strings other than all are rejected
		update: 'none',
	});
	db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		update: 'all',
		// @ts-expect-error batchSize is numeric
		batchSize: '10',
	});
	db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		update: 'all',
		// @ts-expect-error upsertMany where is a SQL condition, not an object filter
		where: { id: 1 },
	});
	const typedUpsertMany = (args: UpsertManyArgs<PgSchema, 'members'>) => args;
	typedUpsertMany({
		data: [
			{
				email: 'a@x.dev',
				settings: {} as Settings,
				// @ts-expect-error upsertMany rows reject relation commands
				teams: { connect: { id: 1 } },
			},
		],
		target: 'email',
		update: 'all',
	});
	// @ts-expect-error upsertMany requires target
	db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		update: 'all',
	});
};

// ---------------------------------------------------------------------------
// Relation writes
// ---------------------------------------------------------------------------

export const relationWrites = async () => {
	// create + connect (one): the FK becomes optional because connect sets it
	await db.articles.create({
		data: { title: 'x', author: { connect: { id: 1 } } },
	});
	await db.articles.create({
		data: {
			title: 'x',
			author: { connect: { email: 'a@x.dev' } },
			editor: { connect: { id: 2 } },
		},
	});
	// create + connect (many): single selector or list
	await db.members.create({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			articles: { connect: [{ id: 1 }, { id: 2 }] },
			mentees: { connect: { id: 3 } },
		},
	});
	// create + connect (many-to-many through junction)
	await db.teams.create({
		data: { name: 'core', members: { connect: [{ email: 'a@x.dev' }] } },
	});
	await db.members.create({
		data: {
			email: 'a@x.dev',
			settings: {} as Settings,
			teams: { connect: { name: 'core' } },
		},
	});

	db.articles.create({
		data: {
			title: 'x',
			// @ts-expect-error create relations only accept connect
			author: { disconnect: true },
		},
	});
	db.articles.create({
		data: {
			title: 'x',
			// @ts-expect-error one-relation connect accepts one selector, not a list
			author: { connect: [{ id: 1 }] },
		},
	});
	db.articles.create({
		data: {
			title: 'x',
			author: {
				connect: {
					// @ts-expect-error relation selectors use the target table's types
					id: 'one',
				},
			},
		},
	});
	db.articles.create({
		data: {
			title: 'x',
			author: {
				// @ts-expect-error relation selectors use the target table's keys
				connect: { headline: 'x' },
			},
		},
	});
	db.articles.create({
		data: {
			// @ts-expect-error unknown relation names are rejected
			reviewer: { connect: { id: 1 } },
			title: 'x',
		},
	});

	// update (one)
	await db.articles.update({
		where: { id: 1 },
		data: { author: { connect: { id: 2 } } },
	});
	await db.articles.update({
		where: { id: 1 },
		data: { editor: { disconnect: true } },
	});
	await db.articles.update({
		where: { id: 1 },
		data: { editor: { set: null }, title: 'x' },
	});
	await db.articles.update({
		where: { id: 1 },
		data: { editor: { set: { email: 'a@x.dev' } } },
	});
	await db.members.update({
		where: { id: 1 },
		data: { badge: { connect: { id: 1 } }, mentor: { disconnect: true } },
	});
	db.articles.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error one-relation commands are mutually exclusive
			editor: { connect: { id: 1 }, disconnect: true },
		},
	});
	db.articles.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error disconnect must be the literal true
			editor: { disconnect: false },
		},
	});
	db.articles.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error one-relation set accepts a selector or null, not a list
			editor: { set: [{ id: 1 }] },
		},
	});

	// update (many)
	await db.members.update({
		where: { id: 1 },
		data: {
			articles: { connect: [{ id: 1 }], disconnect: { id: 2 } },
		},
	});
	await db.members.update({
		where: { id: 1 },
		data: { articles: { set: [{ id: 1 }, { id: 2 }] } },
	});
	await db.members.update({
		where: { id: 1 },
		data: { mentees: { set: [] } },
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error many-relation set is exclusive with connect/disconnect
			articles: { set: [{ id: 1 }], connect: { id: 2 } },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error many-relation set requires a list
			articles: { set: { id: 1 } },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error many-relation set does not accept null
			articles: { set: null },
		},
	});

	// update (many-to-many through junction)
	await db.members.update({
		where: { id: 1 },
		data: {
			teams: { connect: { id: 1 }, disconnect: [{ name: 'old' }] },
		},
	});
	await db.teams.update({
		where: { id: 1 },
		data: { members: { set: [{ id: 1 }] } },
	});
	db.teams.update({
		where: { id: 1 },
		data: {
			members: {
				connect: {
					// @ts-expect-error many-to-many selectors use the target table
					name: 'core',
				},
			},
		},
	});
};

// ---------------------------------------------------------------------------
// Atomic updates
// ---------------------------------------------------------------------------

export const atomicWrites = async () => {
	await db.members.update({
		where: { id: 1 },
		data: {
			loginCount: { increment: 1 },
			rating: { decrement: 2, multiply: 3, divide: 4, set: 5 },
			active: { toggle: true },
		},
	});
	await db.members.updateMany({
		data: { loginCount: { multiply: 2 }, active: { toggle: true } },
	});
	await db.members.upsert({
		where: { id: 1 },
		create: { email: 'a@x.dev', settings: {} as Settings },
		update: { loginCount: { set: 0 } },
	});
	// plain values keep working next to envelopes
	await db.members.update({
		where: { id: 1 },
		data: { loginCount: 3, active: false },
	});

	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error numeric envelopes need at least one operator
			loginCount: {},
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error numeric operands must be numbers
			loginCount: { increment: '1' },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error toggle only accepts true
			active: { toggle: false },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error numeric columns do not support toggle
			loginCount: { toggle: true },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error text columns do not support numeric envelopes
			displayName: { increment: 1 },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error numeric() columns are string-typed, not numeric envelopes
			price: { increment: 1 },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error timestamp columns do not support numeric envelopes
			createdAt: { increment: 1 },
		},
	});

	// PostgreSQL arrays
	await db.members.update({
		where: { id: 1 },
		data: {
			tags: { append: 'x' },
			roles: { addUnique: ['admin', 'member'] },
		},
	});
	await db.members.updateMany({ data: { tags: { prepend: ['a', 'b'] } } });
	await db.members.updateMany({ data: { roles: { remove: 'member' } } });
	await db.members.updateMany({
		data: { tags: { replace: { from: 'a', to: 'b' } } },
	});
	await db.members.updateMany({
		data: {
			roles: {
				replace: [
					{ from: 'admin', to: 'member' },
					{ from: 'member', to: 'admin' },
				],
			},
		},
	});
	await db.members.updateMany({ data: { tags: ['full', 'replacement'] } });
	await db.members.updateEach({
		by: members.id,
		data: [{ id: 1 }],
		update: { tags: () => ({ append: 'x' }), roles: () => null },
	});
	await db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		update: { tags: { addUnique: 'x' } },
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error text[] rejects numeric elements
			tags: { append: 1 },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error enum[] keeps element narrowing
			roles: { addUnique: 'owner' },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error replace pairs are element-typed
			tags: { replace: { from: 'a', to: 1 } },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error only one array operator per envelope
			tags: { append: 'a', prepend: 'b' },
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error array envelopes are only for native arrays
			displayName: { append: 'x' },
		},
	});

	// JSONB path mutations
	await db.members.update({
		where: { id: 1 },
		data: {
			settings: {
				'theme.mode': 'dark',
				'theme.accent': '#fff',
				'flags.beta': true,
				'limits.daily': 10,
			},
		},
	});
	await db.members.update({
		where: { id: 1 },
		data: { settings: { json: { 'theme.mode': 'light' } } },
	});
	await db.members.update({
		where: { id: 1 },
		data: {
			settings: {
				theme: { mode: 'dark', accent: 'x' },
				flags: { beta: false },
				limits: { daily: 1 },
			},
		},
	});
	await db.members.update({
		where: { id: 1 },
		data: { settings: sql`'{}'::jsonb` },
	});
	await db.members.updateMany({
		data: { settings: { 'limits.daily': 5 } },
	});
	await db.members.upsertMany({
		data: [{ email: 'a@x.dev', settings: {} as Settings }],
		target: 'email',
		update: { settings: { 'flags.beta': true } },
	});
	await db.members.updateEach({
		by: members.id,
		data: [{ id: 1 }],
		update: { settings: () => ({ 'theme.mode': 'dark' }) },
	});
	await db.members.update({
		where: { id: 1 },
		data: { extra: { 'any.path': [1, 2], other: 'x' } },
	});
	db.members.update({
		where: { id: 1 },
		data: {
			settings: {
				// @ts-expect-error dotted leaf values are typed from $type
				'theme.mode': 'blue',
			},
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			settings: {
				// @ts-expect-error dotted paths must exist in $type
				'theme.size': 1,
			},
		},
	});
	db.members.update({
		where: { id: 1 },
		data: {
			settings: {
				// @ts-expect-error number leaves reject strings
				'limits.daily': 'ten',
			},
		},
	});
	db.members.updateEach({
		by: members.id,
		data: [{ id: 1 }],
		update: {
			// @ts-expect-error updateEach dotted leaves are typed too
			settings: () => ({ 'flags.beta': 'yes' }),
		},
	});
};

// ---------------------------------------------------------------------------
// Public arg types usable as annotations
// ---------------------------------------------------------------------------

export const createArgs: CreateArgs<PgSchema, 'articles'> = {
	data: { authorId: 1, title: 'x' },
	skipDuplicates: ['title'],
	select: { id: true },
	meta: { requestId: 'r' },
};
export const createManyArgs: CreateManyArgs<PgSchema, 'articles'> = {
	data: [{ authorId: 1, title: 'x' }],
};
export const updateArgs: UpdateArgs<PgSchema, 'articles'> = {
	where: { id: 1 },
	data: { views: { increment: 1 }, author: { connect: { id: 1 } } },
};
export const deleteArgs: DeleteArgs<PgSchema, 'articles'> = {
	where: { id: 1 },
	include: { author: true },
};
export const upsertArgs: UpsertArgs<PgSchema, 'articles'> = {
	where: { id: 1 },
	create: { authorId: 1, title: 'x' },
	update: { title: 'y' },
};
export const upsertManyArgs: UpsertManyArgs<PgSchema, 'articles'> = {
	data: [{ authorId: 1, title: 'x' }],
	target: 'id',
	update: ['title'],
};
export const updateEachArgs: UpdateEachArgs<PgSchema, 'articles'> = {
	by: articles.id,
	data: [{ id: 1, title: 'x' }],
	update: { title: (row) => String(row.title) },
};
export const badCreateArgs: CreateArgs<PgSchema, 'articles'> = {
	// @ts-expect-error annotations keep excess-property checks
	data: { authorId: 1, title: 'x', nope: true },
};
export const badUpsertManyArgs: UpsertManyArgs<PgSchema, 'articles'> = {
	data: [{ authorId: 1, title: 'x' }],
	target: 'id',
	update: 'all',
	// @ts-expect-error upsertMany does not accept include
	include: { author: true },
};
export const badUpdateEachArgs: UpdateEachArgs<PgSchema, 'articles'> = {
	by: articles.id,
	data: [],
	update: {},
	// @ts-expect-error updateEach does not accept include
	include: { author: true },
};

// ---------------------------------------------------------------------------
// SQLite schema
// ---------------------------------------------------------------------------

const sqliteAccounts = sqliteTable('writes_sqlite_accounts', {
	id: sqliteInteger('account_id').primaryKey({ autoIncrement: true }),
	handle: sqliteText('handle_name').notNull().unique(),
	enabled: sqliteInteger('is_enabled', { mode: 'boolean' })
		.notNull()
		.default(true),
	balance: sqliteInteger('balance_cents').notNull().default(0),
	bio: sqliteText('bio_text'),
	kind: sqliteText('account_kind', { enum: ['user', 'bot'] }).notNull(),
	joinedAt: sqliteInteger('joined_at', { mode: 'timestamp' }),
});
const sqliteNotes = sqliteTable('writes_sqlite_notes', {
	id: sqliteInteger('note_id').primaryKey(),
	accountId: sqliteInteger('owner_account_id').notNull(),
	body: sqliteText('note_body').notNull(),
});
const sqliteRelations = defineRelations(
	{ sqliteAccounts, sqliteNotes },
	(r) => ({
		sqliteAccounts: { notes: r.many.sqliteNotes() },
		sqliteNotes: {
			account: r.one.sqliteAccounts({
				from: r.sqliteNotes.accountId,
				to: r.sqliteAccounts.id,
			}),
		},
	}),
);
declare const sqliteDb: BetterDrizzleClient<typeof sqliteRelations>;
type SqliteAccount = typeof sqliteAccounts.$inferSelect;

export const sqliteWrites = async () => {
	const account = await sqliteDb.sqliteAccounts.create({
		data: { handle: 'ada', kind: 'user' },
	});
	assertType<Equal<typeof account, SqliteAccount>>();
	assertType<Equal<typeof account.enabled, boolean>>();
	assertType<Equal<typeof account.joinedAt, Date | null>>();

	const skipped = await sqliteDb.sqliteAccounts.create({
		data: { handle: 'ada', kind: 'bot' },
		skipDuplicates: ['handle'],
	});
	assertType<Equal<typeof skipped, SqliteAccount | null>>();

	await sqliteDb.sqliteAccounts.update({
		where: { handle: 'ada' },
		data: {
			balance: { increment: 100 },
			enabled: { toggle: true },
			notes: { connect: { id: 1 } },
		},
	});
	await sqliteDb.sqliteNotes.create({
		data: { body: 'x', account: { connect: { handle: 'ada' } } },
	});
	await sqliteDb.sqliteAccounts.upsertMany({
		data: [{ handle: 'ada', kind: 'user' }],
		target: 'handle',
		update: { balance: { increment: 1 } },
	});
	const withNotes = await sqliteDb.sqliteAccounts.upsert({
		where: { handle: 'ada' },
		create: { handle: 'ada', kind: 'user' },
		update: { bio: null },
		include: { notes: true },
	});
	assertType<
		Equal<(typeof withNotes.notes)[number], typeof sqliteNotes.$inferSelect>
	>();

	sqliteDb.sqliteAccounts.create({
		// @ts-expect-error text enum columns stay narrow
		data: { handle: 'ada', kind: 'admin' },
	});
	sqliteDb.sqliteAccounts.create({
		// @ts-expect-error boolean-mode integers take booleans
		data: { handle: 'ada', kind: 'user', enabled: 1 },
	});
	sqliteDb.sqliteAccounts.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error timestamp-mode integers are Date, not numeric envelopes
			joinedAt: { increment: 1 },
		},
	});
	sqliteDb.sqliteAccounts.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error PostgreSQL array envelopes do not apply to SQLite text
			bio: { append: 'x' },
		},
	});
	sqliteDb.sqliteAccounts.create({
		data: { handle: 'ada', kind: 'user' },
		// @ts-expect-error DB column names are not skipDuplicates targets
		skipDuplicates: ['handle_name'],
	});
};

// ---------------------------------------------------------------------------
// MySQL schema
// ---------------------------------------------------------------------------

type Prefs = { ui: { dense: boolean } };
const mysqlCustomers = mysqlTable('writes_mysql_customers', {
	id: mySerial('customer_id').primaryKey(),
	email: myVarchar('email_addr', { length: 191 }).notNull().unique(),
	points: int('loyalty_points').notNull().default(0),
	vip: myBoolean('is_vip').notNull().default(false),
	prefs: myJson('prefs_doc').$type<Prefs>(),
});
const mysqlOrders = mysqlTable('writes_mysql_orders', {
	id: mySerial('order_id').primaryKey(),
	customerId: int('customer_ref').notNull(),
	total: int('total_cents').notNull(),
});
const mysqlRelations = defineRelations(
	{ mysqlCustomers, mysqlOrders },
	(r) => ({
		mysqlCustomers: { orders: r.many.mysqlOrders() },
		mysqlOrders: {
			customer: r.one.mysqlCustomers({
				from: r.mysqlOrders.customerId,
				to: r.mysqlCustomers.id,
			}),
		},
	}),
);
declare const mysqlRaw: {
	readonly _: { readonly relations: typeof mysqlRelations };
};
const mysqlDb = better(mysqlRaw);
type MysqlCustomer = typeof mysqlCustomers.$inferSelect;

export const mysqlWrites = async () => {
	const customer = await mysqlDb.mysqlCustomers.create({
		data: { email: 'a@x.dev' },
	});
	assertType<Equal<typeof customer, MysqlCustomer>>();
	assertType<Equal<typeof customer.prefs, Prefs | null>>();

	const orders = await mysqlDb.mysqlOrders.createMany({
		data: [{ customerId: 1, total: 100 }],
		skipDuplicates: true,
	});
	assertType<Equal<typeof orders.count, number>>();

	await mysqlDb.mysqlCustomers.update({
		where: { email: 'a@x.dev' },
		data: {
			points: { increment: 10 },
			vip: { toggle: true },
			prefs: { ui: { dense: true } },
			orders: { connect: [{ id: 1 }] },
		},
	});
	await mysqlDb.mysqlCustomers.upsertMany({
		data: [{ email: 'a@x.dev' }],
		target: 'email',
		update: ['points'],
	});
	await mysqlDb.mysqlOrders.create({
		data: { total: 1, customer: { connect: { email: 'a@x.dev' } } },
	});

	mysqlDb.mysqlCustomers.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error JSONB dotted paths are PostgreSQL-only; MySQL json replaces
			prefs: { 'ui.dense': true },
		},
	});
	mysqlDb.mysqlCustomers.update({
		where: { id: 1 },
		data: {
			// @ts-expect-error MySQL json values are typed from $type
			prefs: { ui: { dense: 'yes' } },
		},
	});
	// @ts-expect-error MySQL insert still requires notNull columns
	mysqlDb.mysqlOrders.create({ data: { customerId: 1 } });
};
