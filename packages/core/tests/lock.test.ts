import { describe, expect, test } from 'bun:test';
import { relations } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { BetterDrizzleErrorCode, better } from '../src';
import { createTestContext } from './setup';

const users = sqliteTable('lock_users', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const posts = sqliteTable('lock_posts', {
	authorId: integer('author_id')
		.notNull()
		.references(() => users.id),
	id: integer('id').primaryKey(),
	title: text('title').notNull(),
});

const usersRelations = relations(users, ({ many }) => ({
	posts: many(posts),
}));

const postsRelations = relations(posts, ({ one }) => ({
	author: one(users, {
		fields: [posts.authorId],
		references: [users.id],
	}),
}));

const schema = {
	posts,
	postsRelations,
	users,
	usersRelations,
};

type FakeSelectState = {
	forCalls: Array<{
		config: Record<string, unknown> | undefined;
		strength: string;
	}>;
};

const createFakeSelectQuery = (
	state: FakeSelectState,
	rows: Record<string, unknown>[],
	error?: unknown,
) => {
	const query = {
		for(strength: string, config?: Record<string, unknown>) {
			state.forCalls.push({ config, strength });
			return query;
		},
		innerJoin() {
			return query;
		},
		leftJoin() {
			return query;
		},
		limit() {
			return query;
		},
		offset() {
			return query;
		},
		orderBy() {
			return query;
		},
		where() {
			return query;
		},
	};

	return Object.assign(query, {
		// biome-ignore lint/suspicious/noThenProperty: test double intentionally mimics Drizzle's awaitable query builder.
		then<TResult1 = Record<string, unknown>[], TResult2 = never>(
			onfulfilled?:
				| ((
						value: Record<string, unknown>[],
				  ) => TResult1 | PromiseLike<TResult1>)
				| null,
			onrejected?:
				| ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
				| null,
		) {
			const promise = error
				? Promise.reject(error)
				: Promise.resolve(rows);
			return promise.then(onfulfilled, onrejected);
		},
	});
};

const createFakeDb = (
	dialectName: string,
	rows: Record<string, unknown>[] = [{ id: 1, name: 'Alice' }],
	error?: unknown,
) => {
	const state: FakeSelectState = {
		forCalls: [],
	};
	const txDb = {
		dialect: {
			constructor: {
				name: dialectName,
			},
		},
		query: {
			posts: {
				findFirst() {
					throw new Error('unexpected relational findFirst');
				},
				findMany() {
					throw new Error('unexpected relational findMany');
				},
			},
			users: {
				findFirst() {
					throw new Error('unexpected relational findFirst');
				},
				findMany() {
					throw new Error('unexpected relational findMany');
				},
			},
		},
		select() {
			return {
				from() {
					return createFakeSelectQuery(state, rows, error);
				},
			};
		},
	};
	const db = {
		...txDb,
		async transaction<T>(callback: (tx: typeof txDb) => Promise<T> | T) {
			return callback(txDb);
		},
	};

	return {
		db,
		state,
	};
};

describe('row locks', () => {
	test('rejects locks on sqlite reads', async () => {
		const ctx = createTestContext();

		await expect(
			ctx.better.users.findMany({
				lock: 'update',
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.LockNotSupported,
		});

		ctx.close();
	});

	test('applies FOR UPDATE on pg direct reads', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, { schema });

		const rows = await client.users.findMany({
			lock: 'update',
			where: { id: 1 },
		});

		expect(rows).toHaveLength(1);
		expect(fake.state.forCalls).toEqual([
			{
				config: undefined,
				strength: 'update',
			},
		]);
	});

	test('supports direct locked reads across single-row helpers', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, { schema });

		await client.users.findFirst({
			lock: 'update',
			where: { id: 1 },
		});
		await client.users.findOne({
			lock: 'share',
			where: { id: 1 },
		});
		await client.users.findUnique({
			lock: {
				mode: 'keyShare',
			},
			where: { id: 1 },
		});

		expect(fake.state.forCalls).toEqual([
			{
				config: undefined,
				strength: 'update',
			},
			{
				config: undefined,
				strength: 'share',
			},
			{
				config: undefined,
				strength: 'key share',
			},
		]);
	});

	test('passes skipLocked and table targets on pg locks', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, { schema });

		await client.users.findMany({
			lock: {
				mode: 'update',
				skipLocked: true,
				tables: ['lock_users', 'posts'],
			},
		});

		expect(fake.state.forCalls).toHaveLength(1);
		expect(fake.state.forCalls[0]?.strength).toBe('update');
		expect(fake.state.forCalls[0]?.config).toMatchObject({
			skipLocked: true,
		});
		expect(
			(fake.state.forCalls[0]?.config?.of as unknown[] | undefined)
				?.length,
		).toBe(2);
	});

	test('deduplicates repeated lock tables resolved by schema key and db name', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, { schema });

		await client.users.findMany({
			lock: {
				mode: 'update',
				tables: ['users', 'lock_users', 'posts', 'lock_posts'],
			},
		});

		const of = fake.state.forCalls[0]?.config?.of as unknown[] | undefined;
		expect(of).toBeDefined();
		expect(of?.length).toBe(2);
	});

	test('supports postgres-specific lock strengths', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, { schema });

		await client.users.findMany({
			lock: {
				mode: 'noKeyUpdate',
				noWait: true,
			},
		});
		await client.users.findMany({
			lock: {
				mode: 'keyShare',
				skipLocked: true,
			},
		});

		expect(fake.state.forCalls).toEqual([
			{
				config: { noWait: true },
				strength: 'no key update',
			},
			{
				config: { skipLocked: true },
				strength: 'key share',
			},
		]);
	});

	test('supports locks inside transactions when transactionsOnly is enabled', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, {
			locks: { transactionsOnly: true },
			schema,
		});

		await client.transaction(async (tx) => {
			await tx.users.findMany({
				lock: 'update',
			});
		});

		expect(fake.state.forCalls).toHaveLength(1);
	});

	test('rejects locks outside transactions when transactionsOnly is enabled', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, {
			locks: { transactionsOnly: true },
			schema,
		});

		await expect(
			client.users.findMany({
				lock: 'update',
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.LockRequiresTransaction,
		});
	});

	test('rejects invalid lock table names', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, { schema });

		await expect(
			client.users.findMany({
				lock: {
					mode: 'update',
					tables: ['missing_table'],
				},
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.OperationError,
			details: {
				target: 'missing_table',
			},
		});
	});

	test('supports joined one-relation read path with lock when the fast path applies', async () => {
		const fake = createFakeDb('PgDialect', [
			{ author: { id: 1, name: 'Alice' }, id: 1 },
		]);
		const client = better(fake.db as never, { schema });

		const rows = await client.posts.findMany({
			include: { author: true },
			lock: 'update',
			where: {
				author: {
					is: {
						id: 1,
					},
				},
			},
		});

		expect(rows).toHaveLength(1);
		expect(fake.state.forCalls).toEqual([
			{
				config: undefined,
				strength: 'update',
			},
		]);
	});

	test('rejects incompatible relation loading with locks', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, { schema });

		await expect(
			client.users.findMany({
				include: { posts: true },
				lock: 'update',
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.LockNotSupported,
		});
	});

	test('rejects nested relation selects with locks', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, { schema });

		await expect(
			client.posts.findMany({
				lock: 'update',
				select: {
					author: {
						select: {
							id: true,
						},
					},
					id: true,
				},
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.LockNotSupported,
		});
	});

	test('rejects mysql-only unsupported lock modes', async () => {
		const fake = createFakeDb('MySqlDialect');
		const client = better(fake.db as never, { schema });

		await expect(
			client.users.findMany({
				lock: {
					mode: 'noKeyUpdate',
				},
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.LockNotSupported,
		});
	});

	test('supports mysql lock modes and options that drizzle exposes', async () => {
		const fake = createFakeDb('MySqlDialect');
		const client = better(fake.db as never, { schema });

		await client.users.findMany({
			lock: {
				mode: 'share',
				noWait: true,
			},
		});
		await client.users.findMany({
			lock: {
				mode: 'update',
				skipLocked: true,
			},
		});

		expect(fake.state.forCalls).toEqual([
			{
				config: { noWait: true },
				strength: 'share',
			},
			{
				config: { skipLocked: true },
				strength: 'update',
			},
		]);
	});

	test('rejects lock tables on mysql', async () => {
		const fake = createFakeDb('MySqlDialect');
		const client = better(fake.db as never, { schema });

		await expect(
			client.users.findMany({
				lock: {
					mode: 'update',
					tables: ['users'],
				},
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.LockNotSupported,
		});
	});

	test('rejects noWait together with skipLocked', async () => {
		const fake = createFakeDb('PgDialect');
		const client = better(fake.db as never, { schema });

		await expect(
			client.users.findMany({
				lock: {
					mode: 'update',
					noWait: true,
					skipLocked: true,
				},
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.OperationError,
		});
	});

	test('normalizes lock acquisition failures', async () => {
		const fake = createFakeDb('PgDialect', [], {
			code: '55P03',
			message: 'could not obtain lock on row in relation "lock_users"',
		});
		const client = better(fake.db as never, { schema });

		await expect(
			client.users.findMany({
				lock: 'update',
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.LockTimeout,
		});
	});

	test('normalizes mysql lock acquisition failures', async () => {
		const fake = createFakeDb('MySqlDialect', [], {
			errno: 3572,
			message:
				'Statement aborted because lock(s) could not be acquired immediately and NOWAIT is set.',
		});
		const client = better(fake.db as never, { schema });

		await expect(
			client.users.findMany({
				lock: {
					mode: 'share',
					noWait: true,
				},
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.LockTimeout,
		});
	});

	test('does not remap unrelated database failures during locked reads', async () => {
		const fake = createFakeDb('PgDialect', [], {
			code: '23505',
			message: 'duplicate key value violates unique constraint',
		});
		const client = better(fake.db as never, { schema });

		await expect(
			client.users.findMany({
				lock: 'update',
			}),
		).rejects.toEqual({
			code: '23505',
			message: 'duplicate key value violates unique constraint',
		});
	});

	test('paginate queries propagate lock handling', async () => {
		const fake = createFakeDb('PgDialect', [{ id: 1, name: 'Alice' }]);
		const client = better(fake.db as never, { schema });

		const result = await client.users.paginate({
			limit: 1,
			lock: {
				mode: 'update',
			},
			orderBy: { id: 'asc' },
		});

		expect(result.data).toHaveLength(1);
		expect(fake.state.forCalls).toEqual([
			{
				config: undefined,
				strength: 'update',
			},
		]);
	});

	test('cursor queries propagate lock handling', async () => {
		const fake = createFakeDb('PgDialect', [{ id: 1, name: 'Alice' }]);
		const client = better(fake.db as never, { schema });

		await client.users.cursor({
			limit: 1,
			lock: {
				mode: 'share',
				noWait: true,
			},
			orderBy: { id: 'asc' },
		});

		expect(fake.state.forCalls).toEqual([
			{
				config: { noWait: true },
				strength: 'share',
			},
		]);
	});

	test('cursor navigation probes preserve locks on follow-up reads', async () => {
		const fake = createFakeDb('PgDialect', [{ id: 1, name: 'Alice' }]);
		const client = better(fake.db as never, { schema });

		await client.users.cursor({
			after: { id: 1 },
			limit: 1,
			lock: 'update',
			orderBy: { id: 'asc' },
		});

		expect(fake.state.forCalls.length).toBeGreaterThanOrEqual(2);
		for (const call of fake.state.forCalls)
			expect(call).toEqual({
				config: undefined,
				strength: 'update',
			});
	});
});

const typeClient = better(createFakeDb('PgDialect').db as never, { schema });
type CountArgs = Parameters<typeof typeClient.users.count>[0];
type ExistsArgs = Parameters<typeof typeClient.users.exists>[0];

// @ts-expect-error count does not accept row locks
const invalidCountArgs: CountArgs = { lock: 'update' };
// @ts-expect-error exists does not accept row locks
const invalidExistsArgs: ExistsArgs = { lock: 'update' };

void invalidCountArgs;
void invalidExistsArgs;
