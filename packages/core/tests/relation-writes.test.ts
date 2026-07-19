import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { relations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core';

import { better, definePlugin } from '../src';
import { createTestContext, type TestContext } from './setup';

describe('direct relation writes', () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.close();
	});

	test('create connects a required to-one relation', async () => {
		const post = await ctx.better.posts.create({
			data: {
				author: { connect: { email: 'bob@example.com' } },
				body: 'Connected body',
				id: 99,
				published: true,
				score: 1,
				title: 'Connected post',
			},
			include: { author: true },
		});

		expect(post.userId).toBe(2);
		expect(post.author.name).toBe('Bob');
	});

	test('update reconnects a to-one relation', async () => {
		const post = await ctx.better.posts.update({
			data: { author: { connect: { id: 2 } } },
			include: { author: true },
			where: { id: 1 },
		});

		expect(post?.userId).toBe(2);
		expect(post?.author.name).toBe('Bob');
	});

	test('create connects existing children through a to-many relation', async () => {
		const user = await ctx.better.users.create({
			data: {
				active: true,
				age: 29,
				email: 'nested@example.com',
				id: 99,
				name: 'Nested',
				posts: { connect: [{ id: 3 }] },
			},
			include: { posts: true },
		});

		expect(user.posts.map((post) => post.id)).toEqual([3]);
	});

	test('required disconnect rolls back scalar changes', async () => {
		await expect(
			ctx.better.users.update({
				data: {
					name: 'Should rollback',
					posts: { disconnect: { id: 1 } },
				},
				where: { id: 1 },
			}),
		).rejects.toThrow('Cannot disconnect required relation');

		const user = await ctx.better.users.findFirst({ where: { id: 1 } });
		expect(user?.name).toBe('Alice');
	});

	test('upsert applies relation commands on create and update branches', async () => {
		const created = await ctx.better.posts.upsert({
			create: {
				author: { connect: { id: 1 } },
				body: 'Created',
				id: 98,
				published: true,
				score: 1,
				title: 'Created',
			},
			update: { author: { connect: { id: 2 } } },
			where: { id: 98 },
		});
		expect(created.userId).toBe(1);

		const updated = await ctx.better.posts.upsert({
			create: {
				author: { connect: { id: 1 } },
				body: 'Unused',
				id: 98,
				published: true,
				score: 1,
				title: 'Unused',
			},
			update: { author: { connect: { id: 2 } } },
			where: { id: 98 },
		});
		expect(updated.userId).toBe(2);
	});

	test('preserves plugin state across implicit transactions', async () => {
		const client = better(ctx.raw, {
			plugins: [
				definePlugin({
					id: 'force-name',
					transform(operation) {
						if (operation.kind !== 'update') return operation;
						operation.data = {
							...operation.data,
							name: 'Changed by plugin',
						};
						return operation;
					},
				}),
			],
			schema: ctx.schema,
		});

		await client.users.$withoutPlugins().update({
			data: {
				name: 'Plugin bypassed',
				posts: { connect: { id: 3 } },
			},
			where: { id: 5 },
		});

		const user = await client.users.findFirst({ where: { id: 5 } });
		expect(user?.name).toBe('Plugin bypassed');
	});
});

const users = sqliteTable('m2m_users', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const groups = sqliteTable('m2m_groups', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const userGroups = sqliteTable(
	'm2m_user_groups',
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

const usersRelations = relations(users, ({ many }) => ({
	userGroups: many(userGroups),
}));

const groupsRelations = relations(groups, ({ many }) => ({
	userGroups: many(userGroups),
}));

const userGroupsRelations = relations(userGroups, ({ one }) => ({
	group: one(groups, {
		fields: [userGroups.groupId],
		references: [groups.id],
	}),
	user: one(users, {
		fields: [userGroups.userId],
		references: [users.id],
	}),
}));

const m2mSchema = {
	groups,
	groupsRelations,
	userGroups,
	userGroupsRelations,
	users,
	usersRelations,
};

describe('inferred many-to-many relations', () => {
	test('includes, connects, disconnects, and sets targets', async () => {
		const sqlite = new Database(':memory:');
		sqlite.exec(`
			PRAGMA foreign_keys = ON;
			CREATE TABLE m2m_users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
			CREATE TABLE m2m_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
			CREATE TABLE m2m_user_groups (
				user_id INTEGER NOT NULL REFERENCES m2m_users(id),
				group_id INTEGER NOT NULL REFERENCES m2m_groups(id),
				PRIMARY KEY (user_id, group_id)
			);
			INSERT INTO m2m_users VALUES (1, 'Alice');
			INSERT INTO m2m_groups VALUES (1, 'Admin'), (2, 'Editor');
		`);
		const raw = drizzle(sqlite, { schema: m2mSchema });
		const inferredClient = better(raw, { schema: m2mSchema });
		const client = better(raw, {
			relations: {
				inferManyToMany: false,
				manyToMany: [
					{
						left: { relation: 'user' },
						right: { relation: 'group' },
						through: 'userGroups',
					},
				],
			},
			schema: m2mSchema,
		});

		await client.users.update({
			data: { groups: { connect: [{ id: 1 }, { id: 2 }] } },
			where: { id: 1 },
		});
		let user = await client.users.findFirst({
			include: { groups: { orderBy: { id: 'asc' } } },
			where: { id: 1 },
		});
		expect(user?.groups.map((group) => group.id)).toEqual([1, 2]);
		const inferred = await inferredClient.users.findFirst({
			include: { groups: { orderBy: { id: 'asc' } } },
			where: { id: 1 },
		});
		expect(inferred?.groups.map((group) => group.id)).toEqual([1, 2]);
		const page = await client.users.findFirst({
			include: {
				groups: { orderBy: { id: 'asc' }, skip: 1, take: 1 },
			},
			where: { id: 1 },
		});
		expect(page?.groups.map((group) => group.id)).toEqual([2]);

		await client.users.update({
			data: { groups: { disconnect: { id: 1 } } },
			where: { id: 1 },
		});
		user = await client.users.findFirst({
			include: { groups: true },
			where: { id: 1 },
		});
		expect(user?.groups.map((group) => group.id)).toEqual([2]);

		await client.users.update({
			data: { groups: { set: [{ id: 1 }] } },
			where: { id: 1 },
		});
		user = await client.users.findFirst({
			include: { groups: true },
			where: { id: 1 },
		});
		expect(user?.groups.map((group) => group.id)).toEqual([1]);
		sqlite.close();
	});
});
