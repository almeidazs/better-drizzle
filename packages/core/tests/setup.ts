import { Database } from 'bun:sqlite';
import { relations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../src';

const users = sqliteTable('test_users', {
	id: integer('id').primaryKey(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	age: integer('age').notNull(),
	active: integer('active', { mode: 'boolean' }).notNull(),
});

const posts = sqliteTable('test_posts', {
	id: integer('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	title: text('title').notNull(),
	body: text('body').notNull(),
	score: integer('score').notNull(),
	published: integer('published', { mode: 'boolean' }).notNull(),
});

const comments = sqliteTable('test_comments', {
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

const memberships = sqliteTable('test_memberships', {
	id: integer('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	label: text('label').notNull(),
	note: text('note').notNull(),
});

const usersRelations = relations(users, ({ many }) => ({
	posts: many(posts),
	comments: many(comments),
}));

const postsRelations = relations(posts, ({ many, one }) => ({
	author: one(users, {
		fields: [posts.userId],
		references: [users.id],
	}),
	comments: many(comments),
}));

const commentsRelations = relations(comments, ({ one }) => ({
	author: one(users, {
		fields: [comments.authorId],
		references: [users.id],
	}),
	post: one(posts, {
		fields: [comments.postId],
		references: [posts.id],
	}),
}));

const schema = {
	comments,
	commentsRelations,
	memberships,
	posts,
	postsRelations,
	users,
	usersRelations,
};

const createTablesSql = `
CREATE TABLE IF NOT EXISTS test_users (
	id INTEGER PRIMARY KEY NOT NULL,
	email TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	age INTEGER NOT NULL,
	active INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS test_posts (
	id INTEGER PRIMARY KEY NOT NULL,
	user_id INTEGER NOT NULL REFERENCES test_users(id),
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	score INTEGER NOT NULL,
	published INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS test_comments (
	id INTEGER PRIMARY KEY NOT NULL,
	post_id INTEGER NOT NULL REFERENCES test_posts(id),
	author_id INTEGER NOT NULL REFERENCES test_users(id),
	body TEXT NOT NULL,
	likes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS test_memberships (
	id INTEGER PRIMARY KEY NOT NULL,
	user_id INTEGER NOT NULL REFERENCES test_users(id),
	label TEXT NOT NULL,
	note TEXT NOT NULL,
	UNIQUE(user_id, label)
);
`;

const SEED_USERS = [
	{ id: 1, email: 'alice@example.com', name: 'Alice', age: 25, active: true },
	{ id: 2, email: 'bob@example.com', name: 'Bob', age: 30, active: true },
	{
		id: 3,
		email: 'charlie@example.com',
		name: 'Charlie',
		age: 35,
		active: false,
	},
	{ id: 4, email: 'diana@example.com', name: 'Diana', age: 28, active: true },
	{ id: 5, email: 'eve@example.com', name: 'Eve', age: 22, active: false },
];

const SEED_POSTS = [
	{
		id: 1,
		userId: 1,
		title: 'First Post',
		body: 'Body 1',
		score: 10,
		published: true,
	},
	{
		id: 2,
		userId: 1,
		title: 'Second Post',
		body: 'Body 2',
		score: 20,
		published: false,
	},
	{
		id: 3,
		userId: 2,
		title: 'Third Post',
		body: 'Body 3',
		score: 30,
		published: true,
	},
	{
		id: 4,
		userId: 2,
		title: 'Fourth Post',
		body: 'Body 4',
		score: 40,
		published: true,
	},
	{
		id: 5,
		userId: 3,
		title: 'Fifth Post',
		body: 'Body 5',
		score: 50,
		published: false,
	},
	{
		id: 6,
		userId: 4,
		title: 'Sixth Post',
		body: 'Body 6',
		score: 60,
		published: true,
	},
];

const SEED_COMMENTS = [
	{ id: 1, postId: 1, authorId: 2, body: 'Nice post!', likes: 5 },
	{ id: 2, postId: 1, authorId: 3, body: 'Thanks!', likes: 2 },
	{ id: 3, postId: 3, authorId: 1, body: 'Great work', likes: 8 },
	{ id: 4, postId: 4, authorId: 3, body: 'Interesting', likes: 1 },
	{ id: 5, postId: 6, authorId: 1, body: 'Well done', likes: 3 },
];

const SEED_MEMBERSHIPS = [
	{ id: 1, userId: 1, label: 'owner', note: 'Initial owner' },
	{ id: 2, userId: 2, label: 'editor', note: 'Initial editor' },
];

export type TestSchema = typeof schema;

export const createTestContext = () => {
	const sqlite = new Database(':memory:');

	sqlite.exec(`
PRAGMA journal_mode = MEMORY;
PRAGMA synchronous = OFF;
PRAGMA temp_store = MEMORY;
PRAGMA foreign_keys = ON;
${createTablesSql}
`);

	const insertUser = sqlite.prepare(
		'INSERT INTO test_users (id, email, name, age, active) VALUES (?, ?, ?, ?, ?)',
	);
	const insertPost = sqlite.prepare(
		'INSERT INTO test_posts (id, user_id, title, body, score, published) VALUES (?, ?, ?, ?, ?, ?)',
	);
	const insertComment = sqlite.prepare(
		'INSERT INTO test_comments (id, post_id, author_id, body, likes) VALUES (?, ?, ?, ?, ?)',
	);
	const insertMembership = sqlite.prepare(
		'INSERT INTO test_memberships (id, user_id, label, note) VALUES (?, ?, ?, ?)',
	);

	const seed = sqlite.transaction(() => {
		for (const u of SEED_USERS)
			insertUser.run(u.id, u.email, u.name, u.age, u.active ? 1 : 0);
		for (const p of SEED_POSTS)
			insertPost.run(
				p.id,
				p.userId,
				p.title,
				p.body,
				p.score,
				p.published ? 1 : 0,
			);
		for (const c of SEED_COMMENTS)
			insertComment.run(c.id, c.postId, c.authorId, c.body, c.likes);
		for (const membership of SEED_MEMBERSHIPS)
			insertMembership.run(
				membership.id,
				membership.userId,
				membership.label,
				membership.note,
			);
	});

	seed();

	const raw = drizzle(sqlite, { schema });
	const client = better(raw, { schema });

	return {
		better: client,
		raw,
		schema,
		sqlite,
		seed: {
			comments: SEED_COMMENTS,
			posts: SEED_POSTS,
			users: SEED_USERS,
			memberships: SEED_MEMBERSHIPS,
		},
		close() {
			sqlite.close();
		},
		reset() {
			sqlite.exec('DELETE FROM test_memberships');
			sqlite.exec('DELETE FROM test_comments');
			sqlite.exec('DELETE FROM test_posts');
			sqlite.exec('DELETE FROM test_users');
			seed();
		},
	};
};

export type TestContext = ReturnType<typeof createTestContext>;
