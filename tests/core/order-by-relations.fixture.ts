import { Database } from 'bun:sqlite';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';

const authors = sqliteTable('sort_authors', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const profiles = sqliteTable('sort_profiles', {
	id: integer('id').primaryKey(),
	authorId: integer('author_id').notNull(),
	bio: text('bio'),
});

const posts = sqliteTable('sort_posts', {
	id: integer('id').primaryKey(),
	authorId: integer('author_id'),
	title: text('title').notNull(),
});

const tags = sqliteTable('sort_tags', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const postTags = sqliteTable('sort_post_tags', {
	postId: integer('post_id').notNull(),
	tagId: integer('tag_id').notNull(),
});

const categories = sqliteTable('sort_categories', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	parentId: integer('parent_id'),
});

const schema = { authors, categories, posts, postTags, profiles, tags };

const relations = defineRelations(schema, (r) => ({
	authors: {
		posts: r.many.posts(),
		profile: r.one.profiles({
			from: r.authors.id,
			to: r.profiles.authorId,
		}),
	},
	categories: {
		children: r.many.categories(),
		parent: r.one.categories({
			from: r.categories.parentId,
			to: r.categories.id,
		}),
	},
	posts: {
		author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }),
		tags: r.many.tags({
			from: r.posts.id.through(r.postTags.postId),
			to: r.tags.id.through(r.postTags.tagId),
		}),
	},
	profiles: {
		author: r.one.authors({
			from: r.profiles.authorId,
			to: r.authors.id,
		}),
	},
	tags: {
		posts: r.many.posts({
			from: r.tags.id.through(r.postTags.tagId),
			to: r.posts.id.through(r.postTags.postId),
		}),
	},
}));

export const createDb = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
CREATE TABLE sort_authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE sort_profiles (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, bio TEXT);
CREATE TABLE sort_posts (id INTEGER PRIMARY KEY, author_id INTEGER, title TEXT NOT NULL);
CREATE TABLE sort_tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE sort_post_tags (post_id INTEGER NOT NULL, tag_id INTEGER NOT NULL);
CREATE TABLE sort_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER);
INSERT INTO sort_authors VALUES (1, 'Carol'), (2, 'Alice'), (3, 'Bob'), (4, 'Dave');
INSERT INTO sort_profiles VALUES (1, 1, 'zeta'), (2, 2, NULL), (3, 3, 'alpha');
INSERT INTO sort_posts VALUES (1, 1, 'p1'), (2, 2, 'p2'), (3, 3, 'p3'), (4, NULL, 'p4'), (5, 2, 'p5');
INSERT INTO sort_tags VALUES (1, 'ts'), (2, 'db'), (3, 'misc');
INSERT INTO sort_post_tags VALUES (1, 1), (1, 2), (1, 3), (3, 1), (5, 1), (5, 2);
INSERT INTO sort_categories VALUES (1, 'zoo', NULL), (2, 'apple', NULL), (3, 'x', 1), (4, 'y', 2), (5, 'z', NULL), (6, 'w', 3), (7, 'v', 4);
`);
	return better(drizzle({ client: sqlite, relations }));
};
