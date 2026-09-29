import { Database } from 'bun:sqlite';

import { defineRelations } from 'drizzle-orm';
import { drizzle as sqliteDrizzle } from 'drizzle-orm/bun-sqlite';
import {
	int,
	json as mysqlJson,
	mysqlEnum,
	mysqlTable,
	varchar,
} from 'drizzle-orm/mysql-core';
import { drizzle as mysqlDrizzle } from 'drizzle-orm/mysql2';
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import {
	boolean,
	integer,
	pgTable,
	pgView,
	serial,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';
import {
	integer as sqliteInteger,
	sqliteTable,
	text as sqliteText,
} from 'drizzle-orm/sqlite-core';

import { better } from '../index';
import type {
	BetterAliasKey,
	BetterDrizzleClient,
	BetterRecord,
	BetterRepositoryKey,
	BetterTableKey,
	CursorPaginationResult,
	DbNameKey,
	ExplainResult,
	OffsetPaginationResult,
	Singularize,
} from '../index';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
type Expand<T> = T extends Date
	? T
	: T extends readonly (infer E)[]
		? Expand<E>[]
		: T extends object
			? { [K in keyof T]: Expand<T[K]> }
			: T;
type Exact<A, B> = Equal<Expand<A>, Expand<B>>;
const assertType = <_T extends true>() => {};
type Result<P> = Awaited<P>;

// ---------------------------------------------------------------------------
// PostgreSQL schema: TS keys differ from DB names on purpose.
// ---------------------------------------------------------------------------

const users = pgTable('app_users', {
	id: serial('user_id').primaryKey(),
	email: text('email_address').notNull(),
	displayName: text('display_name'),
	managerId: integer('manager_id'),
	createdAt: timestamp('created_at').notNull(),
});
const posts = pgTable('blog_posts', {
	id: integer('post_id').primaryKey(),
	authorId: integer('author_id').notNull(),
	editorId: integer('editor_id'),
	title: text('post_title').notNull(),
	published: boolean('is_published').notNull(),
});
const comments = pgTable('post_comments', {
	id: integer('comment_id').primaryKey(),
	postId: integer('post_fk').notNull(),
	body: text('comment_body').notNull(),
});
const profiles = pgTable('user_profiles', {
	id: integer('profile_id').primaryKey(),
	userId: integer('user_fk').notNull().unique(),
	bio: text('bio_text'),
});
const groups = pgTable('user_groups', {
	id: integer('group_id').primaryKey(),
	name: text('group_name').notNull(),
});
const memberships = pgTable('group_memberships', {
	userId: integer('member_user_id').notNull(),
	groupId: integer('member_group_id').notNull(),
});
const categories = pgTable('post_categories', {
	id: integer('category_id').primaryKey(),
	label: text('label').notNull(),
});
const activeUsers = pgView('active_users_view', {
	id: integer('user_id'),
	email: text('email_address'),
}).existing();

const relations = defineRelations(
	{
		users,
		posts,
		comments,
		profiles,
		groups,
		memberships,
		categories,
		activeUsers,
	},
	(r) => ({
		users: {
			posts: r.many.posts({
				from: r.users.id,
				to: r.posts.authorId,
				alias: 'author',
			}),
			editedPosts: r.many.posts({
				from: r.users.id,
				to: r.posts.editorId,
				alias: 'editor',
			}),
			profile: r.one.profiles({
				from: r.users.id,
				to: r.profiles.userId,
			}),
			manager: r.one.users({
				from: r.users.managerId,
				to: r.users.id,
				alias: 'management',
			}),
			reports: r.many.users({
				from: r.users.id,
				to: r.users.managerId,
				alias: 'management',
			}),
			groups: r.many.groups({
				from: r.users.id.through(r.memberships.userId),
				to: r.groups.id.through(r.memberships.groupId),
			}),
		},
		posts: {
			author: r.one.users({
				from: r.posts.authorId,
				to: r.users.id,
				alias: 'author',
				optional: false,
			}),
			editor: r.one.users({
				from: r.posts.editorId,
				to: r.users.id,
				alias: 'editor',
			}),
			comments: r.many.comments(),
		},
		comments: {
			post: r.one.posts({ from: r.comments.postId, to: r.posts.id }),
		},
		profiles: {
			user: r.one.users({ from: r.profiles.userId, to: r.users.id }),
		},
		groups: {
			members: r.many.users({
				from: r.groups.id.through(r.memberships.groupId),
				to: r.users.id.through(r.memberships.userId),
			}),
		},
	}),
);
type S = typeof relations;

type UserRow = {
	id: number;
	email: string;
	displayName: string | null;
	managerId: number | null;
	createdAt: Date;
};
type PostRow = {
	id: number;
	authorId: number;
	editorId: number | null;
	title: string;
	published: boolean;
};
type CommentRow = { id: number; postId: number; body: string };
type ProfileRow = { id: number; userId: number; bio: string | null };
type GroupRow = { id: number; name: string };

// 1. Table keys, views, repository lookup, singular/plural names.

assertType<
	Equal<
		BetterTableKey<S>,
		| 'users'
		| 'posts'
		| 'comments'
		| 'profiles'
		| 'groups'
		| 'memberships'
		| 'categories'
	>
>();
assertType<
	Equal<
		DbNameKey<S>,
		| 'app_users'
		| 'blog_posts'
		| 'post_comments'
		| 'user_profiles'
		| 'user_groups'
		| 'group_memberships'
		| 'post_categories'
	>
>();
assertType<Equal<'activeUsers' extends BetterTableKey<S> ? 1 : 0, 0>>();
assertType<Equal<'active_users_view' extends DbNameKey<S> ? 1 : 0, 0>>();
assertType<Equal<BetterRepositoryKey<S>, BetterTableKey<S> | DbNameKey<S>>>();
assertType<
	Equal<
		BetterAliasKey<S>,
		| 'user'
		| 'post'
		| 'comment'
		| 'profile'
		| 'group'
		| 'membership'
		| 'category'
	>
>();
assertType<Equal<Singularize<'categories'>, 'category'>>();
assertType<Equal<Singularize<'users'>, 'user'>>();
assertType<Equal<Singularize<'staff'>, 'staff'>>();
assertType<Exact<BetterRecord<S, 'users'>, UserRow>>();
assertType<
	Exact<BetterRecord<S, 'categories'>, { id: number; label: string }>
>();

const makePg = () => better(pgDrizzle.mock({ relations }));
declare const db: ReturnType<typeof makePg>;
declare const typedDb: BetterDrizzleClient<S>;

assertType<
	Equal<
		Result<ReturnType<typeof db.users.findMany<{}>>>,
		Result<ReturnType<typeof typedDb.users.findMany<{}>>>
	>
>();

export const tableKeys = () => {
	void db.users;
	void db.posts;
	void db.comments;
	void db.profiles;
	void db.groups;
	void db.memberships;
	void db.categories;
	// @ts-expect-error views are not repositories
	void db.activeUsers;
	// @ts-expect-error singular aliases are not client keys
	void db.user;
	// @ts-expect-error DB names are only accepted through repository()
	void db.app_users;

	const byKey = db.repository('users');
	const byDbName = db.repository('app_users');
	const categoriesByDbName = db.repository('post_categories');
	assertType<
		Exact<Result<ReturnType<typeof byKey.findMany<{}>>>, UserRow[]>
	>();
	assertType<
		Exact<Result<ReturnType<typeof byDbName.findMany<{}>>>, UserRow[]>
	>();
	assertType<
		Exact<
			Result<ReturnType<typeof categoriesByDbName.findMany<{}>>>,
			{ id: number; label: string }[]
		>
	>();
	// @ts-expect-error unknown repository name
	db.repository('nope');
	// @ts-expect-error singular aliases are not repository names
	db.repository('user');
	// @ts-expect-error views are not repositories
	db.repository('active_users_view');
	// @ts-expect-error views are not repositories
	db.repository('activeUsers');
};

// 2. Read return types, explain, throw.

export const readReturns = async () => {
	const many = await db.users.findMany();
	assertType<Exact<typeof many, UserRow[]>>();
	const manyArgs = await db.users.findMany({ where: { id: 1 } });
	assertType<Exact<typeof manyArgs, UserRow[]>>();

	const first = await db.users.findFirst();
	assertType<Exact<typeof first, UserRow | null>>();
	const one = await db.users.findOne({ where: { email: 'a' } });
	assertType<Exact<typeof one, UserRow | null>>();
	const unique = await db.users.findUnique({ where: { id: 1 } });
	assertType<Exact<typeof unique, UserRow | null>>();

	const firstThrow = await db.users.findFirst().throw();
	assertType<Exact<typeof firstThrow, UserRow>>();
	const oneThrow = await db.users
		.findOne({ where: { id: 1 } })
		.throw(() => new Error('missing'));
	assertType<Exact<typeof oneThrow, UserRow>>();
	const uniqueThrow = await db.users
		.findUnique({ select: { id: true }, where: { id: 1 } })
		.throw();
	assertType<Exact<typeof uniqueThrow, { id: number }>>();

	const total = await db.users.count();
	assertType<Equal<typeof total, number>>();
	const filteredTotal = await db.users.count({
		where: { email: { contains: '@' } },
		cursor: { id: 10 },
	});
	assertType<Equal<typeof filteredTotal, number>>();
	const found = await db.users.exists({ where: { id: 1 } });
	assertType<Equal<typeof found, boolean>>();

	const page = await db.users.paginate({
		limit: 10,
		skip: 20,
		orderBy: { createdAt: 'desc' },
		where: { displayName: { not: null } },
	});
	assertType<Exact<typeof page, OffsetPaginationResult<UserRow>>>();
	assertType<Equal<typeof page.pagination.type, 'offset'>>();
	assertType<
		Exact<
			typeof page.pagination,
			{
				type: 'offset';
				page: number;
				perPage: number;
				total: number;
				pageCount: number;
				hasNext: boolean;
				hasPrevious: boolean;
			}
		>
	>();
	const {
		data: pageData,
		pagination: { total: pageTotal, hasNext },
	} = page;
	assertType<Exact<typeof pageData, UserRow[]>>();
	assertType<Equal<typeof pageTotal, number>>();
	assertType<Equal<typeof hasNext, boolean>>();

	const cursorPage = await db.users.cursor({
		limit: 10,
		after: { id: 5 },
		orderBy: { id: 'asc' },
	});
	assertType<Exact<typeof cursorPage, CursorPaginationResult<UserRow>>>();
	assertType<
		Exact<
			typeof cursorPage.pagination,
			{
				type: 'cursor';
				hasNext: boolean;
				hasPrevious: boolean;
				nextCursor: string | object | null;
				previousCursor: string | object | null;
			}
		>
	>();
	const backwards = await db.posts.cursor({
		limit: 5,
		before: { id: 50 },
		select: { id: true, title: true },
	});
	assertType<Exact<typeof backwards.data, { id: number; title: string }[]>>();
	const projectedPage = await db.posts.paginate({
		limit: 5,
		include: { author: true },
	});
	assertType<
		Exact<typeof projectedPage.data, (PostRow & { author: UserRow })[]>
	>();

	// explain() on every read helper.
	const explained = await Promise.all([
		db.users.findMany().explain(),
		db.users.findFirst().explain({ analyze: true, verbose: true }),
		db.users.findOne().explain(),
		db.users.findUnique({ where: { id: 1 } }).explain(),
		db.users.count().explain({ costs: false }),
		db.users.exists().explain({ timing: true, summary: true }),
		db.users.paginate({ limit: 1 }).explain(),
		db.users.cursor({ limit: 1 }).explain(),
	]);
	assertType<Equal<(typeof explained)[number], ExplainResult>>();
	const plan = await db.users
		.findMany({ include: { posts: true } })
		.explain();
	assertType<Equal<typeof plan.operation, ExplainResult['operation']>>();
	assertType<
		Equal<typeof plan.deferredRelations, ExplainResult['deferredRelations']>
	>();

	// Promise compatibility.
	const thenable: PromiseLike<UserRow[]> = db.users.findMany();
	void thenable;

	// @ts-expect-error findMany results have no throw()
	void db.users.findMany().throw();
	// @ts-expect-error count results have no throw()
	void db.users.count().throw();
	// @ts-expect-error findUnique requires args
	void db.users.findUnique();
	// @ts-expect-error paginate requires args
	void db.users.paginate();
	// @ts-expect-error cursor requires args
	void db.users.cursor();
	// @ts-expect-error explain flags are booleans
	void db.users.findMany().explain({ analyze: 'yes' });
	// @ts-expect-error count does not accept select
	void db.users.count({ select: { id: true } });
	// @ts-expect-error count does not accept lock
	void db.users.count({ lock: 'update' });
	// @ts-expect-error exists does not accept take
	void db.users.exists({ take: 1 });
	// @ts-expect-error cursor positions are typed by column
	void db.users.cursor({ limit: 1, after: { id: 'x' } });
	// @ts-expect-error cursor positions use scalar columns only
	void db.users.cursor({ limit: 1, after: { posts: 1 } });
	// @ts-expect-error paginate limit is a number
	void db.users.paginate({ limit: '10' });
	// @ts-expect-error take is a number
	void db.users.findMany({ take: '10' });
	// @ts-expect-error count results are numbers
	const badTotal: string = await db.users.count();
	// @ts-expect-error findFirst may resolve to null
	const badFirst: UserRow = await db.users.findFirst();
	void [badTotal, badFirst];
	// Row locks on read helpers.
	void db.users.findMany({ lock: 'update' });
	void db.users.findFirst({
		lock: { mode: 'noKeyUpdate', skipLocked: true, tables: ['users'] },
	});
	void db.users.findFirst({ lock: { mode: 'share', tables: ['app_users'] } });
	// @ts-expect-error unknown lock mode
	void db.users.findMany({ lock: 'exclusive' });
	// @ts-expect-error lock tables are schema keys or DB names
	void db.users.findMany({ lock: { mode: 'update', tables: ['nope'] } });
};

// 3. Projections and relation payloads.

export const projections = async () => {
	const picked = await db.users.findMany({
		select: { id: true, email: true },
	});
	assertType<Exact<typeof picked, { id: number; email: string }[]>>();

	const withFalse = await db.users.findFirst({
		select: { id: true, email: false, displayName: true },
	});
	assertType<
		Exact<
			typeof withFalse,
			{ id: number; displayName: string | null } | null
		>
	>();

	const nested = await db.users.findMany({
		select: {
			id: true,
			posts: { select: { title: true }, where: { published: true } },
			profile: true,
		},
	});
	assertType<
		Exact<
			typeof nested,
			{
				id: number;
				posts: { title: string }[];
				profile: ProfileRow | null;
			}[]
		>
	>();

	const relationOnly = await db.users.findMany({
		select: { posts: true },
	});
	assertType<Exact<typeof relationOnly, { posts: PostRow[] }[]>>();

	const selectThenInclude = await db.users.findMany({
		select: {
			email: true,
			posts: { include: { comments: true } },
		},
	});
	assertType<
		Exact<
			typeof selectThenInclude,
			{
				email: string;
				posts: (PostRow & { comments: CommentRow[] })[];
			}[]
		>
	>();

	// include: one / many / many-to-many / self / aliased pairs.
	const included = await db.users.findMany({
		include: {
			profile: true,
			posts: true,
			editedPosts: true,
			groups: true,
			manager: true,
			reports: true,
		},
	});
	assertType<
		Exact<
			typeof included,
			(UserRow & {
				profile: ProfileRow | null;
				posts: PostRow[];
				editedPosts: PostRow[];
				groups: GroupRow[];
				manager: UserRow | null;
				reports: UserRow[];
			})[]
		>
	>();

	const aliased = await db.posts.findFirst({
		include: { author: true, editor: true },
	});
	assertType<
		Exact<
			typeof aliased,
			(PostRow & { author: UserRow; editor: UserRow | null }) | null
		>
	>();

	const throughReverse = await db.groups.findMany({
		include: { members: { select: { id: true } } },
	});
	assertType<
		Exact<
			typeof throughReverse,
			(GroupRow & { members: { id: number }[] })[]
		>
	>();

	// Deep nesting (users -> posts -> comments -> post -> author).
	const deep = await db.users.findMany({
		include: {
			posts: {
				include: {
					comments: {
						include: {
							post: { include: { author: true } },
						},
					},
				},
			},
		},
	});
	assertType<
		Exact<
			typeof deep,
			(UserRow & {
				posts: (PostRow & {
					comments: (CommentRow & {
						post: (PostRow & { author: UserRow | null }) | null;
					})[];
				})[];
			})[]
		>
	>();

	// Nested where/orderBy/take/skip/cursor inside include.
	const filteredInclude = await db.users.findUnique({
		where: { id: 1 },
		include: {
			posts: {
				where: { published: true, title: { contains: 'drizzle' } },
				orderBy: [{ id: 'desc' }, { title: 'asc' }],
				take: 5,
				skip: 1,
				cursor: { id: 10 },
				include: { comments: { take: 3, orderBy: { id: 'asc' } } },
			},
			profile: { where: { bio: { not: null } } },
			groups: { where: { name: { startsWith: 'a' } }, take: 2 },
			reports: { select: { email: true }, orderBy: { email: 'asc' } },
		},
	});
	assertType<
		Exact<
			typeof filteredInclude,
			| (UserRow & {
					posts: (PostRow & { comments: CommentRow[] })[];
					profile: ProfileRow | null;
					groups: GroupRow[];
					reports: { email: string }[];
			  })
			| null
		>
	>();

	// _count with true and { where }, alone and mixed with relations.
	const counted = await db.users.findMany({
		include: {
			_count: {
				select: {
					posts: true,
					groups: { where: { name: 'core' } },
					profile: true,
					reports: { where: { email: { endsWith: '.dev' } } },
				},
			},
		},
	});
	assertType<
		Exact<
			typeof counted,
			(UserRow & {
				_count: {
					posts: number;
					groups: number;
					profile: number;
					reports: number;
				};
			})[]
		>
	>();

	const mixed = await db.users.findFirst({
		include: {
			posts: { include: { _count: { select: { comments: true } } } },
			_count: { select: { editedPosts: true } },
		},
	});
	assertType<
		Exact<
			typeof mixed,
			| (UserRow & {
					posts: (PostRow & { _count: { comments: number } })[];
					_count: { editedPosts: number };
			  })
			| null
		>
	>();

	const pagedCount = await db.groups.paginate({
		limit: 5,
		include: { _count: { select: { members: true } } },
	});
	assertType<
		Exact<
			typeof pagedCount.data,
			(GroupRow & { _count: { members: number } })[]
		>
	>();

	// Negatives.
	// @ts-expect-error unknown relation in include
	void db.users.findMany({ include: { nope: true } });
	// @ts-expect-error scalar columns are not includable
	void db.users.findMany({ include: { email: true } });
	// @ts-expect-error unknown column in select
	void db.users.findMany({ select: { nope: true } });
	// @ts-expect-error _count is include-only
	void db.users.findMany({ select: { _count: { select: { posts: true } } } });
	void db.users.findMany({
		// @ts-expect-error scalar columns are not countable
		include: { _count: { select: { email: true } } },
	});
	void db.users.findMany({
		// @ts-expect-error _count selectors only accept where
		include: { _count: { select: { posts: { take: 1 } } } },
	});
	// @ts-expect-error _count needs a select map
	void db.users.findMany({ include: { _count: { posts: true } } });
	// @ts-expect-error nested take is a number
	void db.users.findMany({ include: { posts: { take: 'ten' } } });
	// @ts-expect-error nested where is typed by the related table
	void db.users.findMany({ include: { posts: { where: { title: 5 } } } });
	// @ts-expect-error nested where rejects parent columns
	void db.users.findMany({ include: { posts: { where: { email: 'a' } } } });
	void db.users.findMany({
		// @ts-expect-error nested orderBy direction
		include: { posts: { orderBy: { title: 'up' } } },
	});
	// @ts-expect-error nested cursor typed by related table
	void db.users.findMany({ include: { posts: { cursor: { id: 'x' } } } });
	// @ts-expect-error unknown relation at second level
	void db.users.findMany({ include: { posts: { include: { nope: true } } } });
	void db.users.findMany({
		include: {
			// @ts-expect-error unknown relation at third level
			posts: { include: { comments: { include: { nope: true } } } },
		},
	});
	// @ts-expect-error relation arg must be true or query args
	void db.users.findMany({ include: { posts: 'yes' } });
	// @ts-expect-error scalar select values are booleans
	void db.users.findMany({ select: { id: { where: {} } } });
	// @ts-expect-error nested select uses related-table columns
	void db.users.findMany({ select: { posts: { select: { email: true } } } });
	// @ts-expect-error selected rows do not expose unselected columns
	void (await db.users.findMany({ select: { id: true } }))[0]!.email;
	// @ts-expect-error included rows do not expose unrequested relations
	void (await db.users.findMany({ include: { posts: true } }))[0]!.profile;
	// @ts-expect-error optional one-relation payloads may be null
	void (await db.posts.findMany({ include: { editor: true } }))[0]!.editor.id;
	// required (optional: false) one-relations are non-null
	void (await db.posts.findMany({ include: { author: true } }))[0]!.author.id;
};

export const strictArgs = async () => {
	// @ts-expect-error select and include cannot be combined at one level
	void db.users.findMany({ select: { id: true }, include: { posts: true } });
	void db.users.findMany({
		// @ts-expect-error nor inside nested relation args
		include: {
			posts: { select: { id: true }, include: { author: true } },
		},
	});
	// an undefined projection does not count
	void db.users.findMany({ select: { id: true }, include: undefined });
	// @ts-expect-error unknown top-level keys are rejected
	void db.users.findMany({ wher: { id: 1 } });
	// @ts-expect-error unknown keys next to valid ones are rejected
	void db.users.findMany({ where: { name: 'a', nope: 1 } });
	// @ts-expect-error unknown select keys are rejected
	void db.users.findMany({ select: { id: true, nope: true } });
	// @ts-expect-error unknown orderBy keys are rejected
	void db.users.findMany({ orderBy: { nope: 'asc' } });
};

// NOTE: runtime-only rules are not typed: cursor `before` + `after`,
// `lock` + `include`, and `skipLocked` + `noWait` all compile.

// ---------------------------------------------------------------------------
// SQLite schema.
// ---------------------------------------------------------------------------

const sqliteAuthors = sqliteTable('lite_authors', {
	id: sqliteInteger('author_id').primaryKey(),
	fullName: sqliteText('full_name').notNull(),
	isAdmin: sqliteInteger('is_admin', { mode: 'boolean' }).notNull(),
	joinedAt: sqliteInteger('joined_at', { mode: 'timestamp' }),
	tags: sqliteText('tags_json', { mode: 'json' }).$type<string[]>(),
});
const sqliteBooks = sqliteTable('lite_books', {
	id: sqliteInteger('book_id').primaryKey(),
	authorId: sqliteInteger('author_fk').notNull(),
	title: sqliteText('book_title').notNull(),
});
const sqliteRelations = defineRelations(
	{ sqliteAuthors, sqliteBooks },
	(r) => ({
		sqliteAuthors: { books: r.many.sqliteBooks() },
		sqliteBooks: {
			author: r.one.sqliteAuthors({
				from: r.sqliteBooks.authorId,
				to: r.sqliteAuthors.id,
			}),
		},
	}),
);
const makeSqlite = () =>
	better(
		sqliteDrizzle({
			client: new Database(':memory:'),
			relations: sqliteRelations,
		}),
	);
declare const lite: ReturnType<typeof makeSqlite>;

type LiteAuthor = {
	id: number;
	fullName: string;
	isAdmin: boolean;
	joinedAt: Date | null;
	tags: string[] | null;
};
type LiteBook = { id: number; authorId: number; title: string };

export const sqliteReads = async () => {
	assertType<
		Equal<DbNameKey<typeof sqliteRelations>, 'lite_authors' | 'lite_books'>
	>();
	const authors = await lite.sqliteAuthors.findMany({
		include: { books: { where: { title: { contains: 'x' } } } },
		orderBy: { joinedAt: { direction: 'desc', nulls: 'last' } },
	});
	assertType<Exact<typeof authors, (LiteAuthor & { books: LiteBook[] })[]>>();
	const book = await lite
		.repository('lite_books')
		.findFirst({ include: { author: { select: { fullName: true } } } })
		.throw();
	assertType<
		Exact<typeof book, LiteBook & { author: { fullName: string } | null }>
	>();
	const counts = await lite.sqliteAuthors.findMany({
		select: { id: true, isAdmin: true },
		where: { isAdmin: true, joinedAt: { lt: new Date() } },
	});
	assertType<Exact<typeof counts, { id: number; isAdmin: boolean }[]>>();
	const n = await lite.sqliteBooks.count({
		where: { author: { is: { isAdmin: true } } },
	});
	assertType<Equal<typeof n, number>>();
	// @ts-expect-error unknown SQLite relation
	void lite.sqliteBooks.findMany({ include: { reviews: true } });
	// @ts-expect-error SQLite repositories resolve by TS key or DB name only
	void lite.repository('books');
};

// ---------------------------------------------------------------------------
// MySQL schema.
// ---------------------------------------------------------------------------

const customers = mysqlTable('shop_customers', {
	id: int('customer_id').primaryKey().autoincrement(),
	email: varchar('email_addr', { length: 255 }).notNull(),
	tier: mysqlEnum('tier_level', ['free', 'pro']).notNull(),
	meta: mysqlJson('meta_json').$type<{ source: { campaign: string } }>(),
});
const orders = mysqlTable('shop_orders', {
	id: int('order_id').primaryKey().autoincrement(),
	customerId: int('customer_fk').notNull(),
	total: int('total_cents').notNull(),
});
const mysqlRelations = defineRelations({ customers, orders }, (r) => ({
	customers: { orders: r.many.orders() },
	orders: {
		customer: r.one.customers({
			from: r.orders.customerId,
			to: r.customers.id,
		}),
	},
}));
const makeMysql = () =>
	better(mysqlDrizzle.mock({ relations: mysqlRelations }));
declare const my: ReturnType<typeof makeMysql>;

type Customer = {
	id: number;
	email: string;
	tier: 'free' | 'pro';
	meta: { source: { campaign: string } } | null;
};
type Order = { id: number; customerId: number; total: number };

export const mysqlReads = async () => {
	const rows = await my.customers.findMany({
		include: {
			orders: { where: { total: { gte: 100 } }, take: 3 },
			_count: { select: { orders: true } },
		},
		where: { tier: 'pro' },
		lock: { mode: 'update', skipLocked: true },
	});
	assertType<
		Exact<
			typeof rows,
			(Customer & { orders: Order[]; _count: { orders: number } })[]
		>
	>();
	const order = await my.repository('shop_orders').findUnique({
		where: { id: 1 },
		select: { total: true, customer: { select: { tier: true } } },
	});
	assertType<
		Exact<
			typeof order,
			{ total: number; customer: { tier: 'free' | 'pro' } | null } | null
		>
	>();
	const page = await my.orders.cursor({ limit: 10, after: { id: 3 } });
	assertType<Exact<typeof page.data, Order[]>>();
	// @ts-expect-error enum columns only accept declared values
	void my.customers.findMany({ where: { tier: 'enterprise' } });
	// @ts-expect-error MySQL repository names are TS keys or DB names
	void my.repository('customer');
};
