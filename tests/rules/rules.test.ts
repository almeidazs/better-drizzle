import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { better } from 'better-drizzle';
import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { merge, rules, safe } from '../../src/plugins/rules';
import { tenant } from '../../src/plugins/tenant';
import { createTestContext } from '../core/setup';

const accounts = sqliteTable('rule_accounts', {
	id: integer('id').primaryKey(),
	tenantId: text('tenant_id').notNull(),
	password: text('password').notNull(),
	name: text('name').notNull(),
});
const notes = sqliteTable('rule_notes', {
	id: integer('id').primaryKey(),
	accountId: integer('account_id').notNull(),
	tenantId: text('tenant_id').notNull(),
	secret: text('secret').notNull(),
});
const ruleRelations = defineRelations({ accounts, notes }, (r) => ({
	accounts: { notes: r.many.notes() },
	notes: {
		account: r.one.accounts({ from: r.notes.accountId, to: r.accounts.id }),
	},
}));

const createScopedRulesContext = (
	pluginOptions: Parameters<typeof rules>[0],
) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(
		'CREATE TABLE rule_accounts (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL); CREATE TABLE rule_notes (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, tenant_id TEXT NOT NULL, secret TEXT NOT NULL);',
	);
	sqlite.exec(
		"INSERT INTO rule_accounts VALUES (1, 'tenant-a', 'hash', 'Ada'); INSERT INTO rule_notes VALUES (1, 1, 'tenant-a', 'private');",
	);
	const client = better(
		drizzle({ client: sqlite, relations: ruleRelations }),
		{
			plugins: [tenant({ columns: 'tenantId' }), rules(pluginOptions)],
		},
	);
	return { client, close: () => sqlite.close() };
};

const createRulesContext = (pluginOptions: Parameters<typeof rules>[0]) => {
	const base = createTestContext();
	const client = better(base.raw, {
		plugins: [rules(pluginOptions)],
		raw: {
			allowUnsafe: true,
		},
	});

	return {
		...base,
		client,
	};
};

describe('better-drizzle/rules', () => {
	test('boolean rules normalize true to error', async () => {
		const ctx = createRulesContext({
			noRawUnsafe: true,
		});

		await expect(
			ctx.client.$rawUnsafe('select id from test_users'),
		).rejects.toThrow('rawUnsafe is not allowed.');

		ctx.close();
	});

	test('warn rules report without throwing', async () => {
		const violations: string[] = [];
		const ctx = createRulesContext({
			noRawUnsafe: 'warn',
			reporter: {
				warn(violation) {
					violations.push(violation.rule);
				},
			},
		});

		await expect(
			ctx.client.$rawUnsafe<{ id: number }>('select id from test_users'),
		).resolves.toEqual([
			{ id: 1 },
			{ id: 2 },
			{ id: 3 },
			{ id: 4 },
			{ id: 5 },
		]);
		expect(violations).toEqual(['noRawUnsafe']);

		ctx.close();
	});

	test('guards destructive writes without where', async () => {
		const ctx = createRulesContext({
			noUpdateManyWithoutWhere: true,
		});

		await expect(
			ctx.client.users.updateMany({
				data: { active: false },
			}),
		).rejects.toThrow('updateMany requires a where clause.');

		ctx.close();
	});

	test('treats empty where as violation when configured', async () => {
		const ctx = createRulesContext({
			noEmptyWhere: {
				level: 'error',
				operations: ['update'],
				treatEmptyAndOrAsEmpty: true,
				treatUndefinedAsEmpty: true,
			},
		});

		await expect(
			ctx.client.users.update({
				data: { active: false },
				where: {},
			}),
		).rejects.toThrow('The where clause is empty.');

		ctx.close();
	});

	test('enforces maxLimit and orderBy for pagination', async () => {
		const ctx = createRulesContext({
			maxLimit: {
				level: 'error',
				value: 1,
			},
			requireOrderByForPagination: true,
		});

		await expect(
			Promise.resolve(
				ctx.client.users.findMany({
					limit: 2,
				}),
			),
		).rejects.toThrow('The requested limit 2 exceeds the maximum 1.');

		await expect(
			Promise.resolve(
				ctx.client.users.paginate({
					limit: 1,
				}),
			),
		).rejects.toThrow('paginate requires orderBy.');

		ctx.close();
	});

	test('checks cursor lock prerequisites', async () => {
		const ctx = createRulesContext({
			requireLimitForSkipLocked: true,
			requireOrderByForSkipLocked: true,
			noInvalidLockCombination: true,
			requireTransactionForLock: true,
		});

		await expect(
			Promise.resolve(
				ctx.client.users.findMany({
					lock: {
						mode: 'forUpdate',
						skipLocked: true,
					},
					orderBy: {
						id: 'asc',
					},
				}),
			),
		).rejects.toThrow('Row locks require an active transaction.');

		await expect(
			Promise.resolve(
				ctx.client.transaction((tx) =>
					tx.users.findMany({
						lock: {
							mode: 'forUpdate',
							noWait: true,
							skipLocked: true,
						},
						orderBy: {
							id: 'asc',
						},
					}),
				),
			),
		).rejects.toThrow('skipLocked and noWait cannot be used together.');

		await expect(
			Promise.resolve(
				ctx.client.transaction((tx) =>
					tx.users.findMany({
						lock: {
							mode: 'forUpdate',
							skipLocked: true,
						},
					}),
				),
			),
		).rejects.toThrow('skipLocked requires orderBy.');

		ctx.close();
	});

	test('enforces include limits', async () => {
		const ctx = createRulesContext({
			maxIncludeDepth: {
				level: 'error',
				value: 1,
			},
			maxIncludeRelations: {
				level: 'error',
				value: 1,
			},
		});

		await expect(
			Promise.resolve(
				ctx.client.users.findMany({
					include: {
						posts: {
							with: {
								comments: true,
							},
						},
					},
				}),
			),
		).rejects.toThrow('include depth 2 exceeds the maximum 1.');

		await expect(
			Promise.resolve(
				ctx.client.posts.findMany({
					include: {
						author: true,
						comments: true,
					},
				}),
			),
		).rejects.toThrow('include relation count 2 exceeds the maximum 1.');

		ctx.close();
	});

	test('requires a query comment', async () => {
		const ctx = createRulesContext({
			requireQueryComment: { level: 'error', minLength: 5 },
		});

		await expect(
			Promise.resolve(ctx.client.posts.findMany()),
		).rejects.toThrow('Queries require a comment.');
		await expect(
			Promise.resolve(ctx.client.posts.findMany({ comment: 'ab' })),
		).rejects.toThrow('Queries require a comment.');
		await expect(
			Promise.resolve(
				ctx.client.posts.findMany({ comment: 'posts.list' }),
			),
		).resolves.toBeDefined();

		ctx.close();
	});

	test('the client comment default satisfies requireQueryComment', async () => {
		const base = createTestContext();
		const client = better(base.raw, {
			comment: 'app=test',
			plugins: [rules({ requireQueryComment: 'error' })],
		});

		await expect(
			Promise.resolve(client.posts.findMany()),
		).resolves.toBeDefined();

		base.close();
	});

	test('validates raw comment and timeout', async () => {
		const ctx = createRulesContext({
			requireRawComment: {
				level: 'error',
				minLength: 5,
			},
			requireRawTimeout: {
				level: 'error',
				maxTimeoutMs: 10,
			},
		});

		await expect(
			ctx.client.$rawUnsafe('select id from test_users', [], {
				timeoutMs: 5,
			}),
		).rejects.toThrow('Raw queries require a comment.');

		await expect(
			ctx.client.$rawUnsafe('select id from test_users', [], {
				comment: 'valid-comment',
				timeoutMs: 20,
			}),
		).rejects.toThrow('Raw timeout 20ms exceeds the maximum 10ms.');

		ctx.close();
	});

	test('blocks raw mutations outside transactions when configured', async () => {
		const ctx = createRulesContext({
			noRawMutation: true,
			noRawWithoutTransaction: {
				level: 'error',
				onlyMutations: true,
			},
		});

		await expect(
			ctx.client.$rawUnsafe('update test_users set active = 1'),
		).rejects.toThrow('Raw mutation queries are not allowed.');

		ctx.close();
	});

	test('raw rules also cover $executeRaw', async () => {
		const ctx = createRulesContext({ noRawMutation: true });

		await expect(
			ctx.client.$executeRaw`update test_users set active = 1`,
		).rejects.toThrow('Raw mutation queries are not allowed.');

		ctx.close();
	});

	test('detects mutations after comments, in CTEs, and after allowed statements', async () => {
		const ctx = createRulesContext({
			noRawMutation: { allow: ['create extension'] },
		});
		for (const query of [
			'-- comment\nUPDATE test_users SET active = 0',
			'WITH changed AS (DELETE FROM test_users RETURNING id) SELECT id FROM changed',
			'SELECT id FROM test_users; DELETE FROM test_users',
			'CREATE extensionsomething test_users',
		]) {
			await expect(ctx.client.$rawUnsafe(query)).rejects.toThrow(
				'Raw mutation queries are not allowed.',
			);
		}
		await expect(
			ctx.client.$rawUnsafe(
				"SELECT 'DELETE FROM test_users' AS statement",
			),
		).resolves.toEqual([{ statement: 'DELETE FROM test_users' }]);
		await expect(
			ctx.client.$rawUnsafe('/* DELETE */ SELECT id FROM test_users'),
		).resolves.toHaveLength(5);
		ctx.close();
	});

	test('uses tenant scope and rejects empty write filters and batch overrides', async () => {
		const ctx = createScopedRulesContext({
			requireTenantContext: true,
			requireTenantOnUpdate: true,
			requireTenantOnDelete: true,
			noTenantColumnOverride: true,
			noSensitiveSelect: false,
		});
		const scoped = ctx.client.$tenant({ tenantId: 'tenant-a' });
		await expect(
			Promise.resolve(scoped.accounts.findMany({ select: { id: true } })),
		).resolves.toEqual([{ id: 1 }]);
		const spoofed = scoped.$withContext({ tenantId: 'tenant-b' });
		await expect(
			spoofed.accounts.createMany({
				data: [
					{
						id: 2,
						name: 'B',
						password: 'hash',
						tenantId: 'tenant-b',
					},
				],
			}),
		).rejects.toThrow('Overriding tenantId is not allowed.');
		await expect(
			scoped.accounts.updateMany({
				data: { name: 'Changed' },
				where: {},
			}),
		).rejects.toThrow('Update operations require tenant scoping.');
		await expect(scoped.accounts.deleteMany({ where: {} })).rejects.toThrow(
			'Delete operations require tenant scoping.',
		);
		await expect(
			scoped.accounts.createMany({
				data: [
					{
						id: 2,
						name: 'B',
						password: 'hash',
						tenantId: 'tenant-b',
					},
				],
			}),
		).rejects.toThrow('Overriding tenantId is not allowed.');
		ctx.close();
	});

	test('checks default, nested, filter, sort and cursor access to sensitive fields', async () => {
		const ctx = createScopedRulesContext({ noSensitiveSelect: true });
		const scoped = ctx.client.$tenant({ tenantId: 'tenant-a' });
		for (const query of [
			{},
			{ select: { password: true } },
			{ select: { id: true }, where: { password: 'hash' } },
			{ select: { id: true }, orderBy: { password: 'asc' } },
			{ select: { id: true }, cursor: { password: 'hash' } },
			{ select: { id: true }, include: { notes: true } },
			{
				select: { id: true },
				where: { notes: { some: { secret: 'private' } } },
			},
			{
				select: { id: true },
				include: { notes: { select: { secret: true } } },
			},
		]) {
			await expect(
				Promise.resolve(scoped.accounts.findMany(query as never)),
			).rejects.toThrow('sensitive field');
		}
		await expect(
			Promise.resolve(
				scoped.accounts.findMany({ select: { id: true, name: true } }),
			),
		).resolves.toEqual([{ id: 1, name: 'Ada' }]);
		await expect(
			Promise.resolve(
				scoped.accounts.findMany({
					select: { id: true },
					where: { notes: { some: { id: 1 } } },
				}),
			),
		).resolves.toEqual([{ id: 1 }]);
		ctx.close();
	});

	test('requires a reason for implicit sensitive access with opt-in', async () => {
		const ctx = createScopedRulesContext({
			noSensitiveSelect: { allowWithSensitive: true },
			requireExplicitSensitiveAccessReason: true,
		});
		const scoped = ctx.client.$tenant({ tenantId: 'tenant-a' });
		await expect(
			Promise.resolve(
				scoped.accounts.findMany({ withSensitive: true } as never),
			),
		).rejects.toThrow('Sensitive access requires an explicit reason.');
		ctx.close();
	});

	test('requires tenant context and protects tenant overrides', async () => {
		const ctx = createRulesContext({
			requireTenantContext: true,
			noTenantColumnOverride: true,
		});

		await expect(
			Promise.resolve(
				ctx.client.users.findMany({
					where: {
						id: 1,
					},
				}),
			),
		).rejects.toThrow('Tenant context "tenantId" is required.');

		const scoped = ctx.client.$withContext({
			tenantId: 'tenant-a',
		});

		await expect(
			scoped.users.create({
				data: {
					active: true,
					age: 99,
					email: 'tenant@example.com',
					id: 99,
					name: 'Tenant',
					tenantId: 'tenant-b',
				} as never,
			}),
		).rejects.toThrow('Overriding tenantId is not allowed.');

		ctx.close();
	});

	test('merge applies extends in order, then rules, skipping falsy entries', () => {
		const merged = merge({
			extends: [
				safe(),
				false,
				null,
				undefined,
				{ noRawMutation: 'warn' },
			],
			rules: { maxLimit: { value: 200 } },
		});

		expect(merged.noRawUnsafe).toBe('error');
		expect(merged.noRawMutation).toBe('warn');
		expect(merged.maxLimit).toEqual({ value: 200 });
		expect(merge({ extends: { noRawUnsafe: true } })).toEqual({
			noRawUnsafe: true,
		});
	});

	test('unsupported rules are silent no-ops', async () => {
		const ctx = createRulesContext({
			noDynamicPreparedShape: true,
			noPreparedNameConflict: true,
			requireUniqueWhereForConnect: true,
		});

		await expect(
			Promise.resolve(
				ctx.client.users.findMany({
					where: {
						id: 1,
					},
				}),
			),
		).resolves.toEqual([
			{
				active: true,
				age: 25,
				email: 'alice@example.com',
				id: 1,
				name: 'Alice',
			},
		]);

		ctx.close();
	});
});
