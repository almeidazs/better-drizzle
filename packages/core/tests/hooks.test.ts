import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { relations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { better } from '../src';

const users = sqliteTable('hook_users', {
	id: integer('id').primaryKey(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	age: integer('age').notNull(),
	active: integer('active', { mode: 'boolean' }).notNull(),
});

const usersRelations = relations(users, ({ many }) => ({
	posts: many(posts),
}));

const posts = sqliteTable('hook_posts', {
	id: integer('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	title: text('title').notNull(),
	body: text('body').notNull(),
	score: integer('score').notNull(),
	published: integer('published', { mode: 'boolean' }).notNull(),
});

const postsRelations = relations(posts, ({ one }) => ({
	author: one(users, {
		fields: [posts.userId],
		references: [users.id],
	}),
}));

const schema = { posts, postsRelations, users, usersRelations };

const createTablesSql = `
CREATE TABLE IF NOT EXISTS hook_users (
	id INTEGER PRIMARY KEY NOT NULL,
	email TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	age INTEGER NOT NULL,
	active INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hook_posts (
	id INTEGER PRIMARY KEY NOT NULL,
	user_id INTEGER NOT NULL REFERENCES hook_users(id),
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	score INTEGER NOT NULL,
	published INTEGER NOT NULL
);
`;

type HookEvent = { hook: string; action: string; table: string };

const createHookContext = (events: HookEvent[]) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(
		`PRAGMA journal_mode = MEMORY; PRAGMA foreign_keys = ON; ${createTablesSql}`,
	);
	sqlite.exec("INSERT INTO hook_users VALUES (1, 'a@test.com', 'A', 20, 1)");

	const raw = drizzle(sqlite, { schema });

	const track = (hook: string, action: string, table: string) =>
		events.push({ hook, action, table });

	const client = better(raw, {
		schema,
		hooks: {
			afterCreate: (ctx) => track('afterCreate', ctx.action, ctx.table),
			afterDelete: (ctx) => track('afterDelete', ctx.action, ctx.table),
			afterQuery: (ctx) => track('afterQuery', ctx.action, ctx.table),
			afterUpdate: (ctx) => track('afterUpdate', ctx.action, ctx.table),
			beforeCreate: (ctx) => track('beforeCreate', ctx.action, ctx.table),
			beforeDelete: (ctx) => track('beforeDelete', ctx.action, ctx.table),
			beforeQuery: (ctx) => track('beforeQuery', ctx.action, ctx.table),
			beforeUpdate: (ctx) => track('beforeUpdate', ctx.action, ctx.table),
		},
	});

	return { client, sqlite };
};

describe('hooks - create', () => {
	test('beforeCreate and afterCreate fire on create', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.create({
			data: {
				id: 2,
				email: 'b@test.com',
				name: 'B',
				age: 25,
				active: true,
			},
		});

		expect(events).toEqual([
			{ hook: 'beforeCreate', action: 'create', table: 'users' },
			{ hook: 'afterCreate', action: 'create', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeCreate and afterCreate fire on createMany', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.createMany({
			data: [
				{
					id: 3,
					email: 'c@test.com',
					name: 'C',
					age: 30,
					active: false,
				},
				{
					id: 4,
					email: 'd@test.com',
					name: 'D',
					age: 35,
					active: true,
				},
			],
		});

		expect(events).toEqual([
			{ hook: 'beforeCreate', action: 'createMany', table: 'users' },
			{ hook: 'afterCreate', action: 'createMany', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeCreate and afterCreate fire on upsert (create path)', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.upsert({
			where: { email: 'new@test.com' },
			create: {
				id: 10,
				email: 'new@test.com',
				name: 'New',
				age: 25,
				active: true,
			},
			update: { name: 'Updated' },
		});

		expect(events).toEqual([
			{ hook: 'beforeCreate', action: 'upsert', table: 'users' },
			{ hook: 'afterCreate', action: 'upsert', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeCreate and afterCreate fire on upsert (update path via fallback)', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.upsert({
			where: { email: 'a@test.com' },
			create: {
				id: 1,
				email: 'a@test.com',
				name: 'A',
				age: 20,
				active: true,
			},
			update: { name: 'Updated' },
		});

		expect(events).toEqual([
			{ hook: 'beforeCreate', action: 'upsert', table: 'users' },
			{ hook: 'afterCreate', action: 'upsert', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeCreate and afterCreate fire on upsertMany', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.upsertMany({
			data: [
				{
					id: 1,
					email: 'a@test.com',
					name: 'A Updated',
					age: 20,
					active: true,
				},
				{
					id: 5,
					email: 'e@test.com',
					name: 'E',
					age: 18,
					active: false,
				},
			],
			target: 'email',
			update: 'all',
		});

		expect(events).toEqual([
			{ hook: 'beforeCreate', action: 'upsertMany', table: 'users' },
			{ hook: 'afterCreate', action: 'upsertMany', table: 'users' },
		]);
		sqlite.close();
	});
});

describe('hooks - update', () => {
	test('beforeUpdate and afterUpdate fire on update', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.update({
			data: { name: 'Updated' },
			where: { id: 1 },
		});

		expect(events).toEqual([
			{ hook: 'beforeUpdate', action: 'update', table: 'users' },
			{ hook: 'afterUpdate', action: 'update', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeUpdate and afterUpdate fire on updateMany', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.updateMany({
			data: { active: false },
			where: { active: true },
		});

		expect(events).toEqual([
			{ hook: 'beforeUpdate', action: 'updateMany', table: 'users' },
			{ hook: 'afterUpdate', action: 'updateMany', table: 'users' },
		]);
		sqlite.close();
	});
});

describe('hooks - delete', () => {
	test('beforeDelete and afterDelete fire on delete', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.delete({ where: { id: 1 } });

		expect(events).toEqual([
			{ hook: 'beforeDelete', action: 'delete', table: 'users' },
			{ hook: 'afterDelete', action: 'delete', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeDelete and afterDelete fire on deleteMany', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.deleteMany({ where: { active: true } });

		expect(events).toEqual([
			{ hook: 'beforeDelete', action: 'deleteMany', table: 'users' },
			{ hook: 'afterDelete', action: 'deleteMany', table: 'users' },
		]);
		sqlite.close();
	});
});

describe('hooks - query', () => {
	test('beforeQuery and afterQuery fire on findMany', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.findMany();

		expect(events).toEqual([
			{ hook: 'beforeQuery', action: 'findMany', table: 'users' },
			{ hook: 'afterQuery', action: 'findMany', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeQuery and afterQuery fire on findFirst', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.findFirst({ where: { id: 1 } });

		expect(events).toEqual([
			{ hook: 'beforeQuery', action: 'findFirst', table: 'users' },
			{ hook: 'afterQuery', action: 'findFirst', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeQuery and afterQuery fire on findOne', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.findOne({ where: { id: 1 } });

		expect(events).toEqual([
			{ hook: 'beforeQuery', action: 'findOne', table: 'users' },
			{ hook: 'afterQuery', action: 'findOne', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeQuery and afterQuery fire on findUnique', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.findUnique({ where: { email: 'a@test.com' } });

		expect(events).toEqual([
			{ hook: 'beforeQuery', action: 'findUnique', table: 'users' },
			{ hook: 'afterQuery', action: 'findUnique', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeQuery and afterQuery fire on count', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.count();

		expect(events).toEqual([
			{ hook: 'beforeQuery', action: 'count', table: 'users' },
			{ hook: 'afterQuery', action: 'count', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeQuery and afterQuery fire on exists', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.exists({ where: { id: 1 } });

		expect(events).toEqual([
			{ hook: 'beforeQuery', action: 'exists', table: 'users' },
			{ hook: 'afterQuery', action: 'exists', table: 'users' },
		]);
		sqlite.close();
	});

	test('beforeQuery and afterQuery fire on paginate', async () => {
		const events: HookEvent[] = [];
		const { client, sqlite } = createHookContext(events);

		await client.users.paginate({ limit: 10 });

		expect(events).toEqual([
			{ hook: 'beforeQuery', action: 'paginate', table: 'users' },
			{ hook: 'afterQuery', action: 'paginate', table: 'users' },
		]);
		sqlite.close();
	});
});

describe('hooks - context', () => {
	test('hook context contains expected fields', async () => {
		const contexts: Record<string, unknown>[] = [];
		const sqlite = new Database(':memory:');
		sqlite.exec(`PRAGMA journal_mode = MEMORY; ${createTablesSql}`);
		sqlite.exec(
			"INSERT INTO hook_users VALUES (1, 'a@test.com', 'A', 20, 1)",
		);

		const raw = drizzle(sqlite, { schema });
		const client = better(raw, {
			schema,
			hooks: {
				beforeCreate: (ctx) =>
					contexts.push(ctx as unknown as Record<string, unknown>),
			},
		});

		await client.users.create({
			data: {
				id: 2,
				email: 'b@test.com',
				name: 'B',
				age: 25,
				active: true,
			},
		});

		expect(contexts.length).toBe(1);
		const ctx = contexts[0];
		expect(ctx?.action).toBe('create');
		expect(ctx?.table).toBe('users');
		expect(ctx?.db).toBe(raw);
		expect(ctx?.args).toBeDefined();
		expect(ctx?.schema).toBe(schema);
		expect(ctx?.tableInstance).toBeDefined();
		expect(ctx?.tableConfig).toBeDefined();
		expect(ctx?.repository).toBeDefined();
		expect(ctx?.meta).toBeUndefined();
		sqlite.close();
	});

	test('hook context with meta', async () => {
		const contexts: Record<string, unknown>[] = [];
		const sqlite = new Database(':memory:');
		sqlite.exec(`PRAGMA journal_mode = MEMORY; ${createTablesSql}`);
		sqlite.exec(
			"INSERT INTO hook_users VALUES (1, 'a@test.com', 'A', 20, 1)",
		);

		const raw = drizzle(sqlite, { schema });
		const client = better(raw, {
			schema,
			hooks: {
				beforeCreate: (ctx) =>
					contexts.push(ctx as unknown as Record<string, unknown>),
			},
		});

		await client.users.create({
			data: {
				id: 2,
				email: 'b@test.com',
				name: 'B',
				age: 25,
				active: true,
			},
			meta: { traceId: '123' },
		});

		expect(contexts[0]?.meta).toEqual({ traceId: '123' });
		sqlite.close();
	});
});

describe('hooks - error handling', () => {
	test('onError fires when operation throws', async () => {
		const errors: Record<string, unknown>[] = [];
		const sqlite = new Database(':memory:');
		sqlite.exec(`PRAGMA journal_mode = MEMORY; ${createTablesSql}`);

		const raw = drizzle(sqlite, { schema });
		const client = better(raw, {
			schema,
			hooks: {
				onError: (ctx) =>
					errors.push(ctx as unknown as Record<string, unknown>),
			},
		});

		try {
			await client.users.create({
				data: {
					id: 1,
					email: 'dup@test.com',
					name: 'Dup',
					age: 1,
					active: true,
				},
			});
			await client.users.create({
				data: {
					id: 1,
					email: 'dup@test.com',
					name: 'Dup',
					age: 1,
					active: true,
				},
			});
		} catch {}

		expect(errors.length).toBe(1);
		expect(errors[0]?.error).toBeDefined();
		expect(errors[0]?.stage).toBe('operation');
		sqlite.close();
	});

	test('onError fires when hook throws', async () => {
		const errors: Record<string, unknown>[] = [];
		const sqlite = new Database(':memory:');
		sqlite.exec(`PRAGMA journal_mode = MEMORY; ${createTablesSql}`);

		const raw = drizzle(sqlite, { schema });
		const client = better(raw, {
			schema,
			hooks: {
				beforeCreate: () => {
					throw new Error('Hook error');
				},
				onError: (ctx) =>
					errors.push(ctx as unknown as Record<string, unknown>),
			},
		});

		try {
			await client.users.create({
				data: {
					id: 1,
					email: 'a@test.com',
					name: 'A',
					age: 20,
					active: true,
				},
			});
		} catch {}

		expect(errors.length).toBe(1);
		expect((errors[0]?.error as Error)?.message).toBe('Hook error');
		expect(errors[0]?.stage).toBe('beforeHook');
		expect(errors[0]?.hookName).toBe('beforeCreate');
		sqlite.close();
	});
});

describe('hooks - no hooks', () => {
	test('operations work without hooks', async () => {
		const sqlite = new Database(':memory:');
		sqlite.exec(`PRAGMA journal_mode = MEMORY; ${createTablesSql}`);
		sqlite.exec(
			"INSERT INTO hook_users VALUES (1, 'a@test.com', 'A', 20, 1)",
		);

		const raw = drizzle(sqlite, { schema });
		const client = better(raw, { schema });

		const user = await client.users.findFirst({ where: { id: 1 } });
		expect(user).not.toBeNull();
		expect(user?.name).toBe('A');
		sqlite.close();
	});
});
