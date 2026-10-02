import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineRelations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
	blob,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core';

import { better, param } from '../../src';
import {
	cache,
	type CacheOptions,
	type CacheStore,
} from '../../src/plugins/cache';
import { softDelete } from '../../src/plugins/soft-delete';

export const users = sqliteTable('cache_users', {
	balance: blob('balance', { mode: 'bigint' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }),
	deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
	tenantId: integer('tenant_id').notNull(),
});

export const posts = sqliteTable('cache_posts', {
	authorId: integer('author_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	id: integer('id').primaryKey(),
	title: text('title').notNull(),
});

export const groups = sqliteTable('cache_groups', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

export const memberships = sqliteTable(
	'cache_memberships',
	{
		groupId: integer('group_id')
			.notNull()
			.references(() => groups.id),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
	},
	(table) => [primaryKey({ columns: [table.userId, table.groupId] })],
);

export const relations = defineRelations(
	{ groups, memberships, posts, users },
	(r) => ({
		groups: {
			users: r.many.users({
				from: r.groups.id.through(r.memberships.groupId),
				to: r.users.id.through(r.memberships.userId),
			}),
		},
		posts: {
			author: r.one.users({ from: r.posts.authorId, to: r.users.id }),
		},
		users: {
			groups: r.many.groups({
				from: r.users.id.through(r.memberships.userId),
				to: r.groups.id.through(r.memberships.groupId),
			}),
			posts: r.many.posts(),
		},
	}),
);

export const createDatabase = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE cache_users (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			tenant_id INTEGER NOT NULL,
			balance BLOB,
			created_at INTEGER,
			deleted_at INTEGER
		);
		CREATE TABLE cache_posts (
			id INTEGER PRIMARY KEY,
			author_id INTEGER NOT NULL REFERENCES cache_users(id) ON DELETE CASCADE,
			title TEXT NOT NULL
		);
		CREATE TABLE cache_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
		CREATE TABLE cache_memberships (
			user_id INTEGER NOT NULL REFERENCES cache_users(id) ON DELETE CASCADE,
			group_id INTEGER NOT NULL REFERENCES cache_groups(id),
			PRIMARY KEY (user_id, group_id)
		);
		INSERT INTO cache_users (id, name, tenant_id) VALUES
			(1, 'Ada', 1), (2, 'Grace', 1), (3, 'Linus', 2);
		INSERT INTO cache_posts (id, author_id, title) VALUES
			(1, 1, 'Engines'), (2, 1, 'Notes'), (3, 2, 'Compilers');
		INSERT INTO cache_groups (id, name) VALUES (1, 'Admins'), (2, 'Staff');
		INSERT INTO cache_memberships (user_id, group_id) VALUES (1, 1);
	`);
	const queries: string[] = [];
	const db = drizzle({
		client: sqlite,
		logger: {
			logQuery(query) {
				queries.push(query);
			},
		},
		relations,
	});

	return { db, queries, sqlite };
};

export const createClient = (
	store: CacheStore,
	options: Partial<CacheOptions> = {},
	extra: { softDelete?: boolean } = {},
) => {
	const database = createDatabase();
	const plugins = [
		...(extra.softDelete ? [softDelete()] : []),
		cache({
			namespace: `test-${crypto.randomUUID()}`,
			store,
			ttl: '1m',
			...options,
		}),
	] as const;
	const client = better(database.db, { plugins });
	return {
		...database,
		client,
		/** Number of SQL statements run by `fn`. */
		async count(fn: () => Promise<unknown>) {
			const before = database.queries.length;
			await fn();
			return database.queries.length - before;
		},
	};
};

/**
 * Behaviour every store must share. Each call receives a fresh store and
 * uses a random namespace, so Redis runs do not see each other's keys.
 */
export const defineCacheSuite = (
	label: string,
	createStore: () => CacheStore,
) => {
	describe(`better-drizzle/cache (${label})`, () => {
		test('miss, hit, then an update invalidates the entry', async () => {
			const { client, count } = createClient(createStore());
			const read = () =>
				client.users.findUnique({ cache: true, where: { id: 1 } });

			expect(await count(read)).toBe(1);
			expect(await count(read)).toBe(0);
			expect((await read())?.name).toBe('Ada');

			await client.users.update({
				data: { name: 'Ada L.' },
				where: { id: 1 },
			});
			expect(await count(read)).toBe(1);
			expect((await read())?.name).toBe('Ada L.');
		});

		test('every read helper caches its complete result and invalidates after writes', async () => {
			const { client, queries } = createClient(createStore());
			const reads = [
				() => client.users.findMany({ cache: true, where: { id: 1 } }),
				() => client.users.findFirst({ cache: true, where: { id: 1 } }),
				() => client.users.findOne({ cache: true, where: { id: 1 } }),
				() =>
					client.users.findUnique({ cache: true, where: { id: 1 } }),
				() => client.users.count({ cache: true, where: { id: 1 } }),
				() => client.users.exists({ cache: true, where: { id: 1 } }),
				() =>
					client.users.paginate({
						cache: true,
						page: 1,
						perPage: 2,
						where: { id: 1 },
					}),
				() =>
					client.users.cursor({
						cache: true,
						orderBy: { id: 'asc' },
						take: 1,
						where: { id: 1 },
					}),
			];
			for (const read of reads) {
				const first = await read();
				const before = queries.length;
				const second = await read();
				expect(second).toEqual(first);
				expect(queries.length).toBe(before);
			}
			await client.users.delete({ where: { id: 1 } });
			for (const read of reads) {
				const before = queries.length;
				await read();
				expect(queries.length).toBeGreaterThan(before);
			}
		});

		test('reads are cached only when opted in', async () => {
			const { client, count } = createClient(createStore(), {
				models: { posts: true },
			});

			const findUsers = () => client.users.findMany();
			expect(await count(findUsers)).toBe(1);
			expect(await count(findUsers)).toBe(1);

			const findPosts = () => client.posts.findMany();
			expect(await count(findPosts)).toBe(1);
			expect(await count(findPosts)).toBe(0);

			const uncached = () => client.posts.findMany({ cache: false });
			expect(await count(uncached)).toBe(1);
		});

		test('different query shapes never share an entry', async () => {
			const { client } = createClient(createStore());

			const byName = await client.users.findMany({
				cache: true,
				orderBy: { name: 'asc' },
			});
			const byId = await client.users.findMany({
				cache: true,
				orderBy: { id: 'desc' },
			});
			const selected = await client.users.findMany({
				cache: true,
				select: { name: true },
				where: { tenantId: 1 },
			});
			const counted = await client.users.count({
				cache: true,
				where: { tenantId: 1 },
			});

			expect(byName.map((user) => user.name)).toEqual([
				'Ada',
				'Grace',
				'Linus',
			]);
			expect(byId.map((user) => user.id)).toEqual([3, 2, 1]);
			expect(selected).toEqual([{ name: 'Ada' }, { name: 'Grace' }]);
			expect(counted).toBe(2);
		});

		test('vary isolates tenants that run the same query', async () => {
			const { client, count } = createClient(createStore(), {
				vary: ({ meta }) => (meta as { tenant?: number })?.tenant,
			});
			const read = (tenant: number) =>
				client.$withContext({ tenant }).users.findMany({ cache: true });

			expect(await count(() => read(1))).toBe(1);
			expect(await count(() => read(2))).toBe(1);
			expect(await count(() => read(1))).toBe(0);
		});

		test('an entity write leaves other entity lookups cached', async () => {
			const { client, count } = createClient(createStore());
			const readAda = () =>
				client.users.findUnique({ cache: true, where: { id: 1 } });
			const readGrace = () =>
				client.users.findUnique({ cache: true, where: { id: 2 } });
			const list = () => client.users.findMany({ cache: true });

			await readAda();
			await readGrace();
			await list();
			await client.users.update({
				data: { name: 'Grace H.' },
				where: { id: 2 },
			});

			expect(await count(readAda)).toBe(0);
			expect(await count(readGrace)).toBe(1);
			expect(await count(list)).toBe(1);
		});

		test('writes with an unknown target invalidate every read of the model', async () => {
			const { client, count } = createClient(createStore());
			const readAda = () =>
				client.users.findUnique({ cache: true, where: { id: 1 } });

			await readAda();
			await client.users.updateMany({
				data: { name: 'Renamed' },
				where: { tenantId: 1 },
			});

			expect(await count(readAda)).toBe(1);
			expect((await readAda())?.name).toBe('Renamed');
		});

		test('creates invalidate lists and cached empty lookups', async () => {
			const { client, count } = createClient(createStore());
			const missing = () =>
				client.users.findUnique({ cache: true, where: { id: 9 } });
			const list = () => client.users.count({ cache: true });

			expect(await missing()).toBeNull();
			expect(await count(missing)).toBe(0);
			expect(await list()).toBe(3);

			await client.users.create({
				data: { id: 9, name: 'New', tenantId: 1 },
			});

			expect(await count(missing)).toBe(1);
			expect((await missing())?.name).toBe('New');
			expect(await list()).toBe(4);
		});

		test('included relations are dependencies', async () => {
			const { client, count } = createClient(createStore());
			const read = () =>
				client.users.findUnique({
					cache: true,
					include: { groups: true, posts: true },
					where: { id: 1 },
				});

			expect((await read())?.posts).toHaveLength(2);
			expect(await count(read)).toBe(0);

			await client.posts.create({
				data: { authorId: 1, id: 4, title: 'New post' },
			});
			expect(await count(read)).toBeGreaterThan(0);
			expect((await read())?.posts).toHaveLength(3);

			await client.$executeRaw(
				sql`INSERT INTO cache_memberships (user_id, group_id) VALUES (1, 2)`,
				{ cache: { invalidate: { models: ['memberships'] } } },
			);
			expect((await read())?.groups).toHaveLength(2);
		});

		test('relation filters and _count are dependencies', async () => {
			const { client } = createClient(createStore());
			const authors = () =>
				client.users.findMany({
					cache: true,
					where: { posts: { some: { title: 'Fresh' } } },
				});
			const counts = () =>
				client.users.findUnique({
					cache: true,
					include: { _count: { select: { posts: true } } },
					where: { id: 2 },
				});

			expect(await authors()).toHaveLength(0);
			expect((await counts())?._count.posts).toBe(1);

			await client.posts.create({
				data: { authorId: 2, id: 5, title: 'Fresh' },
			});

			expect(await authors()).toHaveLength(1);
			expect((await counts())?._count.posts).toBe(2);
		});

		test('relation writes invalidate the target model', async () => {
			const { client } = createClient(createStore());
			const members = () =>
				client.groups.findUnique({
					cache: true,
					include: { users: true },
					where: { id: 2 },
				});

			expect((await members())?.users).toHaveLength(0);
			await client.users.update({
				data: { groups: { connect: [{ id: 2 }] } },
				where: { id: 3 },
			});
			expect((await members())?.users).toHaveLength(1);
		});

		test('deletes invalidate models that cascade from them', async () => {
			const { client } = createClient(createStore());
			const read = () => client.posts.count({ cache: true });

			expect(await read()).toBe(3);
			await client.users.delete({ where: { id: 1 } });
			expect(await read()).toBe(1);
		});

		test('tags, custom keys, and clear', async () => {
			const { client, count } = createClient(createStore());
			const tagged = () =>
				client.users.findMany({ cache: { tags: ['feed'] } });
			const keyed = () =>
				client.users.findFirst({
					cache: 'first-user',
					orderBy: { id: 'asc' },
				});

			await tagged();
			await keyed();
			expect(await count(tagged)).toBe(0);
			expect(await count(keyed)).toBe(0);

			await client.$cache.invalidate({ tags: ['feed'] });
			expect(await count(tagged)).toBe(1);
			expect(await count(keyed)).toBe(0);

			await client.$cache.invalidate({ keys: ['first-user'] });
			expect(await count(keyed)).toBe(1);

			await client.$cache.clear();
			expect(await count(tagged)).toBe(1);
			expect(await count(keyed)).toBe(1);

			// A custom key still depends on the model.
			await client.users.update({
				data: { name: 'Ada 2' },
				where: { id: 1 },
			});
			expect((await keyed())?.name).toBe('Ada 2');

			await client.users.create({
				cache: { invalidate: { tags: ['feed'] } },
				data: { id: 7, name: 'Tagged', tenantId: 1 },
			});
			expect(await count(tagged)).toBe(1);
		});

		test('transactions bypass reads and invalidate only after commit', async () => {
			const { client, count } = createClient(createStore());
			const read = () =>
				client.users.findUnique({ cache: true, where: { id: 1 } });

			await read();
			await client.transaction(async (tx) => {
				await tx.users.update({
					data: { name: 'In tx' },
					where: { id: 1 },
				});
				expect(
					await count(() =>
						tx.users.findUnique({ cache: true, where: { id: 1 } }),
					),
				).toBe(1);
				// Not committed yet: other readers still get the cached row.
				expect((await read())?.name).toBe('Ada');
			});
			expect((await read())?.name).toBe('In tx');

			await read();
			await expect(
				client.transaction(async (tx) => {
					await tx.users.update({
						data: { name: 'Rolled back' },
						where: { id: 1 },
					});
					throw new Error('abort');
				}),
			).rejects.toThrow('abort');
			expect(await count(read)).toBe(0);
			expect((await read())?.name).toBe('In tx');
		});

		test('savepoint rollbacks drop their invalidations', async () => {
			const { client, count } = createClient(createStore());
			const readAda = () =>
				client.users.findUnique({ cache: true, where: { id: 1 } });
			const readGrace = () =>
				client.users.findUnique({ cache: true, where: { id: 2 } });

			await readAda();
			await readGrace();
			await client.transaction(async (tx) => {
				await tx.users.update({
					data: { name: 'Kept' },
					where: { id: 1 },
				});
				await tx
					.transaction(async (nested) => {
						await nested.users.update({
							data: { name: 'Dropped' },
							where: { id: 2 },
						});
						throw new Error('inner');
					})
					.catch(() => undefined);
			});

			expect(await count(readAda)).toBe(1);
			expect(await count(readGrace)).toBe(0);
		});

		test('serialization preserves Date, bigint, Buffer, arrays, and null', async () => {
			const { client } = createClient(createStore());
			const createdAt = new Date('2026-01-02T03:04:05.678Z');
			await client.users.update({
				data: { balance: 12345678901234567890n, createdAt },
				where: { id: 1 },
			});
			const read = () =>
				client.users.findMany({
					cache: true,
					orderBy: { id: 'asc' },
					where: { tenantId: 1 },
				});

			const first = await read();
			const cached = await read();

			expect(cached).toEqual(first);
			expect(cached[0]?.createdAt).toBeInstanceOf(Date);
			expect(cached[0]?.createdAt?.getTime()).toBe(createdAt.getTime());
			expect(cached[0]?.balance).toBe(12345678901234567890n);
			expect(cached[1]?.balance).toBeNull();
		});

		test('concurrent misses run one query', async () => {
			const { client, count } = createClient(createStore());
			let results: unknown[] = [];
			expect(
				await count(async () => {
					results = await Promise.all(
						Array.from({ length: 5 }, () =>
							client.users.findMany({ cache: true }),
						),
					);
				}),
			).toBe(1);
			// Each caller gets its own copy.
			expect(new Set(results).size).toBe(5);
			for (const result of results) expect(result).toEqual(results[0]!);
			expect(
				await count(() => client.users.findMany({ cache: true })),
			).toBe(0);
		});

		test('pagination envelopes are cached', async () => {
			const { client, count } = createClient(createStore());
			const page = () =>
				client.users.paginate({
					cache: true,
					orderBy: { id: 'asc' },
					page: 1,
					perPage: 2,
				});

			const first = await page();
			expect(await count(page)).toBe(0);
			expect(await page()).toEqual(first);
			expect(first.pagination.total).toBe(3);
		});

		test('soft-delete filters are part of the key and deletes invalidate', async () => {
			const { client } = createClient(
				createStore(),
				{},
				{ softDelete: true },
			);
			const visible = () => client.users.count({ cache: true });
			const all = () =>
				client.users.count({ cache: true, deleted: 'with' });

			expect(await visible()).toBe(3);
			expect(await all()).toBe(3);
			await client.users.delete({ where: { id: 3 } });
			expect(await visible()).toBe(2);
			expect(await all()).toBe(3);
		});

		test('after hooks see the cache status and can be skipped on hits', async () => {
			const statuses: unknown[] = [];
			const database = createDatabase();
			const client = better(database.db, {
				hooks: {
					afterQuery(context) {
						statuses.push(context.annotations?.cache);
					},
				},
				plugins: [
					cache({
						namespace: `test-${crypto.randomUUID()}`,
						store: createStore(),
						ttl: 60,
					}),
				],
			});
			const read = (afterHooks?: boolean) =>
				client.users.findMany({ cache: { afterHooks } });

			await read();
			await read();
			await read(false);
			await client.users.findMany();

			expect(statuses).toEqual(['miss', 'hit', undefined]);
		});

		test('prepared reads cache per value and invalidate by entity', async () => {
			const { client, count } = createClient(createStore());
			const byId = client.users
				.findUnique({ cache: true, where: { id: param('id') } })
				.prepare();
			const read = (id: number) => () => byId.execute({ id });

			expect(await count(read(1))).toBe(1);
			expect(await count(read(1))).toBe(0);
			expect(await count(read(2))).toBe(1);
			expect((await byId.execute({ id: 1 }))?.name).toBe('Ada');

			await client.users.update({
				data: { name: 'Ada L.' },
				where: { id: 1 },
			});
			expect(await count(read(1))).toBe(1);
			expect(await count(read(2))).toBe(0);
			expect((await byId.execute({ id: 1 }))?.name).toBe('Ada L.');
		});

		test('explain never reads or writes the cache', async () => {
			const { client, count } = createClient(createStore());
			await client.users.findMany({ cache: true }).explain();
			expect(
				await count(() => client.users.findMany({ cache: true })),
			).toBe(1);
		});
	});
};
