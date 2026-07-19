import { Database } from 'bun:sqlite';
import { relations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core';

import { better } from '../../src';

export const USER_COUNT = 300;
export const POSTS_PER_USER = 4;
export const COMMENTS_PER_POST = 2;
export const GROUP_COUNT = 15;
export const ENTRY_COUNT = 1_000;

export const users = sqliteTable('mass_users', {
	active: integer('active', { mode: 'boolean' }).notNull(),
	age: integer('age').notNull(),
	email: text('email').notNull().unique(),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

export const posts = sqliteTable('mass_posts', {
	body: text('body').notNull(),
	id: integer('id').primaryKey(),
	published: integer('published', { mode: 'boolean' }).notNull(),
	score: integer('score').notNull(),
	title: text('title').notNull(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
});

export const comments = sqliteTable('mass_comments', {
	authorId: integer('author_id')
		.notNull()
		.references(() => users.id),
	body: text('body').notNull(),
	id: integer('id').primaryKey(),
	likes: integer('likes').notNull(),
	postId: integer('post_id')
		.notNull()
		.references(() => posts.id),
});

export const profiles = sqliteTable('mass_profiles', {
	bio: text('bio').notNull(),
	id: integer('id').primaryKey(),
	userId: integer('user_id')
		.unique()
		.references(() => users.id),
});

export const groups = sqliteTable('mass_groups', {
	id: integer('id').primaryKey(),
	name: text('name').notNull().unique(),
});

export const userGroups = sqliteTable(
	'mass_user_groups',
	{
		groupId: integer('group_id')
			.notNull()
			.references(() => groups.id),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
	},
	(table) => [primaryKey({ columns: [table.userId, table.groupId] })],
);

export const entries = sqliteTable('mass_entries', {
	id: integer('id').primaryKey(),
	payload: text('payload').notNull(),
	token: text('token').notNull().unique(),
	value: integer('value').notNull(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
	comments: many(comments),
	posts: many(posts),
	profile: one(profiles),
	userGroups: many(userGroups),
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

export const profilesRelations = relations(profiles, ({ one }) => ({
	user: one(users, {
		fields: [profiles.userId],
		references: [users.id],
	}),
}));

export const groupsRelations = relations(groups, ({ many }) => ({
	userGroups: many(userGroups),
}));

export const userGroupsRelations = relations(userGroups, ({ one }) => ({
	group: one(groups, {
		fields: [userGroups.groupId],
		references: [groups.id],
	}),
	user: one(users, {
		fields: [userGroups.userId],
		references: [users.id],
	}),
}));

export const schema = {
	comments,
	commentsRelations,
	entries,
	groups,
	groupsRelations,
	posts,
	postsRelations,
	profiles,
	profilesRelations,
	userGroups,
	userGroupsRelations,
	users,
	usersRelations,
};

const createSql = `
CREATE TABLE mass_users (
	id INTEGER PRIMARY KEY NOT NULL,
	email TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	age INTEGER NOT NULL,
	active INTEGER NOT NULL
);
CREATE TABLE mass_posts (
	id INTEGER PRIMARY KEY NOT NULL,
	user_id INTEGER NOT NULL REFERENCES mass_users(id),
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	score INTEGER NOT NULL,
	published INTEGER NOT NULL
);
CREATE TABLE mass_comments (
	id INTEGER PRIMARY KEY NOT NULL,
	post_id INTEGER NOT NULL REFERENCES mass_posts(id),
	author_id INTEGER NOT NULL REFERENCES mass_users(id),
	body TEXT NOT NULL,
	likes INTEGER NOT NULL
);
CREATE TABLE mass_profiles (
	id INTEGER PRIMARY KEY NOT NULL,
	user_id INTEGER UNIQUE REFERENCES mass_users(id),
	bio TEXT NOT NULL
);
CREATE TABLE mass_groups (
	id INTEGER PRIMARY KEY NOT NULL,
	name TEXT NOT NULL UNIQUE
);
CREATE TABLE mass_user_groups (
	user_id INTEGER NOT NULL REFERENCES mass_users(id),
	group_id INTEGER NOT NULL REFERENCES mass_groups(id),
	PRIMARY KEY (user_id, group_id)
);
CREATE TABLE mass_entries (
	id INTEGER PRIMARY KEY NOT NULL,
	token TEXT NOT NULL UNIQUE,
	value INTEGER NOT NULL,
	payload TEXT NOT NULL
);
CREATE INDEX mass_posts_user_idx ON mass_posts(user_id);
CREATE INDEX mass_comments_post_idx ON mass_comments(post_id);
CREATE INDEX mass_comments_author_idx ON mass_comments(author_id);
CREATE INDEX mass_user_groups_group_idx ON mass_user_groups(group_id);
`;

export const createMassiveContext = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		PRAGMA journal_mode = MEMORY;
		PRAGMA synchronous = OFF;
		PRAGMA temp_store = MEMORY;
		PRAGMA foreign_keys = ON;
		${createSql}
	`);

	const insertUser = sqlite.prepare(
		'INSERT INTO mass_users (id, email, name, age, active) VALUES (?, ?, ?, ?, ?)',
	);
	const insertPost = sqlite.prepare(
		'INSERT INTO mass_posts (id, user_id, title, body, score, published) VALUES (?, ?, ?, ?, ?, ?)',
	);
	const insertComment = sqlite.prepare(
		'INSERT INTO mass_comments (id, post_id, author_id, body, likes) VALUES (?, ?, ?, ?, ?)',
	);
	const insertProfile = sqlite.prepare(
		'INSERT INTO mass_profiles (id, user_id, bio) VALUES (?, ?, ?)',
	);
	const insertGroup = sqlite.prepare(
		'INSERT INTO mass_groups (id, name) VALUES (?, ?)',
	);
	const insertUserGroup = sqlite.prepare(
		'INSERT INTO mass_user_groups (user_id, group_id) VALUES (?, ?)',
	);
	const insertEntry = sqlite.prepare(
		'INSERT INTO mass_entries (id, token, value, payload) VALUES (?, ?, ?, ?)',
	);

	const seed = sqlite.transaction(() => {
		for (let id = 1; id <= USER_COUNT; id += 1) {
			insertUser.run(
				id,
				`user-${id}@example.com`,
				`User ${id}`,
				18 + (id % 63),
				id % 4 !== 0 ? 1 : 0,
			);
			if (id <= USER_COUNT / 2)
				insertProfile.run(id, id, `Profile ${id}`);
		}

		for (let id = 1; id <= GROUP_COUNT; id += 1)
			insertGroup.run(id, `Group ${id}`);

		let postId = 1;
		let commentId = 1;
		for (let userId = 1; userId <= USER_COUNT; userId += 1) {
			for (let index = 0; index < POSTS_PER_USER; index += 1) {
				insertPost.run(
					postId,
					userId,
					`Post ${postId}`,
					`Body ${postId}`,
					(postId * 17) % 1_000,
					postId % 3 !== 0 ? 1 : 0,
				);
				for (
					let commentIndex = 0;
					commentIndex < COMMENTS_PER_POST;
					commentIndex += 1
				) {
					insertComment.run(
						commentId,
						postId,
						((userId + commentIndex + 19) % USER_COUNT) + 1,
						`Comment ${commentId}`,
						(commentId * 13) % 250,
					);
					commentId += 1;
				}
				postId += 1;
			}

			for (let offset = 0; offset < 3; offset += 1)
				insertUserGroup.run(
					userId,
					((userId + offset * 5) % GROUP_COUNT) + 1,
				);
		}

		for (let id = 1; id <= ENTRY_COUNT; id += 1)
			insertEntry.run(id, `token-${id}`, id % 1_000, `Payload ${id}`);
	});
	seed();

	const raw = drizzle(sqlite, { schema });
	const client = better(raw, { schema });

	return {
		client,
		close() {
			sqlite.close();
		},
		raw,
		schema,
		sqlite,
	};
};

export type MassiveContext = ReturnType<typeof createMassiveContext>;
