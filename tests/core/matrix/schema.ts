import { defineRelations } from 'drizzle-orm';
import {
	boolean,
	integer as pgInteger,
	pgTable,
	primaryKey as pgPrimaryKey,
	text as pgText,
	timestamp,
	unique as pgUnique,
} from 'drizzle-orm/pg-core';
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
	unique,
} from 'drizzle-orm/sqlite-core';

// One logical model, two dialects. TS keys intentionally differ from DB
// column names (`authorId` -> `author_id`, `createdAt` -> `created_at`).

export const createSqliteSchema = (prefix: string) => {
	const users = sqliteTable(`${prefix}users`, {
		id: integer('id').primaryKey(),
		email: text('email').notNull().unique(),
		name: text('name').notNull(),
		age: integer('age').notNull(),
		active: integer('active', { mode: 'boolean' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		nickname: text('nickname'),
	});
	const profiles = sqliteTable(`${prefix}profiles`, {
		id: integer('id').primaryKey(),
		userId: integer('user_id')
			.unique()
			.references(() => users.id),
		bio: text('bio').notNull(),
	});
	const categories = sqliteTable(`${prefix}categories`, {
		id: integer('id').primaryKey(),
		name: text('name').notNull(),
		parentId: integer('parent_id'),
	});
	const posts = sqliteTable(`${prefix}posts`, {
		id: integer('id').primaryKey(),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id),
		editorId: integer('editor_id').references(() => users.id),
		categoryId: integer('category_id').references(() => categories.id),
		title: text('title').notNull(),
		score: integer('score').notNull(),
		published: integer('published', { mode: 'boolean' }).notNull(),
	});
	const comments = sqliteTable(`${prefix}comments`, {
		id: integer('id').primaryKey(),
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id),
		body: text('body').notNull(),
		likes: integer('likes').notNull(),
	});
	const follows = sqliteTable(
		`${prefix}follows`,
		{
			followerId: integer('follower_id')
				.notNull()
				.references(() => users.id),
			followingId: integer('following_id')
				.notNull()
				.references(() => users.id),
		},
		(t) => [primaryKey({ columns: [t.followerId, t.followingId] })],
	);
	const groups = sqliteTable(`${prefix}groups`, {
		id: integer('id').primaryKey(),
		name: text('name').notNull().unique(),
	});
	const memberships = sqliteTable(
		`${prefix}memberships`,
		{
			id: integer('id').primaryKey(),
			userId: integer('user_id')
				.notNull()
				.references(() => users.id),
			groupId: integer('group_id')
				.notNull()
				.references(() => groups.id),
			role: text('role').notNull().default('member'),
		},
		(t) => [unique().on(t.userId, t.groupId)],
	);
	const tags = sqliteTable(`${prefix}tags`, {
		id: integer('id').primaryKey(),
		name: text('name').notNull().unique(),
	});
	const postTags = sqliteTable(
		`${prefix}post_tags`,
		{
			postId: integer('post_id')
				.notNull()
				.references(() => posts.id),
			tagId: integer('tag_id')
				.notNull()
				.references(() => tags.id),
		},
		(t) => [primaryKey({ columns: [t.postId, t.tagId] })],
	);

	const schema = {
		categories,
		comments,
		follows,
		groups,
		memberships,
		postTags,
		posts,
		profiles,
		tags,
		users,
	};

	const relations = defineRelations(schema, (r) => ({
		users: {
			profile: r.one.profiles({
				from: r.users.id,
				to: r.profiles.userId,
			}),
			posts: r.many.posts({ alias: 'author' }),
			editedPosts: r.many.posts({ alias: 'editor' }),
			comments: r.many.comments({ alias: 'commentAuthor' }),
			memberships: r.many.memberships(),
			groups: r.many.groups({
				from: r.users.id.through(r.memberships.userId),
				to: r.groups.id.through(r.memberships.groupId),
			}),
			following: r.many.users({
				from: r.users.id.through(r.follows.followerId),
				to: r.users.id.through(r.follows.followingId),
			}),
			followers: r.many.users({
				from: r.users.id.through(r.follows.followingId),
				to: r.users.id.through(r.follows.followerId),
			}),
			publishedPosts: r.many.posts({
				from: r.users.id,
				to: r.posts.authorId,
				where: { published: true },
			}),
		},
		profiles: {
			user: r.one.users({ from: r.profiles.userId, to: r.users.id }),
		},
		categories: {
			parent: r.one.categories({
				from: r.categories.parentId,
				to: r.categories.id,
				alias: 'tree',
			}),
			children: r.many.categories({ alias: 'tree' }),
			posts: r.many.posts(),
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
			category: r.one.categories({
				from: r.posts.categoryId,
				to: r.categories.id,
			}),
			comments: r.many.comments(),
			postTags: r.many.postTags(),
			tags: r.many.tags({
				from: r.posts.id.through(r.postTags.postId),
				to: r.tags.id.through(r.postTags.tagId),
			}),
			firstTag: r.one.tags({
				from: r.posts.id.through(r.postTags.postId),
				to: r.tags.id.through(r.postTags.tagId),
			}),
		},
		comments: {
			author: r.one.users({
				from: r.comments.authorId,
				to: r.users.id,
				alias: 'commentAuthor',
				optional: false,
			}),
			post: r.one.posts({
				from: r.comments.postId,
				to: r.posts.id,
				optional: false,
			}),
		},
		follows: {
			follower: r.one.users({
				from: r.follows.followerId,
				to: r.users.id,
			}),
			following: r.one.users({
				from: r.follows.followingId,
				to: r.users.id,
			}),
		},
		groups: {
			memberships: r.many.memberships(),
			users: r.many.users({
				from: r.groups.id.through(r.memberships.groupId),
				to: r.users.id.through(r.memberships.userId),
			}),
		},
		memberships: {
			user: r.one.users({
				from: r.memberships.userId,
				to: r.users.id,
			}),
			group: r.one.groups({
				from: r.memberships.groupId,
				to: r.groups.id,
			}),
		},
		tags: {
			postTags: r.many.postTags(),
			posts: r.many.posts({
				from: r.tags.id.through(r.postTags.tagId),
				to: r.posts.id.through(r.postTags.postId),
			}),
		},
		postTags: {
			post: r.one.posts({ from: r.postTags.postId, to: r.posts.id }),
			tag: r.one.tags({ from: r.postTags.tagId, to: r.tags.id }),
		},
	}));

	return { relations, schema };
};

export const createPgSchema = (prefix: string) => {
	const users = pgTable(`${prefix}users`, {
		id: pgInteger('id').primaryKey(),
		email: pgText('email').notNull().unique(),
		name: pgText('name').notNull(),
		age: pgInteger('age').notNull(),
		active: boolean('active').notNull(),
		createdAt: timestamp('created_at', {
			mode: 'date',
			withTimezone: true,
		}).notNull(),
		nickname: pgText('nickname'),
	});
	const profiles = pgTable(`${prefix}profiles`, {
		id: pgInteger('id').primaryKey(),
		userId: pgInteger('user_id')
			.unique()
			.references(() => users.id),
		bio: pgText('bio').notNull(),
	});
	const categories = pgTable(`${prefix}categories`, {
		id: pgInteger('id').primaryKey(),
		name: pgText('name').notNull(),
		parentId: pgInteger('parent_id'),
	});
	const posts = pgTable(`${prefix}posts`, {
		id: pgInteger('id').primaryKey(),
		authorId: pgInteger('author_id')
			.notNull()
			.references(() => users.id),
		editorId: pgInteger('editor_id').references(() => users.id),
		categoryId: pgInteger('category_id').references(() => categories.id),
		title: pgText('title').notNull(),
		score: pgInteger('score').notNull(),
		published: boolean('published').notNull(),
	});
	const comments = pgTable(`${prefix}comments`, {
		id: pgInteger('id').primaryKey(),
		postId: pgInteger('post_id')
			.notNull()
			.references(() => posts.id),
		authorId: pgInteger('author_id')
			.notNull()
			.references(() => users.id),
		body: pgText('body').notNull(),
		likes: pgInteger('likes').notNull(),
	});
	const follows = pgTable(
		`${prefix}follows`,
		{
			followerId: pgInteger('follower_id')
				.notNull()
				.references(() => users.id),
			followingId: pgInteger('following_id')
				.notNull()
				.references(() => users.id),
		},
		(t) => [pgPrimaryKey({ columns: [t.followerId, t.followingId] })],
	);
	const groups = pgTable(`${prefix}groups`, {
		id: pgInteger('id').primaryKey(),
		name: pgText('name').notNull().unique(),
	});
	const memberships = pgTable(
		`${prefix}memberships`,
		{
			id: pgInteger('id').primaryKey().generatedByDefaultAsIdentity(),
			userId: pgInteger('user_id')
				.notNull()
				.references(() => users.id),
			groupId: pgInteger('group_id')
				.notNull()
				.references(() => groups.id),
			role: pgText('role').notNull().default('member'),
		},
		(t) => [pgUnique().on(t.userId, t.groupId)],
	);
	const tags = pgTable(`${prefix}tags`, {
		id: pgInteger('id').primaryKey(),
		name: pgText('name').notNull().unique(),
	});
	const postTags = pgTable(
		`${prefix}post_tags`,
		{
			postId: pgInteger('post_id')
				.notNull()
				.references(() => posts.id),
			tagId: pgInteger('tag_id')
				.notNull()
				.references(() => tags.id),
		},
		(t) => [pgPrimaryKey({ columns: [t.postId, t.tagId] })],
	);

	const schema = {
		categories,
		comments,
		follows,
		groups,
		memberships,
		postTags,
		posts,
		profiles,
		tags,
		users,
	};

	// Must stay identical to the SQLite relations above.
	const relations = defineRelations(schema, (r) => ({
		users: {
			profile: r.one.profiles({
				from: r.users.id,
				to: r.profiles.userId,
			}),
			posts: r.many.posts({ alias: 'author' }),
			editedPosts: r.many.posts({ alias: 'editor' }),
			comments: r.many.comments({ alias: 'commentAuthor' }),
			memberships: r.many.memberships(),
			groups: r.many.groups({
				from: r.users.id.through(r.memberships.userId),
				to: r.groups.id.through(r.memberships.groupId),
			}),
			following: r.many.users({
				from: r.users.id.through(r.follows.followerId),
				to: r.users.id.through(r.follows.followingId),
			}),
			followers: r.many.users({
				from: r.users.id.through(r.follows.followingId),
				to: r.users.id.through(r.follows.followerId),
			}),
			publishedPosts: r.many.posts({
				from: r.users.id,
				to: r.posts.authorId,
				where: { published: true },
			}),
		},
		profiles: {
			user: r.one.users({ from: r.profiles.userId, to: r.users.id }),
		},
		categories: {
			parent: r.one.categories({
				from: r.categories.parentId,
				to: r.categories.id,
				alias: 'tree',
			}),
			children: r.many.categories({ alias: 'tree' }),
			posts: r.many.posts(),
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
			category: r.one.categories({
				from: r.posts.categoryId,
				to: r.categories.id,
			}),
			comments: r.many.comments(),
			postTags: r.many.postTags(),
			tags: r.many.tags({
				from: r.posts.id.through(r.postTags.postId),
				to: r.tags.id.through(r.postTags.tagId),
			}),
			firstTag: r.one.tags({
				from: r.posts.id.through(r.postTags.postId),
				to: r.tags.id.through(r.postTags.tagId),
			}),
		},
		comments: {
			author: r.one.users({
				from: r.comments.authorId,
				to: r.users.id,
				alias: 'commentAuthor',
				optional: false,
			}),
			post: r.one.posts({
				from: r.comments.postId,
				to: r.posts.id,
				optional: false,
			}),
		},
		follows: {
			follower: r.one.users({
				from: r.follows.followerId,
				to: r.users.id,
			}),
			following: r.one.users({
				from: r.follows.followingId,
				to: r.users.id,
			}),
		},
		groups: {
			memberships: r.many.memberships(),
			users: r.many.users({
				from: r.groups.id.through(r.memberships.groupId),
				to: r.users.id.through(r.memberships.userId),
			}),
		},
		memberships: {
			user: r.one.users({
				from: r.memberships.userId,
				to: r.users.id,
			}),
			group: r.one.groups({
				from: r.memberships.groupId,
				to: r.groups.id,
			}),
		},
		tags: {
			postTags: r.many.postTags(),
			posts: r.many.posts({
				from: r.tags.id.through(r.postTags.tagId),
				to: r.posts.id.through(r.postTags.postId),
			}),
		},
		postTags: {
			post: r.one.posts({ from: r.postTags.postId, to: r.posts.id }),
			tag: r.one.tags({ from: r.postTags.tagId, to: r.tags.id }),
		},
	}));

	return { relations, schema };
};

export type SqliteMatrix = ReturnType<typeof createSqliteSchema>;
export type MatrixSchema = SqliteMatrix['schema'];
export type MatrixRelations = SqliteMatrix['relations'];

export const TABLES = [
	'users',
	'profiles',
	'categories',
	'posts',
	'comments',
	'follows',
	'groups',
	'memberships',
	'tags',
	'post_tags',
] as const;

export const sqliteDdl = (p: string) => [
	`CREATE TABLE ${p}users (
		id INTEGER PRIMARY KEY NOT NULL,
		email TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		age INTEGER NOT NULL,
		active INTEGER NOT NULL,
		created_at INTEGER NOT NULL,
		nickname TEXT
	)`,
	`CREATE TABLE ${p}profiles (
		id INTEGER PRIMARY KEY NOT NULL,
		user_id INTEGER UNIQUE REFERENCES ${p}users(id),
		bio TEXT NOT NULL
	)`,
	`CREATE TABLE ${p}categories (
		id INTEGER PRIMARY KEY NOT NULL,
		name TEXT NOT NULL,
		parent_id INTEGER REFERENCES ${p}categories(id)
	)`,
	`CREATE TABLE ${p}posts (
		id INTEGER PRIMARY KEY NOT NULL,
		author_id INTEGER NOT NULL REFERENCES ${p}users(id),
		editor_id INTEGER REFERENCES ${p}users(id),
		category_id INTEGER REFERENCES ${p}categories(id),
		title TEXT NOT NULL,
		score INTEGER NOT NULL,
		published INTEGER NOT NULL
	)`,
	`CREATE TABLE ${p}comments (
		id INTEGER PRIMARY KEY NOT NULL,
		post_id INTEGER NOT NULL REFERENCES ${p}posts(id),
		author_id INTEGER NOT NULL REFERENCES ${p}users(id),
		body TEXT NOT NULL,
		likes INTEGER NOT NULL
	)`,
	`CREATE TABLE ${p}follows (
		follower_id INTEGER NOT NULL REFERENCES ${p}users(id),
		following_id INTEGER NOT NULL REFERENCES ${p}users(id),
		PRIMARY KEY (follower_id, following_id)
	)`,
	`CREATE TABLE ${p}groups (
		id INTEGER PRIMARY KEY NOT NULL,
		name TEXT NOT NULL UNIQUE
	)`,
	`CREATE TABLE ${p}memberships (
		id INTEGER PRIMARY KEY NOT NULL,
		user_id INTEGER NOT NULL REFERENCES ${p}users(id),
		group_id INTEGER NOT NULL REFERENCES ${p}groups(id),
		role TEXT NOT NULL DEFAULT 'member',
		UNIQUE (user_id, group_id)
	)`,
	`CREATE TABLE ${p}tags (
		id INTEGER PRIMARY KEY NOT NULL,
		name TEXT NOT NULL UNIQUE
	)`,
	`CREATE TABLE ${p}post_tags (
		post_id INTEGER NOT NULL REFERENCES ${p}posts(id),
		tag_id INTEGER NOT NULL REFERENCES ${p}tags(id),
		PRIMARY KEY (post_id, tag_id)
	)`,
];

export const pgDdl = (p: string) => [
	`CREATE TABLE ${p}users (
		id integer PRIMARY KEY,
		email text NOT NULL UNIQUE,
		name text NOT NULL,
		age integer NOT NULL,
		active boolean NOT NULL,
		created_at timestamptz NOT NULL,
		nickname text
	)`,
	`CREATE TABLE ${p}profiles (
		id integer PRIMARY KEY,
		user_id integer UNIQUE REFERENCES ${p}users(id),
		bio text NOT NULL
	)`,
	`CREATE TABLE ${p}categories (
		id integer PRIMARY KEY,
		name text NOT NULL,
		parent_id integer REFERENCES ${p}categories(id)
	)`,
	`CREATE TABLE ${p}posts (
		id integer PRIMARY KEY,
		author_id integer NOT NULL REFERENCES ${p}users(id),
		editor_id integer REFERENCES ${p}users(id),
		category_id integer REFERENCES ${p}categories(id),
		title text NOT NULL,
		score integer NOT NULL,
		published boolean NOT NULL
	)`,
	`CREATE TABLE ${p}comments (
		id integer PRIMARY KEY,
		post_id integer NOT NULL REFERENCES ${p}posts(id),
		author_id integer NOT NULL REFERENCES ${p}users(id),
		body text NOT NULL,
		likes integer NOT NULL
	)`,
	`CREATE TABLE ${p}follows (
		follower_id integer NOT NULL REFERENCES ${p}users(id),
		following_id integer NOT NULL REFERENCES ${p}users(id),
		PRIMARY KEY (follower_id, following_id)
	)`,
	`CREATE TABLE ${p}groups (
		id integer PRIMARY KEY,
		name text NOT NULL UNIQUE
	)`,
	`CREATE TABLE ${p}memberships (
		id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
		user_id integer NOT NULL REFERENCES ${p}users(id),
		group_id integer NOT NULL REFERENCES ${p}groups(id),
		role text NOT NULL DEFAULT 'member',
		UNIQUE (user_id, group_id)
	)`,
	`CREATE TABLE ${p}tags (
		id integer PRIMARY KEY,
		name text NOT NULL UNIQUE
	)`,
	`CREATE TABLE ${p}post_tags (
		post_id integer NOT NULL REFERENCES ${p}posts(id),
		tag_id integer NOT NULL REFERENCES ${p}tags(id),
		PRIMARY KEY (post_id, tag_id)
	)`,
];

// Deterministic seed. Expectations in cases.ts are derived from these arrays,
// never from the library under test.
export const USER_COUNT = 120;
export const POST_AUTHOR_COUNT = 100;
export const POSTS_PER_AUTHOR = 3;
export const FREE_PROFILE_IDS = [1001, 1002, 1003];

const DAY = 86_400_000;
const EPOCH = Date.UTC(2024, 0, 1);

export type SeedUser = {
	id: number;
	email: string;
	name: string;
	age: number;
	active: boolean;
	createdAt: Date;
	nickname: string | null;
};

const buildSeed = () => {
	const users: SeedUser[] = [];
	for (let id = 1; id <= USER_COUNT; id += 1)
		users.push({
			id,
			email: `user${id}@matrix.test`,
			name: `User ${String(id).padStart(3, '0')}`,
			age: 18 + ((id * 7) % 50),
			active: id % 3 !== 0,
			createdAt: new Date(EPOCH + id * DAY),
			nickname: id % 4 === 0 ? null : `nick${id}`,
		});

	const profiles: { id: number; userId: number | null; bio: string }[] = [];
	for (const user of users)
		if (user.id % 2 === 1)
			profiles.push({
				id: user.id,
				userId: user.id,
				bio: `Bio ${user.id}`,
			});
	for (const id of FREE_PROFILE_IDS)
		profiles.push({ id, userId: null, bio: `Free ${id}` });

	const categories: { id: number; name: string; parentId: number | null }[] =
		[];
	for (let id = 1; id <= 10; id += 1)
		categories.push({
			id,
			name: `Cat ${id}`,
			parentId: id <= 3 ? null : id === 10 ? 4 : ((id - 4) % 3) + 1,
		});

	const posts: {
		id: number;
		authorId: number;
		editorId: number | null;
		categoryId: number | null;
		title: string;
		score: number;
		published: boolean;
	}[] = [];
	for (let author = 1; author <= POST_AUTHOR_COUNT; author += 1)
		for (let k = 0; k < POSTS_PER_AUTHOR; k += 1) {
			const id = (author - 1) * POSTS_PER_AUTHOR + k + 1;
			posts.push({
				id,
				authorId: author,
				editorId: k === 0 ? null : ((author + k) % USER_COUNT) + 1,
				categoryId: id % 11 === 0 ? null : ((id - 1) % 10) + 1,
				title: `Post ${id}`,
				score: (id * 37) % 100,
				published: id % 4 !== 0,
			});
		}

	const comments: {
		id: number;
		postId: number;
		authorId: number;
		body: string;
		likes: number;
	}[] = [];
	for (const post of posts) {
		if (post.id % 2 === 0) continue;
		for (let j = 0; j < 2; j += 1) {
			const id = comments.length + 1;
			comments.push({
				id,
				postId: post.id,
				authorId: ((post.id * 5 + j) % USER_COUNT) + 1,
				body: `Comment ${id}`,
				likes: (id * 11) % 20,
			});
		}
	}

	const follows: { followerId: number; followingId: number }[] = [];
	for (let user = 1; user <= 60; user += 1) {
		follows.push({
			followerId: user,
			followingId: (user % USER_COUNT) + 1,
		});
		follows.push({
			followerId: user,
			followingId: ((user + 10) % USER_COUNT) + 1,
		});
	}

	const groups: { id: number; name: string }[] = [];
	for (let id = 1; id <= 8; id += 1) groups.push({ id, name: `Group ${id}` });

	// Inserted without ids so identity columns stay usable on PostgreSQL;
	// both dialects assign 1..n in insertion order.
	const memberships: { userId: number; groupId: number; role: string }[] = [];
	for (let user = 1; user <= POST_AUTHOR_COUNT; user += 1) {
		memberships.push({
			userId: user,
			groupId: (user % 8) + 1,
			role: user % 10 === 0 ? 'admin' : 'member',
		});
		memberships.push({
			userId: user,
			groupId: ((user + 3) % 8) + 1,
			role: 'member',
		});
	}

	const tags: { id: number; name: string }[] = [];
	for (let id = 1; id <= 12; id += 1) tags.push({ id, name: `tag-${id}` });

	const postTags: { postId: number; tagId: number }[] = [];
	for (const post of posts) {
		if (post.id % 3 === 0) continue;
		postTags.push({ postId: post.id, tagId: (post.id % 12) + 1 });
		postTags.push({ postId: post.id, tagId: ((post.id + 5) % 12) + 1 });
	}

	return {
		categories,
		comments,
		follows,
		groups,
		memberships,
		postTags,
		posts,
		profiles,
		tags,
		users,
	};
};

export const SEED = buildSeed();
export type Seed = typeof SEED;

// Parent tables first; reverse for deletes.
export const SEED_ORDER = [
	'users',
	'profiles',
	'categories',
	'posts',
	'comments',
	'follows',
	'groups',
	'memberships',
	'tags',
	'postTags',
] as const;

type Inserter = {
	insert(table: never): { values(rows: never): PromiseLike<unknown> };
};

export const seedDatabase = async (
	raw: unknown,
	schema: Record<(typeof SEED_ORDER)[number], unknown>,
) => {
	const db = raw as Inserter;
	for (const key of SEED_ORDER) {
		const rows = SEED[key] as unknown[];
		for (let index = 0; index < rows.length; index += 200)
			await db
				.insert(schema[key] as never)
				.values(rows.slice(index, index + 200) as never);
	}
};
