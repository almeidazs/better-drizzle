# Getting started

This page shows the smallest realistic setup and the mental model behind it.

## Install

```bash
npm install better-drizzle drizzle-orm
```

## A small schema

```ts
import { relations } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const posts = sqliteTable('posts', {
	id: integer('id').primaryKey(),
	authorId: integer('author_id')
		.notNull()
		.references(() => users.id),
	title: text('title').notNull(),
	published: integer('published', { mode: 'boolean' }).notNull().default(false),
});

export const usersRelations = relations(users, ({ many }) => ({
	posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
	author: one(users, {
		fields: [posts.authorId],
		references: [users.id],
	}),
}));

export const schema = {
	posts,
	postsRelations,
	users,
	usersRelations,
};
```

## Create the Drizzle client, then the Better client

```ts
import Database from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { better } from 'better-drizzle';
import { schema } from './schema';

const sqlite = new Database('app.db');
const db = drizzle(sqlite, { schema });

export const client = better(db, { schema });
```

## What `better(...)` gives you

- one delegate per table: `client.users`, `client.posts`
- a dynamic lookup API: `client.repository(name)`
- typed read helpers like `findMany`, `findFirst`, `findUnique`, `count`, `exists`
- typed write helpers like `create`, `update`, `updateEach`, `delete`, `upsert`, `upsertMany`
- pagination, raw SQL, hooks, and plugin composition on the same client

## First queries

```ts
const users = await client.users.findMany({
	orderBy: [{ id: 'asc' }],
	take: 20,
});

const firstUser = await client.users.findFirst({
	where: { id: 1 },
});

const sameRepository = client.repository('users');
const byDbTableName = client.repository('users');
```

## What stays explicit

`better-drizzle` does not try to hide your schema or replace Drizzle.
You still:

- define tables and relations in Drizzle
- choose the database driver yourself
- decide when to use raw SQL
- decide how much abstraction your service layer wants

## Recommended next step

Continue with [`reads-and-filters.md`](./reads-and-filters.md) to understand the read API and filter model before moving to transactions and plugins.
