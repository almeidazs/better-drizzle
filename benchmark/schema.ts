import { relations } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	age: integer('age').notNull(),
	active: integer('active', { mode: 'boolean' }).notNull(),
});

export const posts = sqliteTable('posts', {
	id: integer('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	title: text('title').notNull(),
	body: text('body').notNull(),
	score: integer('score').notNull(),
	published: integer('published', { mode: 'boolean' }).notNull(),
});

export const comments = sqliteTable('comments', {
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

export const benchWrites = sqliteTable('bench_writes', {
	id: integer('id').primaryKey(),
	token: text('token').notNull().unique(),
	value: integer('value').notNull(),
	payload: text('payload').notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
	posts: many(posts),
	comments: many(comments),
}));

export const postsRelations = relations(posts, ({ many, one }) => ({
	author: one(users, {
		fields: [posts.userId],
		references: [users.id],
	}),
	comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
	author: one(users, {
		fields: [comments.authorId],
		references: [users.id],
	}),
	post: one(posts, {
		fields: [comments.postId],
		references: [posts.id],
	}),
}));

export const schema = {
	benchWrites,
	comments,
	commentsRelations,
	posts,
	postsRelations,
	users,
	usersRelations,
};

export const createTablesSql = `
CREATE TABLE users (
	id INTEGER PRIMARY KEY NOT NULL,
	email TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	age INTEGER NOT NULL,
	active INTEGER NOT NULL
);

CREATE TABLE posts (
	id INTEGER PRIMARY KEY NOT NULL,
	user_id INTEGER NOT NULL REFERENCES users(id),
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	score INTEGER NOT NULL,
	published INTEGER NOT NULL
);

CREATE TABLE comments (
	id INTEGER PRIMARY KEY NOT NULL,
	post_id INTEGER NOT NULL REFERENCES posts(id),
	author_id INTEGER NOT NULL REFERENCES users(id),
	body TEXT NOT NULL,
	likes INTEGER NOT NULL
);

CREATE TABLE bench_writes (
	id INTEGER PRIMARY KEY NOT NULL,
	token TEXT NOT NULL UNIQUE,
	value INTEGER NOT NULL,
	payload TEXT NOT NULL
);
`;

export type BenchmarkSchema = typeof schema;
