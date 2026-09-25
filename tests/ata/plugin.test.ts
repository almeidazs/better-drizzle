import { describe, expect, test } from 'bun:test';

import { relations } from 'drizzle-orm';
import {
	boolean,
	integer,
	pgTable,
	serial,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core';

import { better } from '../../src';
import { ata } from '../../src/plugins/ata';
import { createAtaSchemasRegistry } from '../../src/plugins/ata/shared/registry';
import { createTestContext } from '../core/setup';

// The plugin itself: what it registers, what its registry hands out, and what a
// hook does with a payload. The hooks are called directly here rather than
// through a database, because what is being tested is the decision the plugin
// makes, not that Better Drizzle calls it.

const users = pgTable('users', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 80 }).notNull(),
	active: boolean('active').notNull().default(true),
	age: integer('age'),
	created: timestamp('created').notNull().defaultNow(),
});

const schema = { users };

describe('the plugin definition', () => {
	const plugin = ata();

	test('it identifies itself the way the other plugins do', () => {
		expect(plugin.id).toBe('better-drizzle/ata');
		expect(plugin.name).toBe('ata');
		expect(typeof plugin.version).toBe('string');
	});

	test('every operation takes a per-call validate flag', () => {
		const args = plugin.operationArgs as Record<string, unknown>;
		for (const op of [
			'count',
			'create',
			'createMany',
			'cursor',
			'delete',
			'deleteMany',
			'exists',
			'findFirst',
			'findMany',
			'findOne',
			'findUnique',
			'paginate',
			'update',
			'updateEach',
			'updateMany',
			'upsert',
			'upsertMany',
		])
			expect(args[op]).toHaveProperty('validate');
	});

	test('it declares the hooks it uses', () => {
		const hooks = plugin.hooks as Record<string, unknown>;
		for (const hook of [
			'afterCreate',
			'afterUpdate',
			'afterQuery',
			'beforeCreate',
			'beforeDelete',
			'beforeQuery',
			'beforeUpdate',
		])
			expect(typeof hooks[hook]).toBe('function');
	});
});

describe('runtime integration', () => {
	test('allows relation projections and relation writes', async () => {
		const base = createTestContext();
		const client = better(base.raw, {
			plugins: [ata()],
			schema: base.schema,
		});

		await expect(
			client.users.findFirst({
				include: { posts: true },
				where: { id: 1 },
			}),
		).resolves.toMatchObject({ id: 1, posts: expect.any(Array) });
		await expect(
			client.users.findMany({
				validate: true,
				where: { posts: { some: { published: true } } },
			}),
		).resolves.not.toHaveLength(0);

		await expect(
			client.posts.update({
				data: { author: { connect: { id: 2 } } },
				where: { id: 1 },
			}),
		).resolves.toMatchObject({ id: 1, userId: 2 });
		base.close();
	});
});

describe('the registry', () => {
	const registry = createAtaSchemasRegistry(schema);

	test('it finds the tables', () => {
		expect(registry.tables()).toEqual(['users']);
	});

	test('a table entry carries every schema as a plain object', () => {
		const entry = registry.get('users');
		expect(entry).toBeDefined();
		// The point of describing a table in JSON Schema: the description is data
		expect(entry?.schemas.create.schema).toMatchObject({ type: 'object' });
		expect(JSON.parse(JSON.stringify(entry?.schemas.query.schema))).toEqual(
			entry?.schemas.query.schema as object,
		);
	});

	test('the residues are named, not hidden', () => {
		expect(registry.get('users')?.schemas.residues).toEqual({
			created: 'date',
		});
	});

	test('runs residue checks through compiled operation schemas', () => {
		expect(
			registry.getCreate('users').validate({
				created: 'not a Date',
				name: 'ada',
			}).valid,
		).toBe(false);
	});

	test('an unknown table does not refuse everything', () => {
		// The core reports the unknown table; this plugin must not turn it into a
		// validation failure of its own.
		expect(registry.getCreate('nope').validate({ a: 1 }).valid).toBe(true);
	});

	test('the create schema does not require what the database fills in', () => {
		const create = registry.getCreate('users');
		expect(create.validate({ name: 'ada' }).valid).toBe(true);
		expect(create.validate({}).valid).toBe(false);
		expect(create.validate({ name: 'ada', nope: 1 }).valid).toBe(false);
	});

	test('the update schema requires nothing but still checks types', () => {
		const update = registry.getUpdate('users');
		expect(update.validate({}).valid).toBe(true);
		expect(update.validate({ age: 3 }).valid).toBe(true);
		expect(update.validate({ age: 'three' }).valid).toBe(false);
	});

	test('the query arguments refuse a misspelled argument', () => {
		const query = registry.getQueryArgs('users');
		expect(query.validate({ where: { name: 'ada' }, take: 5 }).valid).toBe(
			true,
		);
		expect(query.validate({ wher: {} }).valid).toBe(false);
		expect(query.validate({ orderBy: { name: 'up' } }).valid).toBe(false);
	});

	test('delete requires a filter and deleteMany does not', () => {
		expect(registry.getDeleteArgs('users', false).validate({}).valid).toBe(
			false,
		);
		expect(registry.getDeleteArgs('users', true).validate({}).valid).toBe(
			true,
		);
	});

	test('a result is a row, a null, or an array of rows', () => {
		const one = registry.getResult('users', false);
		const many = registry.getResult('users', true);
		const row = { id: 1, name: 'ada', active: true, age: null };
		expect(one.validate(row).valid).toBe(true);
		expect(one.validate(null).valid).toBe(true);
		expect(many.validate([row]).valid).toBe(true);
		expect(many.validate(row).valid).toBe(false);
	});

	test('a column override replaces what was derived, and false drops it', () => {
		const custom = createAtaSchemasRegistry(schema, {
			tables: {
				users: {
					columns: {
						age: false,
						name: { type: 'string', minLength: 2 },
					},
				},
			},
		});
		const create = custom.getCreate('users');
		expect(create.validate({ name: 'a' }).valid).toBe(false);
		expect(create.validate({ name: 'ada' }).valid).toBe(true);
		// age was dropped, so it is no longer a known column
		expect(create.validate({ name: 'ada', age: 3 }).valid).toBe(false);
	});
});

describe('relations', () => {
	const relationUsers = pgTable('ata_relation_users', {
		id: serial('id').primaryKey(),
		name: varchar('name').notNull(),
	});
	const relationPosts = pgTable('ata_relation_posts', {
		id: serial('id').primaryKey(),
		userId: integer('user_id').notNull(),
	});
	const relationUsersRelations = relations(relationUsers, ({ many }) => ({
		posts: many(relationPosts),
	}));
	const registry = createAtaSchemasRegistry({
		relationPosts,
		relationUsers,
		relationUsersRelations,
	});

	test('discovers Drizzle relations and accepts their projections', () => {
		expect(registry.get('relationUsers')?.relations).toEqual(['posts']);
		expect(
			registry.getQueryArgs('relationUsers').validate({
				include: { posts: true },
			}).valid,
		).toBe(true);
	});

	test('accepts a requested relation in a result', () => {
		expect(
			registry
				.getResult('relationUsers', false, { include: { posts: true } })
				.validate({ id: 1, name: 'ada', posts: [] }).valid,
		).toBe(true);
	});
});

// A stand-in for what Better Drizzle passes a hook.
const context = (over: Record<string, unknown>) => ({
	args: {},
	kind: 'create',
	model: { columns: {}, dbName: 'users', name: 'users' },
	schema,
	table: 'users',
	...over,
});

describe('the hooks', () => {
	const plugin = ata();
	const hooks = plugin.hooks as Record<string, (ctx: unknown) => unknown>;

	test('a good create payload passes through unchanged', () => {
		const data = { name: 'ada' };
		expect(hooks.beforeCreate(context({ data }))).toBe(data);
	});

	test('a bad create payload throws, and the error names the column', () => {
		let thrown: unknown;
		try {
			hooks.beforeCreate(context({ data: { name: 42 } }));
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		const details = (thrown as { details?: { issues?: unknown[] } })
			.details;
		expect(details?.pluginId).toBe('better-drizzle/ata');
		const issues = details?.issues as { code: string; path: string }[];
		expect(issues[0]?.path).toBe('name');
		expect(issues[0]?.code).toMatch(/^ATA\d+$/);
	});

	test('a per-call validate: false turns it off', () => {
		const data = { name: 42 };
		expect(
			hooks.beforeCreate(context({ args: { validate: false }, data })),
		).toBe(data);
	});

	test('reads are not validated unless asked for', () => {
		// findMany is off by default, so a misspelled argument passes here
		expect(() =>
			hooks.beforeQuery(
				context({ args: { wher: {} }, kind: 'findMany' }),
			),
		).not.toThrow();

		expect(() =>
			hooks.beforeQuery(
				context({
					args: { validate: true, wher: {} },
					kind: 'findMany',
				}),
			),
		).toThrow();
	});

	test('createMany checks every row', () => {
		expect(() =>
			hooks.beforeCreate(
				context({
					data: [{ name: 'ada' }, { name: 7 }],
					kind: 'createMany',
				}),
			),
		).toThrow();
	});

	test('an upsert checks both halves', () => {
		expect(() =>
			hooks.beforeCreate(
				context({
					data: { create: { name: 'ada' }, update: { age: 'old' } },
					kind: 'upsert',
				}),
			),
		).toThrow();
	});

	test('a result that does not match the table is reported', () => {
		expect(() =>
			hooks.afterQuery(
				context({
					kind: 'findFirst',
					result: { id: 'one', name: 'ada' },
				}),
			),
		).toThrow();

		expect(() =>
			hooks.afterQuery(context({ kind: 'findFirst', result: null })),
		).not.toThrow();
	});

	test('count and exists results are not treated as rows', () => {
		expect(() =>
			hooks.afterQuery(context({ kind: 'count', result: 7 })),
		).not.toThrow();
		expect(() =>
			hooks.afterQuery(context({ kind: 'exists', result: true })),
		).not.toThrow();
	});
});
