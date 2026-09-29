import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { DrizzleQueryError, defineRelations, isTable, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
	check,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core';

import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	better,
	definePlugin,
	getDatabaseErrorInfo,
	isCheckViolation,
	isForeignKeyViolation,
	isNotNullViolation,
	isUniqueViolation,
} from '../../src';
import { softDelete } from '../../src/plugins/soft-delete';

// Regression coverage for the move from drizzle-orm 0.x (relations(), schema
// option) to drizzle-orm 1.x (defineRelations, db._.relations).

const users = sqliteTable('v1_users', {
	createdAt: integer('created_at', { mode: 'timestamp' }),
	deletedAt: text('deleted_at'),
	email: text('email').notNull().unique(),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const profiles = sqliteTable('v1_profiles', {
	bio: text('bio').notNull(),
	id: integer('id').primaryKey(),
	userId: integer('user_id').references(() => users.id),
});

const posts = sqliteTable(
	'v1_posts',
	{
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id),
		id: integer('id').primaryKey(),
		reviewerId: integer('reviewer_id').references(() => users.id),
		score: integer('score').notNull(),
		title: text('title').notNull(),
	},
	(table) => [check('v1_posts_score_check', sql`${table.score} >= 0`)],
);

const groups = sqliteTable('v1_groups', {
	deletedAt: integer('deleted_at', { mode: 'timestamp' }),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const userGroups = sqliteTable(
	'v1_user_groups',
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

// Present in the database but deliberately left out of the relations config.
const auditLogs = sqliteTable('v1_audit_logs', {
	id: integer('id').primaryKey(),
	message: text('message').notNull(),
});

const schema = { groups, posts, profiles, userGroups, users };

const relations = defineRelations(schema, (r) => ({
	groups: {
		members: r.many.users({
			from: r.groups.id.through(r.userGroups.groupId),
			to: r.users.id.through(r.userGroups.userId),
		}),
	},
	posts: {
		author: r.one.users({
			alias: 'authored',
			from: r.posts.authorId,
			to: r.users.id,
		}),
		reviewer: r.one.users({
			alias: 'reviewed',
			from: r.posts.reviewerId,
			to: r.users.id,
		}),
	},
	profiles: {
		user: r.one.users({ from: r.profiles.userId, to: r.users.id }),
	},
	users: {
		firstGroup: r.one.groups({
			from: r.users.id.through(r.userGroups.userId),
			to: r.groups.id.through(r.userGroups.groupId),
		}),
		groups: r.many.groups({
			from: r.users.id.through(r.userGroups.userId),
			to: r.groups.id.through(r.userGroups.groupId),
		}),
		posts: r.many.posts({ alias: 'authored' }),
		profile: r.one.profiles({ from: r.users.id, to: r.profiles.userId }),
		reviews: r.many.posts({ alias: 'reviewed' }),
	},
}));

const createDatabase = () => {
	const sqlite = new Database(':memory:');

	sqlite.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE v1_users (
			id INTEGER PRIMARY KEY NOT NULL,
			email TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			created_at INTEGER,
			deleted_at TEXT
		);
		CREATE TABLE v1_profiles (
			id INTEGER PRIMARY KEY NOT NULL,
			user_id INTEGER REFERENCES v1_users(id),
			bio TEXT NOT NULL
		);
		CREATE TABLE v1_posts (
			id INTEGER PRIMARY KEY NOT NULL,
			author_id INTEGER NOT NULL REFERENCES v1_users(id),
			reviewer_id INTEGER REFERENCES v1_users(id),
			title TEXT NOT NULL,
			score INTEGER NOT NULL,
			CONSTRAINT v1_posts_score_check CHECK (score >= 0)
		);
		CREATE TABLE v1_groups (
			id INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			deleted_at INTEGER
		);
		CREATE TABLE v1_user_groups (
			user_id INTEGER NOT NULL REFERENCES v1_users(id),
			group_id INTEGER NOT NULL REFERENCES v1_groups(id),
			PRIMARY KEY (user_id, group_id)
		);
		CREATE TABLE v1_audit_logs (
			id INTEGER PRIMARY KEY NOT NULL,
			message TEXT NOT NULL
		);
		INSERT INTO v1_users (id, email, name) VALUES
			(1, 'alice@example.com', 'Alice'),
			(2, 'bob@example.com', 'Bob'),
			(3, 'carol@example.com', 'Carol');
		INSERT INTO v1_profiles (id, user_id, bio) VALUES
			(1, 1, 'Alice bio'),
			(2, NULL, 'Unclaimed');
		INSERT INTO v1_posts (id, author_id, reviewer_id, title, score) VALUES
			(1, 1, 2, 'Alice reviewed by Bob', 10),
			(2, 1, 3, 'Alice reviewed by Carol', 20),
			(3, 2, 1, 'Bob reviewed by Alice', 30),
			(4, 3, NULL, 'Carol unreviewed', 40);
		INSERT INTO v1_groups (id, name) VALUES (1, 'Admin'), (2, 'Editor');
		INSERT INTO v1_user_groups (user_id, group_id) VALUES (1, 1), (1, 2), (2, 2);
		INSERT INTO v1_audit_logs (id, message) VALUES (1, 'boot');
	`);

	return sqlite;
};

const createContext = () => {
	const sqlite = createDatabase();
	const db = drizzle({ client: sqlite, relations });

	return {
		client: better(db),
		db,
		sqlite,
		close() {
			sqlite.close();
		},
	};
};

const captureError = async (run: () => unknown) => {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error('Expected the call to throw.');
};

describe('bootstrap from the Drizzle instance', () => {
	test('a Drizzle instance without relations fails fast', () => {
		const sqlite = createDatabase();
		const error = (() => {
			try {
				better(drizzle({ client: sqlite }) as never);
			} catch (caught) {
				return caught;
			}
		})();

		expect(error).toBeInstanceOf(BetterDrizzleError);
		expect(error).toMatchObject({
			code: BetterDrizzleErrorCode.OperationError,
			message:
				'No tables found on the Drizzle instance. Pass your relations to drizzle(), e.g. drizzle({ client, relations: defineRelations(schema) }).',
			operation: 'bootstrap',
		});
		sqlite.close();
	});

	test('an empty relations config fails fast', () => {
		const sqlite = createDatabase();

		expect(() =>
			better(drizzle({ client: sqlite, relations: defineRelations({}) })),
		).toThrow('No tables found on the Drizzle instance.');
		sqlite.close();
	});

	test('better(db) without options exposes a delegate per relations table', () => {
		const ctx = createContext();

		for (const key of Object.keys(schema))
			expect(
				typeof (
					ctx.client as never as Record<
						string,
						{ findMany?: unknown }
					>
				)[key]?.findMany,
			).toBe('function');
		ctx.close();
	});

	test('defineRelations(schema) without a callback is enough', async () => {
		const sqlite = createDatabase();
		const client = better(
			drizzle({ client: sqlite, relations: defineRelations({ users }) }),
		);

		expect(await client.users.count()).toBe(3);
		sqlite.close();
	});

	test('tables outside the relations config have no delegate', async () => {
		const ctx = createContext();

		expect((ctx.client as never as Record<string, unknown>).auditLogs).toBe(
			undefined,
		);
		const error = await captureError(() =>
			ctx.client.repository('auditLogs' as never),
		);
		expect(error).toMatchObject({
			code: BetterDrizzleErrorCode.RepositoryNotFound,
		});
		// the raw Drizzle instance still reaches it
		expect(await ctx.db.select().from(auditLogs)).toHaveLength(1);
		ctx.close();
	});

	test('repository() resolves by table key and by database table name', async () => {
		const ctx = createContext();

		expect(ctx.client.repository('users')).toBe(ctx.client.users);
		expect(ctx.client.repository('v1_users' as never)).toBe(
			ctx.client.users as never,
		);
		ctx.close();
	});

	test('plugin setup receives the relations config as schema', () => {
		const sqlite = createDatabase();
		let seen: Record<string, unknown> | undefined;
		let modelNames: string[] = [];

		better(drizzle({ client: sqlite, relations }), {
			plugins: [
				definePlugin({
					id: 'inspect-schema',
					setup(context) {
						seen = context.schema as never;
						modelNames = Object.keys(context.models).sort();
					},
				}),
			],
		});

		expect(seen).toBe(relations as never);
		const entry = seen?.users as {
			name: string;
			relations: Record<string, unknown>;
			table: unknown;
		};
		expect(isTable(entry.table)).toBe(true);
		expect(entry.table).toBe(users);
		expect(entry.name).toBe('users');
		expect(Object.keys(entry.relations)).toContain('posts');
		// the schema module itself is not what plugins see anymore
		expect(isTable(seen?.users)).toBe(false);
		expect(modelNames).toEqual(Object.keys(schema).sort());
		sqlite.close();
	});
});

describe('relation metadata from defineRelations', () => {
	test('aliased relations between the same tables stay distinct', async () => {
		const ctx = createContext();

		const alice = await ctx.client.users.findUnique({
			include: {
				posts: { orderBy: { id: 'asc' } },
				reviews: { orderBy: { id: 'asc' } },
			},
			where: { id: 1 },
		});
		expect(alice?.posts.map((post) => post.id)).toEqual([1, 2]);
		expect(alice?.reviews.map((post) => post.id)).toEqual([3]);

		const post = await ctx.client.posts.findUnique({
			include: { author: true, reviewer: true },
			where: { id: 1 },
		});
		expect(post?.author.name).toBe('Alice');
		expect(post?.reviewer?.name).toBe('Bob');

		const unreviewed = await ctx.client.posts.findUnique({
			include: { reviewer: true },
			where: { id: 4 },
		});
		expect(unreviewed?.reviewer).toBeNull();
		ctx.close();
	});

	test('aliased relations filter and count against their own columns', async () => {
		const ctx = createContext();

		expect(
			await ctx.client.users.count({
				where: { reviews: { some: { score: { gte: 30 } } } },
			}),
		).toBe(1);
		expect(
			await ctx.client.posts.count({
				where: { reviewer: { is: { name: 'Carol' } } },
			}),
		).toBe(1);
		expect(
			await ctx.client.posts.count({
				where: { reviewer: { is: null } },
			}),
		).toBe(1);

		const counted = await ctx.client.users.findMany({
			include: { _count: { select: { posts: true, reviews: true } } },
			orderBy: { id: 'asc' },
		});
		expect(counted.map((user) => user._count)).toEqual([
			{ posts: 2, reviews: 1 },
			{ posts: 1, reviews: 1 },
			{ posts: 1, reviews: 1 },
		]);
		ctx.close();
	});

	test('one relation whose source columns are the primary key is the inverse side', async () => {
		const ctx = createContext();

		const alice = await ctx.client.users.findUnique({
			include: { profile: true },
			where: { id: 1 },
		});
		expect(alice?.profile?.bio).toBe('Alice bio');

		const bob = await ctx.client.users.findUnique({
			include: { profile: true },
			where: { id: 2 },
		});
		expect(bob?.profile).toBeNull();

		// connect writes the target's foreign key, never the user's primary key
		await ctx.client.users.update({
			data: { profile: { connect: { id: 2 } } },
			where: { id: 2 },
		});
		const [claimed] = await ctx.db
			.select()
			.from(profiles)
			.where(sql`${profiles.id} = 2`);
		expect(claimed?.userId).toBe(2);
		expect(
			await ctx.client.users.findUnique({ where: { id: 2 } }),
		).toMatchObject({ id: 2 });
		ctx.close();
	});

	test('one relation that owns the foreign key writes its source column', async () => {
		const ctx = createContext();

		await ctx.client.posts.update({
			data: { reviewer: { connect: { email: 'carol@example.com' } } },
			where: { id: 1 },
		});
		await ctx.client.posts.update({
			data: { reviewer: { disconnect: true } },
			where: { id: 2 },
		});

		const rows = await ctx.client.posts.findMany({
			orderBy: { id: 'asc' },
			select: { id: true, reviewerId: true },
			where: { id: { in: [1, 2] } },
		});
		expect(rows).toEqual([
			{ id: 1, reviewerId: 3 },
			{ id: 2, reviewerId: null },
		]);
		ctx.close();
	});

	test('create connects an aliased one relation', async () => {
		const ctx = createContext();

		const post = await ctx.client.posts.create({
			data: {
				author: { connect: { id: 3 } },
				reviewer: { connect: { id: 1 } },
				score: 5,
				title: 'Connected',
			},
		});
		expect(post).toMatchObject({ authorId: 3, reviewerId: 1 });
		ctx.close();
	});

	test('the inverse side of a through relation loads and filters', async () => {
		const ctx = createContext();

		const editor = await ctx.client.groups.findUnique({
			include: { members: { orderBy: { id: 'asc' } } },
			where: { id: 2 },
		});
		expect(editor?.members.map((user) => user.id)).toEqual([1, 2]);
		expect(
			await ctx.client.groups.count({
				where: { members: { every: { name: 'Alice' } } },
			}),
		).toBe(1);
		const counted = await ctx.client.groups.findMany({
			include: { _count: { select: { members: true } } },
			orderBy: { id: 'asc' },
		});
		expect(counted.map((group) => group._count.members)).toEqual([1, 2]);
		ctx.close();
	});
});

describe('relations the loader rejects', () => {
	test('one relations through a junction cannot be loaded or filtered', async () => {
		const ctx = createContext();

		const loadError = await captureError(() =>
			ctx.client.users.findMany({
				include: { firstGroup: true } as never,
			}),
		);
		expect(loadError).toMatchObject({
			code: BetterDrizzleErrorCode.OperationError,
			message:
				'Relation "firstGroup" on "v1_users" cannot be loaded: one relations through a junction table are not supported.',
		});

		const filterError = await captureError(() =>
			ctx.client.users.findMany({
				where: { firstGroup: { is: { id: 1 } } } as never,
			}),
		);
		expect((filterError as Error).message).toBe(
			'Relation "firstGroup" on "v1_users" cannot be filtered: one relations through a junction table are not supported.',
		);

		// the rest of the table keeps working
		expect(
			await ctx.client.users.count({
				where: { groups: { some: { id: 1 } } },
			}),
		).toBe(1);
		ctx.close();
	});

	test('filtered relations fail on select and _count as well', async () => {
		const sqlite = createDatabase();
		const filtered = defineRelations({ posts, users }, (r) => ({
			users: {
				bigPosts: r.many.posts({
					from: r.users.id,
					to: r.posts.authorId,
					where: { score: { gte: 20 } },
				}),
			},
		}));
		const client = better(drizzle({ client: sqlite, relations: filtered }));

		await expect(
			Promise.resolve(
				client.users.findMany({
					select: { bigPosts: true, id: true },
				} as never),
			),
		).rejects.toThrow(
			'cannot be loaded: filtered relations (relation-level where) are not supported',
		);
		await expect(
			Promise.resolve(
				client.users.findMany({
					include: { _count: { select: { bigPosts: true } } },
				} as never),
			),
		).rejects.toThrow('bigPosts');
		expect(await client.users.count()).toBe(3);
		sqlite.close();
	});
});

describe('driver errors wrapped in DrizzleQueryError', () => {
	test('raw Drizzle throws DrizzleQueryError with the driver error as cause', async () => {
		const ctx = createContext();

		const error = await captureError(() =>
			ctx.db.insert(users).values({
				email: 'alice@example.com',
				id: 99,
				name: 'Duplicate',
			}),
		);
		expect(error).toBeInstanceOf(DrizzleQueryError);
		expect((error as Error).message).toStartWith('Failed query:');
		expect(isUniqueViolation(error)).toBe(true);
		expect(getDatabaseErrorInfo(error)).toMatchObject({ driver: 'sqlite' });
		expect(getDatabaseErrorInfo(error).message).toContain(
			'UNIQUE constraint failed',
		);
		ctx.close();
	});

	test('constraint helpers classify real SQLite violations from delegates', async () => {
		const ctx = createContext();

		const unique = await captureError(() =>
			ctx.client.users.create({
				data: { email: 'alice@example.com', name: 'Dup' },
			}),
		);
		expect(isUniqueViolation(unique)).toBe(true);
		expect(isForeignKeyViolation(unique)).toBe(false);

		const foreignKey = await captureError(() =>
			ctx.client.posts.create({
				data: { authorId: 404, score: 1, title: 'Orphan' },
			}),
		);
		expect(isForeignKeyViolation(foreignKey)).toBe(true);
		expect(isUniqueViolation(foreignKey)).toBe(false);

		const notNull = await captureError(() =>
			ctx.client.users.create({
				data: { email: 'x@example.com', name: null as never },
			}),
		);
		expect(isNotNullViolation(notNull)).toBe(true);

		const checkError = await captureError(() =>
			ctx.client.posts.create({
				data: { authorId: 1, score: -1, title: 'Negative' },
			}),
		);
		expect(isCheckViolation(checkError)).toBe(true);
		ctx.close();
	});

	test('BetterDrizzleError.from unwraps the cause into database metadata', async () => {
		const ctx = createContext();

		const error = await captureError(() =>
			ctx.db.insert(users).values({
				email: 'bob@example.com',
				id: 98,
				name: 'Duplicate',
			}),
		);
		const normalized = BetterDrizzleError.from(error);
		expect(normalized.code).toBe(BetterDrizzleErrorCode.DatabaseError);
		expect(normalized.driver).toBe('sqlite');
		expect(normalized.cause).toBe(error);
		expect(normalized.message).toContain('UNIQUE constraint failed');
		ctx.close();
	});

	test('helpers still classify errors wrapped by operation hooks', async () => {
		const sqlite = createDatabase();
		const errors: unknown[] = [];
		const client = better(drizzle({ client: sqlite, relations }), {
			hooks: {
				onError(context) {
					errors.push(context.error);
				},
			},
		});

		const error = await captureError(() =>
			client.users.create({
				data: { email: 'alice@example.com', name: 'Dup' },
			}),
		);
		expect(error).toBeInstanceOf(BetterDrizzleError);
		expect(isUniqueViolation(error)).toBe(true);
		expect(errors).toHaveLength(1);
		sqlite.close();
	});

	test('helpers classify errors raised inside a transaction', async () => {
		const ctx = createContext();

		const error = await captureError(() =>
			ctx.client.transaction(async (tx) => {
				await tx.users.create({
					data: { email: 'new@example.com', name: 'New' },
				});
				await tx.users.create({
					data: { email: 'alice@example.com', name: 'Dup' },
				});
			}),
		);
		expect(isUniqueViolation(error)).toBe(true);
		expect(await ctx.client.users.count()).toBe(3);
		ctx.close();
	});

	test('helpers classify errors from raw SQL', async () => {
		const ctx = createContext();

		const error = await captureError(
			() =>
				ctx.client
					.$executeRaw`insert into v1_users (id, email, name) values (50, 'alice@example.com', 'Dup')`,
		);
		expect(isUniqueViolation(error)).toBe(true);
		ctx.close();
	});

	test('library error codes survive operation hooks', async () => {
		const sqlite = createDatabase();
		const client = better(drizzle({ client: sqlite, relations }), {
			hooks: { beforeQuery() {} },
		});

		const error = await captureError(() =>
			client.users.findMany({ lock: 'update' }),
		);
		expect(error).toMatchObject({
			code: BetterDrizzleErrorCode.LockNotSupported,
		});
		sqlite.close();
	});

	test('helpers classify PostgreSQL errors wrapped by operation hooks', () => {
		// A PostgreSQL driver error only carries its SQLSTATE as `code`, under
		// both the hook wrapper and the DrizzleQueryError.
		const driverError = Object.assign(
			new Error(
				'duplicate key value violates unique constraint "users_email_key"',
			),
			{ code: '23505', constraint: 'users_email_key' },
		);
		const wrapped = BetterDrizzleError.from(
			new DrizzleQueryError('insert into "users"', [], driverError),
			{
				code: BetterDrizzleErrorCode.OperationError,
				operation: 'create',
			},
		);

		expect(isUniqueViolation(wrapped, 'users_email_key')).toBe(true);
	});
});

describe('transactions on Bun SQLite', () => {
	test('async callbacks commit after awaited work', async () => {
		const ctx = createContext();

		const created = await ctx.client.transaction(async (tx) => {
			await Promise.resolve();
			const user = await tx.users.create({
				data: { email: 'async@example.com', name: 'Async' },
			});
			await new Promise((resolve) => setTimeout(resolve, 1));
			await tx.posts.create({
				data: { authorId: user.id, score: 1, title: 'Async post' },
			});
			return user;
		});

		expect(
			await ctx.client.posts.count({ where: { authorId: created.id } }),
		).toBe(1);
		ctx.close();
	});

	test('a thrown driver error rolls back every awaited write', async () => {
		const ctx = createContext();

		await captureError(() =>
			ctx.client.transaction(async (tx) => {
				await tx.users.create({
					data: { email: 'gone@example.com', name: 'Gone' },
				});
				await new Promise((resolve) => setTimeout(resolve, 1));
				await tx.posts.create({
					data: { authorId: 404, score: 1, title: 'Orphan' },
				});
			}),
		);

		expect(
			await ctx.client.users.exists({
				where: { email: 'gone@example.com' },
			}),
		).toBe(false);
		ctx.close();
	});

	test('nested savepoints roll back independently', async () => {
		const ctx = createContext();

		await ctx.client.transaction(async (tx) => {
			await tx.users.create({
				data: { email: 'outer@example.com', name: 'Outer' },
			});
			await captureError(() =>
				tx.transaction(async (inner) => {
					await inner.users.create({
						data: { email: 'inner@example.com', name: 'Inner' },
					});
					inner.rollback();
				}),
			);
		});

		expect(
			await ctx.client.users.exists({
				where: { email: 'outer@example.com' },
			}),
		).toBe(true);
		expect(
			await ctx.client.users.exists({
				where: { email: 'inner@example.com' },
			}),
		).toBe(false);
		ctx.close();
	});

	test('retries a deadlock reported through DrizzleQueryError', async () => {
		const ctx = createContext();
		let attempts = 0;

		await ctx.client.transaction(
			async () => {
				attempts += 1;
				if (attempts === 1)
					throw new DrizzleQueryError(
						'update "accounts" set ...',
						[],
						Object.assign(new Error('deadlock detected'), {
							code: '40P01',
						}),
					);
			},
			{ retries: { attempts: 2, on: ['deadlock'] } },
		);

		expect(attempts).toBe(2);
		ctx.close();
	});
});

describe('lazy reads', () => {
	const createCountingClient = () => {
		const sqlite = createDatabase();
		const calls: string[] = [];
		const client = better(drizzle({ client: sqlite, relations }), {
			hooks: {
				beforeQuery(context) {
					calls.push(context.action);
				},
			},
		});

		return { calls, client, sqlite };
	};

	test('a read that is never awaited does not run', async () => {
		const { calls, client, sqlite } = createCountingClient();

		client.users.findMany();
		client.users.count();
		client.posts.paginate({ limit: 2 });
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(calls).toEqual([]);
		sqlite.close();
	});

	test('a read runs once, however many times it is awaited', async () => {
		const { calls, client, sqlite } = createCountingClient();

		const read = client.users.findMany({ where: { id: 1 } });
		const [first, second] = await Promise.all([read, read]);
		const third = await read;

		expect(first).toBe(second);
		expect(third).toBe(first);
		expect(calls).toEqual(['findMany']);
		sqlite.close();
	});

	test('explain() alone does not run the read or its hooks', async () => {
		const { calls, client, sqlite } = createCountingClient();

		const read = client.users.findMany({ where: { id: 1 } });
		const plan = await read.explain();

		expect(plan.statements.length).toBeGreaterThan(0);
		expect(calls).toEqual([]);
		expect(await read).toHaveLength(1);
		expect(calls).toEqual(['findMany']);
		sqlite.close();
	});

	test('reads behave like promises for then, catch, and finally', async () => {
		const sqlite = createDatabase();
		const client = better(drizzle({ client: sqlite, relations }));

		const read = client.users.findUnique({ where: { id: 1 } });
		expect(read).toBeInstanceOf(Promise);
		expect(await read.then((user) => user?.name)).toBe('Alice');

		let finished = false;
		await client.users
			.findMany({ where: { email: { contains: 'a' } } })
			.finally(() => {
				finished = true;
			});
		expect(finished).toBe(true);

		const failed = await client.users
			.findMany({ lock: 'update' })
			.catch((error: unknown) => error);
		expect(failed).toMatchObject({
			code: BetterDrizzleErrorCode.LockNotSupported,
		});
		sqlite.close();
	});

	test('native promise matchers need Promise.resolve', async () => {
		const sqlite = createDatabase();
		const client = better(drizzle({ client: sqlite, relations }));

		await expect(
			Promise.resolve(client.users.findMany({ lock: 'update' })),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.LockNotSupported,
		});
		await expect(Promise.resolve(client.users.count())).resolves.toBe(3);
		sqlite.close();
	});
});

describe('column metadata with "<type> <constraint>" dataType', () => {
	const requireColumn = (column: string, type: string) => {
		const sqlite = createDatabase();
		try {
			better(drizzle({ client: sqlite, relations }), {
				plugins: [
					definePlugin({
						config: {
							requires: {
								columns: [{ column, optional: true, type }],
							},
						},
						id: 'requires-type',
					}),
				],
			});
			return null;
		} catch (error) {
			return error;
		} finally {
			sqlite.close();
		}
	};

	test('requires.columns matches columnType, full dataType, or one part', () => {
		expect(requireColumn('createdAt', 'SQLiteTimestamp')).toBeNull();
		expect(requireColumn('createdAt', 'object date')).toBeNull();
		expect(requireColumn('createdAt', 'date')).toBeNull();
		expect(requireColumn('createdAt', 'object')).toBeNull();
		expect(requireColumn('email', 'string')).toBeNull();
		expect(requireColumn('id', 'number')).toBeNull();
		expect(requireColumn('id', 'int53')).toBeNull();
	});

	test('requires.columns rejects a type that matches no part', () => {
		expect(requireColumn('createdAt', 'string')).toMatchObject({
			code: BetterDrizzleErrorCode.PluginRequiredColumnType,
		});
		expect(requireColumn('createdAt', 'dat')).toMatchObject({
			code: BetterDrizzleErrorCode.PluginRequiredColumnType,
		});
		expect(requireColumn('deletedAt', 'object date')).toMatchObject({
			code: BetterDrizzleErrorCode.PluginRequiredColumnType,
		});
	});

	test('models expose the Drizzle 1.x dataType to plugins', () => {
		const sqlite = createDatabase();
		let dataTypes: Record<string, string> = {};

		better(drizzle({ client: sqlite, relations }), {
			plugins: [
				definePlugin({
					id: 'data-types',
					setup(context) {
						const columns = context.models.users?.columns ?? {};
						dataTypes = Object.fromEntries(
							Object.entries(columns).map(([key, column]) => [
								key,
								(column as { dataType: string }).dataType,
							]),
						);
					},
				}),
			],
		});

		expect(dataTypes).toMatchObject({
			createdAt: 'object date',
			deletedAt: 'string',
			email: 'string',
			id: 'number int53',
		});
		sqlite.close();
	});

	test('soft delete writes ISO strings to text columns and Dates to timestamp columns', async () => {
		const ctx = createContext();
		const client = better(ctx.db, { plugins: [softDelete()] });

		await client.users.delete({ where: { id: 3 } });
		await client.groups.delete({ where: { id: 1 } });

		const [user] = ctx.sqlite
			.query('select deleted_at from v1_users where id = 3')
			.all() as { deleted_at: string }[];
		expect(user?.deleted_at).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
		);

		const [group] = ctx.sqlite
			.query('select deleted_at from v1_groups where id = 1')
			.all() as { deleted_at: number }[];
		expect(typeof group?.deleted_at).toBe('number');

		const deletedGroup = await client.groups.findUnique({
			deleted: 'only',
			where: { id: 1 },
		});
		expect(deletedGroup?.deletedAt).toBeInstanceOf(Date);
		expect(await client.users.count()).toBe(2);
		ctx.close();
	});
});

describe('JSON path filters outside PostgreSQL', () => {
	const createDocs = () => {
		const sqlite = new Database(':memory:');
		sqlite.exec(
			`create table v1_docs (id integer primary key, data text); insert into v1_docs values (1, '{"a":{"b":1}}');`,
		);
		const docs = sqliteTable('v1_docs', {
			data: text('data', { mode: 'json' }).$type<{ a: { b: number } }>(),
			id: integer('id').primaryKey(),
		});
		const client = better(
			drizzle({ client: sqlite, relations: defineRelations({ docs }) }),
		);
		return { client, sqlite };
	};

	test('the { json } wrapper fails fast on SQLite', async () => {
		const { client, sqlite } = createDocs();

		const error = await captureError(() =>
			client.docs.findMany({
				where: { data: { json: { 'a.b': { equals: 1 } } } } as never,
			}),
		);
		expect(error).toMatchObject({
			code: BetterDrizzleErrorCode.JsonbQueryUnsupported,
			message: 'JSONB path filters are only supported by PostgreSQL.',
		});
		sqlite.close();
	});

	test('dotted keys on a non-jsonb column are whole-document equality', async () => {
		const { client, sqlite } = createDocs();

		// the shorthand is reserved for PostgreSQL jsonb columns
		expect(
			await client.docs.findMany({
				where: { data: { 'a.b': { equals: 1 } } } as never,
			}),
		).toEqual([]);
		expect(
			await client.docs.count({ where: { data: { a: { b: 1 } } } }),
		).toBe(1);
		sqlite.close();
	});
});
