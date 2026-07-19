import { relations } from 'drizzle-orm';
import { boolean, int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import { better } from '../src';

// A live-MySQL mirror of ./setup.ts. Same tables, same relations, same seed, so
// the identity assertions in where.mysql.test.ts read exactly like the SQLite
// ones. Gated on MYSQL_URL: with no server the test file skips, matching how the
// repo already treats its Postgres container (development / integration only).

const users = mysqlTable('test_users', {
	id: int('id').primaryKey(),
	email: varchar('email', { length: 255 }).notNull().unique(),
	name: varchar('name', { length: 255 }).notNull(),
	age: int('age').notNull(),
	active: boolean('active').notNull(),
});

const posts = mysqlTable('test_posts', {
	id: int('id').primaryKey(),
	userId: int('user_id')
		.notNull()
		.references(() => users.id),
	title: varchar('title', { length: 255 }).notNull(),
	body: varchar('body', { length: 255 }).notNull(),
	score: int('score').notNull(),
	published: boolean('published').notNull(),
});

// The mapped column that exposed the bug: JS name authorId, database name
// author_id. getTableColumns() keys by authorId, reference.name is author_id.
const comments = mysqlTable('test_comments', {
	id: int('id').primaryKey(),
	postId: int('post_id')
		.notNull()
		.references(() => posts.id),
	authorId: int('author_id')
		.notNull()
		.references(() => users.id),
	body: varchar('body', { length: 255 }).notNull(),
	likes: int('likes').notNull(),
});

const memberships = mysqlTable('test_memberships', {
	id: int('id').primaryKey(),
	userId: int('user_id')
		.notNull()
		.references(() => users.id),
	label: varchar('label', { length: 255 }).notNull(),
	note: varchar('note', { length: 255 }).notNull(),
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

// InnoDB rejects DROP/CREATE against a foreign key, so both lists run with
// FK checks off, in no particular order.
const dropTablesSql = [
	'DROP TABLE IF EXISTS test_memberships',
	'DROP TABLE IF EXISTS test_comments',
	'DROP TABLE IF EXISTS test_posts',
	'DROP TABLE IF EXISTS test_users',
];

const createTablesSql = [
	`CREATE TABLE test_users (
		id INT PRIMARY KEY NOT NULL,
		email VARCHAR(255) NOT NULL UNIQUE,
		name VARCHAR(255) NOT NULL,
		age INT NOT NULL,
		active TINYINT NOT NULL
	)`,
	`CREATE TABLE test_posts (
		id INT PRIMARY KEY NOT NULL,
		user_id INT NOT NULL REFERENCES test_users(id),
		title VARCHAR(255) NOT NULL,
		body VARCHAR(255) NOT NULL,
		score INT NOT NULL,
		published TINYINT NOT NULL
	)`,
	`CREATE TABLE test_comments (
		id INT PRIMARY KEY NOT NULL,
		post_id INT NOT NULL REFERENCES test_posts(id),
		author_id INT NOT NULL REFERENCES test_users(id),
		body VARCHAR(255) NOT NULL,
		likes INT NOT NULL
	)`,
	`CREATE TABLE test_memberships (
		id INT PRIMARY KEY NOT NULL,
		user_id INT NOT NULL REFERENCES test_users(id),
		label VARCHAR(255) NOT NULL,
		note VARCHAR(255) NOT NULL,
		UNIQUE (user_id, label)
	)`,
];

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

const seedSql = async (conn: mysql.Connection) => {
	for (const u of SEED_USERS)
		await conn.query(
			'INSERT INTO test_users (id, email, name, age, active) VALUES (?, ?, ?, ?, ?)',
			[u.id, u.email, u.name, u.age, u.active ? 1 : 0],
		);
	for (const p of SEED_POSTS)
		await conn.query(
			'INSERT INTO test_posts (id, user_id, title, body, score, published) VALUES (?, ?, ?, ?, ?, ?)',
			[p.id, p.userId, p.title, p.body, p.score, p.published ? 1 : 0],
		);
	for (const c of SEED_COMMENTS)
		await conn.query(
			'INSERT INTO test_comments (id, post_id, author_id, body, likes) VALUES (?, ?, ?, ?, ?)',
			[c.id, c.postId, c.authorId, c.body, c.likes],
		);
	for (const m of SEED_MEMBERSHIPS)
		await conn.query(
			'INSERT INTO test_memberships (id, user_id, label, note) VALUES (?, ?, ?, ?)',
			[m.id, m.userId, m.label, m.note],
		);
};

export const createMysqlTestContext = async (url: string) => {
	const conn = await mysql.createConnection(url);

	await conn.query('SET FOREIGN_KEY_CHECKS = 0');
	for (const sql of dropTablesSql) await conn.query(sql);
	for (const sql of createTablesSql) await conn.query(sql);
	await conn.query('SET FOREIGN_KEY_CHECKS = 1');
	await seedSql(conn);

	const raw = drizzle(conn, { schema, mode: 'default' });
	const client = better(raw, { schema });

	return {
		better: client,
		raw,
		schema,
		seed: {
			comments: SEED_COMMENTS,
			posts: SEED_POSTS,
			users: SEED_USERS,
			memberships: SEED_MEMBERSHIPS,
		},
		async close() {
			await conn.end();
		},
	};
};

export type MysqlTestContext = Awaited<
	ReturnType<typeof createMysqlTestContext>
>;
