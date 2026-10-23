import { describe, expect, test } from 'bun:test';

import {
	BetterDrizzleError,
	definePlugin,
	isUniqueViolation,
} from 'better-drizzle';
import { adapter } from 'better-drizzle/auth';
import { cache } from 'better-drizzle/cache';
import { softDelete } from 'better-drizzle/soft-delete';
import { tenant } from 'better-drizzle/tenant';
import { timestamps } from 'better-drizzle/timestamps';
import { uuids } from 'better-drizzle/uuid';
import { defineRelations } from 'drizzle-orm';

import { createMemoryStore } from '../cache/memory-store';
import { createAuth, schema, signUp } from './fixture';

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const getSession = (
	auth: ReturnType<typeof createAuth>['auth'],
	cookie: string,
) => auth.api.getSession({ headers: new Headers({ cookie }) });

describe('better-drizzle/auth', () => {
	test('sign-up, sign-in, session, and sign-out run end to end', async () => {
		const { auth, db } = createAuth();
		const { cookie } = await signUp(auth);

		const session = await getSession(auth, cookie);
		expect(session?.user.email).toBe('ada@example.com');

		const signIn = await auth.api.signInEmail({
			asResponse: true,
			body: {
				email: 'ada@example.com',
				password: 'correct horse battery',
			},
		});
		expect(signIn.status).toBe(200);
		expect(await db.session.count()).toBe(2);

		await auth.api.signOut({ headers: new Headers({ cookie }) });
		expect(await getSession(auth, cookie)).toBeNull();
		expect(await db.session.count()).toBe(1);
		expect(
			await db.account.count({ where: { providerId: 'credential' } }),
		).toBe(1);
	});

	test('reads sessions with their user through one batched join', async () => {
		const { auth, queries } = createAuth({
			auth: { advanced: { database: { joins: true } } },
		});
		const { cookie } = await signUp(auth);
		queries.length = 0;

		const session = await getSession(auth, cookie);

		expect(session?.user.name).toBe('Ada');
		expect(queries).toHaveLength(2);
		expect(queries[0]).toContain('from "session"');
		expect(queries[1]).toContain('from "user"');
	});

	test('a join without a matching relation fails with INVALID_ARGS', async () => {
		const { db } = createAuth({ relations: defineRelations(schema) });
		const instance = adapter(db)({
			advanced: { database: { joins: true } },
		});

		const error = await instance
			.findOne({
				join: { user: true },
				model: 'session',
				where: [{ field: 'token', value: 'missing' }],
			})
			.catch((error) => error);
		expect(error).toBeInstanceOf(BetterDrizzleError);
		expect(error.code).toBe('INVALID_ARGS');
		expect(error.message).toContain('No relation from "session" to "user"');
	});

	test('auth writes run through timestamps and uuid plugins', async () => {
		const now = new Date('2030-01-01T00:00:00.000Z');
		const { auth, db } = createAuth({
			plugins: [uuids(), timestamps({ now: () => now })],
		});
		await signUp(auth);

		const user = await db.user.findFirst({
			where: { email: 'ada@example.com' },
		});
		expect(user?.id).toMatch(UUID);
		expect(user?.createdAt).toEqual(now);
		const [session] = await db.session.findMany();
		expect(session?.id).toMatch(UUID);
		expect(session?.userId).toBe(user?.id as string);
		expect(session?.updatedAt).toEqual(now);
	});

	test('auth reads skip the cache unless enabled, and writes invalidate it', async () => {
		const memory = createMemoryStore();
		const plugins = [
			cache({ enabled: true, store: memory.store, ttl: 60 }),
		];
		const { auth, db } = createAuth({ plugins });
		const { cookie } = await signUp(auth);
		const reads = memory.calls.get;

		await getSession(auth, cookie);
		expect(memory.calls.get).toBe(reads);

		const cached = await db.session.count();
		expect(cached).toBe(1);
		await auth.api.signOut({ headers: new Headers({ cookie }) });
		expect(await db.session.count()).toBe(0);

		const enabled = createAuth({ adapter: { cache: true }, plugins });
		const { cookie: other } = await signUp(enabled.auth);
		const before = memory.calls.get;
		await getSession(enabled.auth, other);
		expect(memory.calls.get).toBeGreaterThan(before);
	});

	test('soft-deleted users cannot sign in', async () => {
		const { auth, db } = createAuth({ plugins: [softDelete()] });
		await signUp(auth);

		await db.user.delete({ where: { email: 'ada@example.com' } });

		const signIn = await auth.api
			.signInEmail({
				body: {
					email: 'ada@example.com',
					password: 'correct horse battery',
				},
			})
			.catch((error) => error);
		expect(signIn.status).toBe('UNAUTHORIZED');
		expect(await db.user.count({ deleted: 'with' })).toBe(1);
	});

	test('tenant-scoped auth tables fail when Better Auth initializes', async () => {
		const global = ['account', 'session', 'verification'] as const;

		const scoped = createAuth({
			plugins: [tenant({ columns: 'organizationId', global })],
		});
		await expect(scoped.auth.$context).rejects.toThrow(
			'The Better Auth table "user" is scoped by tenant()',
		);

		const { auth } = createAuth({
			plugins: [
				tenant({
					columns: 'organizationId',
					global: [...global, 'user'],
				}),
			],
		});
		expect(await auth.$context).toBeDefined();
		await signUp(auth);
	});

	test('meta reaches client hooks and failures arrive as BetterDrizzleError', async () => {
		const seen: unknown[] = [];
		const { auth } = createAuth({
			adapter: { meta: { source: 'better-auth' } },
			plugins: [
				definePlugin({
					id: 'test/meta',
					setup({ addHook }) {
						addHook({
							beforeCreate(operation) {
								seen.push(operation.meta);
								return operation.data;
							},
						});
					},
				}),
			],
		});
		await signUp(auth);
		expect(seen).toContainEqual({ source: 'better-auth' });

		const { db } = createAuth();
		const instance = adapter(db)({});
		await instance.create({
			data: { email: 'a@b.c', emailVerified: false, name: 'A' },
			model: 'user',
		});
		const error = await instance
			.create({
				data: { email: 'a@b.c', emailVerified: false, name: 'B' },
				model: 'user',
			})
			.catch((error) => error);
		expect(error).toBeInstanceOf(BetterDrizzleError);
		expect(error.code).toBe('DATABASE_ERROR');
		expect(isUniqueViolation(error)).toBe(true);
	});

	test('delete and consumeOne return nothing for a missing row', async () => {
		const { db } = createAuth();
		const instance = adapter(db)({});
		const where = [{ field: 'id', value: 'missing' }];

		expect(await instance.delete({ model: 'user', where })).toBeUndefined();
		expect(
			await instance.consumeOne({ model: 'verification', where }),
		).toBeNull();
	});

	test('ends_with matches literally', async () => {
		const { db } = createAuth();
		const instance = adapter(db)({});
		for (const email of ['a@x_y.com', 'b@xzy.com'])
			await instance.create({
				data: { email, emailVerified: false, name: 'A' },
				model: 'user',
			});

		const rows = await instance.findMany<{ email: string }>({
			model: 'user',
			where: [{ field: 'email', operator: 'ends_with', value: '_y.com' }],
		});
		expect(rows.map((row) => row.email)).toEqual(['a@x_y.com']);
	});

	test('edge cases in where clauses', async () => {
		const { db } = createAuth();
		const instance = adapter(db)({
			user: { additionalFields: { metadata: { type: 'json' } } },
		});
		for (const [email, metadata] of [
			['a@x.com', { in: 1 }],
			['b@x.com', { plan: 'pro' }],
		] as const)
			await instance.create({
				data: { email, emailVerified: false, metadata, name: 'A' },
				model: 'user',
			});

		const emails = async (
			where: Parameters<typeof instance.findMany>[0]['where'],
		) =>
			(
				await instance.findMany<{ email: string }>({
					model: 'user',
					where,
				})
			).map((row) => row.email);

		// A JSON value with filter-like keys is compared as a value.
		expect(await emails([{ field: 'metadata', value: { in: 1 } }])).toEqual(
			['a@x.com'],
		);
		expect(
			await emails([
				{ field: 'metadata', operator: 'ne', value: { in: 1 } },
			]),
		).toEqual(['b@x.com']);
		// Empty lists match nothing, or everything for not_in.
		expect(
			await emails([{ field: 'email', operator: 'in', value: [] }]),
		).toEqual([]);
		expect(
			await emails([
				{
					field: 'email',
					mode: 'insensitive',
					operator: 'in',
					value: [],
				},
			]),
		).toEqual([]);
		expect(
			await emails([{ field: 'email', operator: 'not_in', value: [] }]),
		).toHaveLength(2);
		// Object prototype keys are not columns.
		const error = await emails([
			{ field: 'constructor', value: 'x' },
		]).catch((error) => error);
		expect(error).toBeInstanceOf(BetterDrizzleError);
		expect(error.code).toBe('INVALID_ARGS');
	});

	test.each(['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const)(
		'a where clause with an undefined value fails with INVALID_ARGS for %s',
		async (operator) => {
			const { db } = createAuth();
			const instance = adapter(db)({});

			const error = await instance
				.findOne({
					model: 'account',
					where: [
						{ field: 'providerId', value: 'google' },
						{
							field: 'accountId',
							operator,
							value: undefined as never,
						},
					],
				})
				.catch((error) => error);
			expect(error).toBeInstanceOf(BetterDrizzleError);
			expect(error.code).toBe('INVALID_ARGS');
		},
	);

	test('a failed tenant check is reported again on the next initialization', async () => {
		const global = ['account', 'session', 'verification'] as const;
		const { auth, db } = createAuth({
			plugins: [tenant({ columns: 'organizationId', global })],
		});
		await auth.$context.catch(() => {});
		const factory = adapter(db);

		expect(() => factory({})).toThrow('is scoped by tenant()');
		expect(() => factory({})).toThrow('is scoped by tenant()');
	});

	test('usePlural is detected from plural table keys', () => {
		const { db } = createAuth({
			relations: defineRelations({
				accounts: schema.account,
				sessions: schema.session,
				users: schema.user,
				verifications: schema.verification,
			}),
		});
		expect(adapter(db)({}).options?.adapterConfig.usePlural).toBe(true);
	});
});
