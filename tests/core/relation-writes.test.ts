import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core';

import { better, definePlugin } from '../../src';
import { regionPlugin } from './scopes.fixture';
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

	test('ignores relation keys set to undefined', async () => {
		const created = await ctx.better.posts.create({
			data: {
				author: undefined,
				body: 'Body',
				id: 97,
				published: true,
				score: 1,
				title: 'Undefined relation',
				userId: 1,
			},
		});
		expect(created.userId).toBe(1);

		const renamed = await ctx.better.posts.update({
			data: { author: undefined, title: 'Renamed' },
			where: { id: 97 },
		});
		expect(renamed?.title).toBe('Renamed');

		const reconnected = await ctx.better.posts.update({
			data: { author: { connect: { id: 2 } }, comments: undefined },
			where: { id: 97 },
		});
		expect(reconnected?.userId).toBe(2);

		const upserted = await ctx.better.posts.upsert({
			create: {
				author: undefined,
				body: 'Unused',
				id: 97,
				published: true,
				score: 1,
				title: 'Unused',
				userId: 1,
			},
			update: { author: undefined, title: 'Upserted' },
			where: { id: 97 },
		});
		expect(upserted.title).toBe('Upserted');

		await expect(
			ctx.better.posts.update({
				data: { author: null as never },
				where: { id: 97 },
			}),
		).rejects.toThrow('Relation commands must be objects.');
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

const m2mRelations = defineRelations({ groups, userGroups, users }, (r) => ({
	groups: {
		users: r.many.users({
			from: r.groups.id.through(r.userGroups.groupId),
			to: r.users.id.through(r.userGroups.userId),
		}),
	},
	userGroups: {
		group: r.one.groups({ from: r.userGroups.groupId, to: r.groups.id }),
		user: r.one.users({ from: r.userGroups.userId, to: r.users.id }),
	},
	users: {
		groups: r.many.groups({
			from: r.users.id.through(r.userGroups.userId),
			to: r.groups.id.through(r.userGroups.groupId),
		}),
		userGroups: r.many.userGroups(),
	},
}));

describe('many-to-many through relations', () => {
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
		const client = better(
			drizzle({ client: sqlite, relations: m2mRelations }),
		);

		await client.users.update({
			data: { groups: { connect: [{ id: 1 }, { id: 2 }] } },
			where: { id: 1 },
		});
		let user = await client.users.findFirst({
			include: { groups: { orderBy: { id: 'asc' } } },
			where: { id: 1 },
		});
		expect(user?.groups.map((group) => group.id)).toEqual([1, 2]);
		expect(
			await client.users.count({
				where: { groups: { some: { name: 'Editor' } } },
			}),
		).toBe(1);
		expect(
			await client.users.count({
				where: { groups: { none: { name: 'Editor' } } },
			}),
		).toBe(0);
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

test('set disconnects rows when the child primary key has a mapped column name', async () => {
	const parents = sqliteTable('mapped_parents', {
		id: integer('id').primaryKey(),
	});
	const children = sqliteTable('mapped_children', {
		childId: integer('child_id').primaryKey(),
		parentId: integer('parent_id').references(() => parents.id),
	});
	const relations = defineRelations({ children, parents }, (r) => ({
		children: {
			parent: r.one.parents({
				from: r.children.parentId,
				to: r.parents.id,
			}),
		},
		parents: { children: r.many.children() },
	}));
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec(`
			CREATE TABLE mapped_parents (id INTEGER PRIMARY KEY);
			CREATE TABLE mapped_children (child_id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES mapped_parents(id));
			INSERT INTO mapped_parents VALUES (1);
			INSERT INTO mapped_children VALUES (10, 1), (11, 1);
		`);
		const client = better(drizzle({ client: sqlite, relations }));
		await client.parents.update({
			data: { children: { set: [{ childId: 11 }] } },
			where: { id: 1 },
		});
		expect(
			sqlite
				.query(
					'SELECT child_id, parent_id FROM mapped_children ORDER BY child_id',
				)
				.all(),
		).toEqual([
			{ child_id: 10, parent_id: null },
			{ child_id: 11, parent_id: 1 },
		]);
	} finally {
		sqlite.close();
	}
});

const createMappedCompositeContext = () => {
	const parents = sqliteTable('composite_parents', {
		id: integer('id').primaryKey(),
	});
	const children = sqliteTable(
		'composite_children',
		{
			keyA: text('key_a').notNull(),
			keyB: text('key_b').notNull(),
			parentId: integer('parent_id'),
		},
		(table) => [primaryKey({ columns: [table.keyA, table.keyB] })],
	);
	const relations = defineRelations({ children, parents }, (r) => ({
		children: {
			parent: r.one.parents({
				from: r.children.parentId,
				to: r.parents.id,
			}),
		},
		parents: { children: r.many.children() },
	}));
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE composite_parents (id INTEGER PRIMARY KEY);
		CREATE TABLE composite_children (
			key_a TEXT NOT NULL, key_b TEXT NOT NULL, parent_id INTEGER,
			PRIMARY KEY (key_a, key_b)
		);
		INSERT INTO composite_parents VALUES (1);
		INSERT INTO composite_children VALUES
			('a|string:b', 'c', NULL), ('a', 'b|string:c', NULL);
	`);
	return { client: better(drizzle({ client: sqlite, relations })), sqlite };
};

const compositeSelectors = [
	{ keyA: 'a|string:b', keyB: 'c' },
	{ keyA: 'a', keyB: 'b|string:c' },
];

test('connect preserves distinct mapped composite primary keys containing delimiters', async () => {
	const { client, sqlite } = createMappedCompositeContext();
	try {
		await client.parents.update({
			data: { children: { connect: compositeSelectors } },
			where: { id: 1 },
		});
		expect(
			sqlite
				.query(
					'SELECT COUNT(*) AS count FROM composite_children WHERE parent_id = 1',
				)
				.get(),
		).toEqual({ count: 2 });
	} finally {
		sqlite.close();
	}
});

test('set distinguishes mapped composite primary keys containing delimiters', async () => {
	const { client, sqlite } = createMappedCompositeContext();
	try {
		sqlite.exec('UPDATE composite_children SET parent_id = 1');
		await client.parents.update({
			data: { children: { set: [compositeSelectors[1]!] } },
			where: { id: 1 },
		});
		expect(
			sqlite
				.query(
					'SELECT key_a, key_b, parent_id FROM composite_children ORDER BY key_a',
				)
				.all(),
		).toEqual([
			{ key_a: 'a', key_b: 'b|string:c', parent_id: 1 },
			{ key_a: 'a|string:b', key_b: 'c', parent_id: null },
		]);
	} finally {
		sqlite.close();
	}
});

test('to-one connect replaces a mapped primary-key target and deduplicates selectors', async () => {
	const parents = sqliteTable('profile_parents', {
		id: integer('id').primaryKey(),
	});
	const profiles = sqliteTable('mapped_profiles', {
		profileId: integer('profile_id').primaryKey(),
		parentId: integer('parent_id').unique(),
		slug: text('slug').notNull().unique(),
	});
	const relations = defineRelations({ parents, profiles }, (r) => ({
		parents: {
			profile: r.one.profiles({
				from: r.parents.id,
				to: r.profiles.parentId,
			}),
		},
		profiles: {
			parent: r.one.parents({
				from: r.profiles.parentId,
				to: r.parents.id,
			}),
		},
	}));
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec(`
			CREATE TABLE profile_parents (id INTEGER PRIMARY KEY);
			CREATE TABLE mapped_profiles (
				profile_id INTEGER PRIMARY KEY, parent_id INTEGER UNIQUE,
				slug TEXT NOT NULL UNIQUE
			);
			INSERT INTO profile_parents VALUES (1);
			INSERT INTO mapped_profiles VALUES (10, 1, 'old'), (11, NULL, 'new');
		`);
		const client = better(drizzle({ client: sqlite, relations }));
		await client.parents.update({
			data: {
				profile: { connect: [{ profileId: 11 }, { slug: 'new' }] },
			},
			where: { id: 1 },
		});
		expect(
			sqlite
				.query(
					'SELECT profile_id, parent_id FROM mapped_profiles ORDER BY profile_id',
				)
				.all(),
		).toEqual([
			{ profile_id: 10, parent_id: null },
			{ profile_id: 11, parent_id: 1 },
		]);
	} finally {
		sqlite.close();
	}
});

test('includes children for distinct composite parent keys containing delimiters', async () => {
	const parents = sqliteTable(
		'composite_read_parents',
		{ keyA: text('key_a').notNull(), keyB: text('key_b').notNull() },
		(table) => [primaryKey({ columns: [table.keyA, table.keyB] })],
	);
	const children = sqliteTable('composite_read_children', {
		id: integer('id').primaryKey(),
		parentA: text('parent_a').notNull(),
		parentB: text('parent_b').notNull(),
	});
	const relations = defineRelations({ children, parents }, (r) => ({
		parents: {
			children: r.many.children({
				from: [r.parents.keyA, r.parents.keyB],
				to: [r.children.parentA, r.children.parentB],
			}),
		},
	}));
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec(`
			CREATE TABLE composite_read_parents (
				key_a TEXT NOT NULL, key_b TEXT NOT NULL, PRIMARY KEY (key_a, key_b)
			);
			CREATE TABLE composite_read_children (
				id INTEGER PRIMARY KEY, parent_a TEXT NOT NULL, parent_b TEXT NOT NULL
			);
			INSERT INTO composite_read_parents VALUES ('a|string:b', 'c'), ('a', 'b|string:c');
			INSERT INTO composite_read_children VALUES (1, 'a|string:b', 'c'), (2, 'a', 'b|string:c');
		`);
		const client = better(drizzle({ client: sqlite, relations }));
		const rows = await client.parents.findMany({
			include: { children: true },
			orderBy: { keyA: 'asc' },
		});
		expect(
			rows.map((row) => ({
				keyA: row.keyA,
				children: row.children.map((child) => child.id),
			})),
		).toEqual([
			{ keyA: 'a', children: [2] },
			{ keyA: 'a|string:b', children: [1] },
		]);
	} finally {
		sqlite.close();
	}
});

const avatars = sqliteTable('one_to_one_avatars', {
	id: integer('id').primaryKey(),
});

const avatarOwners = sqliteTable('one_to_one_users', {
	id: integer('id').primaryKey(),
	avatarId: integer('avatar_id')
		.unique()
		.references(() => avatars.id),
});

const oneToOneRelations = defineRelations({ avatarOwners, avatars }, (r) => ({
	avatarOwners: {
		avatar: r.one.avatars({
			from: r.avatarOwners.avatarId,
			to: r.avatars.id,
		}),
	},
	avatars: {
		owner: r.one.avatarOwners({
			from: r.avatars.id,
			to: r.avatarOwners.avatarId,
		}),
	},
}));

describe('one-to-one relations owned by a unique foreign key', () => {
	let sqlite: Database;
	let client: ReturnType<typeof createClient>;

	const createClient = (database: Database) =>
		better(drizzle({ client: database, relations: oneToOneRelations }));

	const avatarIds = () =>
		client.avatarOwners
			.findMany({ orderBy: { id: 'asc' } })
			.then((rows) => rows.map((row) => [row.id, row.avatarId]));

	beforeEach(() => {
		sqlite = new Database(':memory:');
		sqlite.exec(`
			PRAGMA foreign_keys = ON;
			CREATE TABLE one_to_one_avatars (id INTEGER PRIMARY KEY);
			CREATE TABLE one_to_one_users (
				id INTEGER PRIMARY KEY,
				avatar_id INTEGER UNIQUE REFERENCES one_to_one_avatars(id)
			);
			INSERT INTO one_to_one_avatars VALUES (1), (2);
			INSERT INTO one_to_one_users VALUES (1, 1), (2, NULL);
		`);
		client = createClient(sqlite);
	});

	afterEach(() => {
		sqlite.close();
	});

	test('update connect moves a target another row holds', async () => {
		await client.avatarOwners.update({
			data: { avatar: { connect: { id: 1 } } },
			where: { id: 2 },
		});

		expect(await avatarIds()).toEqual([
			[1, null],
			[2, 1],
		]);
	});

	test('create connect moves a target another row holds', async () => {
		await client.avatarOwners.create({
			data: { avatar: { connect: { id: 1 } }, id: 3 },
		});

		expect(await avatarIds()).toEqual([
			[1, null],
			[2, null],
			[3, 1],
		]);
	});

	test('update connect keeps the target the row already holds', async () => {
		await client.avatarOwners.update({
			data: { avatar: { connect: { id: 1 } } },
			where: { id: 1 },
		});

		expect(await avatarIds()).toEqual([
			[1, 1],
			[2, null],
		]);
	});

	test('update set leaves the other rows when the target is free', async () => {
		await client.avatarOwners.update({
			data: { avatar: { set: { id: 2 } } },
			where: { id: 2 },
		});

		expect(await avatarIds()).toEqual([
			[1, 1],
			[2, 2],
		]);
	});
});

const regionalOwners = sqliteTable('one_to_one_regional_users', {
	id: integer('id').primaryKey(),
	avatarId: integer('avatar_id')
		.unique()
		.references(() => avatars.id),
	region: text('region').notNull(),
});

test('connect never detaches a holder outside the model scope', async () => {
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec(`
			CREATE TABLE one_to_one_avatars (id INTEGER PRIMARY KEY);
			CREATE TABLE one_to_one_regional_users (
				id INTEGER PRIMARY KEY,
				avatar_id INTEGER UNIQUE REFERENCES one_to_one_avatars(id),
				region TEXT NOT NULL
			);
			INSERT INTO one_to_one_avatars VALUES (1);
			INSERT INTO one_to_one_regional_users VALUES (1, 1, 'us'), (2, NULL, 'eu');
		`);
		const db = better(
			drizzle({
				client: sqlite,
				relations: defineRelations(
					{ avatars, regionalOwners },
					(r) => ({
						regionalOwners: {
							avatar: r.one.avatars({
								from: r.regionalOwners.avatarId,
								to: r.avatars.id,
							}),
						},
					}),
				),
			}),
			{ plugins: [regionPlugin()] },
		);

		await expect(
			db.$inRegion('eu').regionalOwners.update({
				data: { avatar: { connect: { id: 1 } } },
				where: { id: 2 },
			}),
		).rejects.toThrow();
		expect(
			(
				await db
					.$anyRegion()
					.regionalOwners.findMany({ orderBy: { id: 'asc' } })
			).map((row) => [row.id, row.avatarId]),
		).toEqual([
			[1, 1],
			[2, null],
		]);
	} finally {
		sqlite.close();
	}
});
