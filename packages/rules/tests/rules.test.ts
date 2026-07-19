import { describe, expect, test } from 'bun:test';
import { better } from 'better-drizzle';

import { createTestContext } from '../../../packages/core/tests/setup';
import { rules } from '../src';

const createRulesContext = (pluginOptions: Parameters<typeof rules>[0]) => {
	const base = createTestContext();
	const client = better(base.raw, {
		plugins: [rules(pluginOptions)],
		raw: {
			allowUnsafe: true,
		},
		schema: base.schema,
	});

	return {
		...base,
		client,
	};
};

describe('@better-drizzle/rules', () => {
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
			ctx.client.users.findMany({
				limit: 2,
			}),
		).rejects.toThrow('The requested limit 2 exceeds the maximum 1.');

		await expect(
			ctx.client.users.paginate({
				page: 1,
				perPage: 1,
			}),
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
			ctx.client.users.findMany({
				lock: {
					mode: 'forUpdate',
					skipLocked: true,
				},
				orderBy: {
					id: 'asc',
				},
			}),
		).rejects.toThrow('Row locks require an active transaction.');

		await expect(
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
		).rejects.toThrow('skipLocked and noWait cannot be used together.');

		await expect(
			ctx.client.transaction((tx) =>
				tx.users.findMany({
					lock: {
						mode: 'forUpdate',
						skipLocked: true,
					},
				}),
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
			ctx.client.users.findMany({
				include: {
					posts: {
						with: {
							comments: true,
						},
					},
				},
			}),
		).rejects.toThrow('include depth 2 exceeds the maximum 1.');

		await expect(
			ctx.client.posts.findMany({
				include: {
					author: true,
					comments: true,
				},
			}),
		).rejects.toThrow('include relation count 2 exceeds the maximum 1.');

		ctx.close();
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

	test('requires tenant context and protects tenant overrides', async () => {
		const ctx = createRulesContext({
			requireTenantContext: true,
			noTenantColumnOverride: true,
		});

		await expect(
			ctx.client.users.findMany({
				where: {
					id: 1,
				},
			}),
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

	test('unsupported rules are silent no-ops', async () => {
		const ctx = createRulesContext({
			noDynamicPreparedShape: true,
			noPreparedNameConflict: true,
			requireUniqueWhereForConnect: true,
		});

		await expect(
			ctx.client.users.findMany({
				where: {
					id: 1,
				},
			}),
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
