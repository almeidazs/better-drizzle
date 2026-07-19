import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';

import { better, definePlugin } from '../../src';
import {
	createMassiveContext,
	ENTRY_COUNT,
	type MassiveContext,
	schema,
} from './setup';

let ctx: MassiveContext;

beforeEach(() => {
	ctx = createMassiveContext();
});

afterEach(() => {
	ctx.close();
});

describe('massive sqlite transactions', () => {
	test('commits a large multi-operation transaction', async () => {
		const result = await ctx.client.transaction(async (tx) => {
			await tx.entries.createMany({
				data: Array.from({ length: 100 }, (_, index) => ({
					id: ENTRY_COUNT + index + 1,
					payload: `Transaction ${index}`,
					token: `transaction-${index}`,
					value: index,
				})),
			});
			await tx.entries.updateMany({
				data: { payload: 'Committed' },
				where: { id: { gt: ENTRY_COUNT } },
			});
			return tx.entries.count({ where: { payload: 'Committed' } });
		});

		expect(result).toBe(100);
		expect(await ctx.client.entries.count()).toBe(ENTRY_COUNT + 100);
	});

	test('rolls back every real database mutation after an error', async () => {
		await expect(
			ctx.client.transaction(async (tx) => {
				await tx.entries.deleteMany({ where: { id: { lte: 400 } } });
				await tx.entries.create({
					data: {
						id: ENTRY_COUNT + 1,
						payload: 'Must disappear',
						token: 'must-disappear',
						value: 1,
					},
				});
				throw new Error('rollback everything');
			}),
		).rejects.toThrow('rollback everything');

		expect(await ctx.client.entries.count()).toBe(ENTRY_COUNT);
		expect(
			await ctx.client.entries.exists({
				where: { token: 'must-disappear' },
			}),
		).toBe(false);
	});

	test('uses nested savepoints and preserves the outer transaction', async () => {
		await ctx.client.transaction(async (tx) => {
			await tx.entries.create({
				data: {
					id: ENTRY_COUNT + 1,
					payload: 'Outer',
					token: 'outer-savepoint',
					value: 1,
				},
			});
			await expect(
				tx.transaction(async (nested) => {
					await nested.entries.create({
						data: {
							id: ENTRY_COUNT + 2,
							payload: 'Inner',
							token: 'inner-savepoint',
							value: 2,
						},
					});
					throw new Error('rollback savepoint');
				}),
			).rejects.toThrow('rollback savepoint');
			expect(
				await tx.entries.exists({
					where: { token: 'outer-savepoint' },
				}),
			).toBe(true);
		});

		expect(
			await ctx.client.entries.exists({
				where: { token: 'outer-savepoint' },
			}),
		).toBe(true);
		expect(
			await ctx.client.entries.exists({
				where: { token: 'inner-savepoint' },
			}),
		).toBe(false);
	});

	test('runs real commit and rollback lifecycle callbacks', async () => {
		const events: string[] = [];
		await ctx.client.transaction(async (tx) => {
			tx.afterCommit(() => events.push('commit'));
			tx.afterRollback(() => events.push('unexpected rollback'));
		});
		await expect(
			ctx.client.transaction(async (tx) => {
				tx.afterCommit(() => events.push('unexpected commit'));
				tx.afterRollback(() => events.push('rollback'));
				throw new Error('stop');
			}),
		).rejects.toThrow('stop');

		expect(events).toEqual(['commit', 'rollback']);
	});
});

describe('massive sqlite hooks, plugins and context', () => {
	test('runs hooks with merged scoped and operation metadata', async () => {
		const seen: Array<Record<string, unknown> | undefined> = [];
		const client = better(ctx.raw, {
			hooks: {
				beforeQuery(context) {
					seen.push(
						context.meta as Record<string, unknown> | undefined,
					);
				},
			},
			schema,
		});
		const scoped = client.$withContext({
			requestId: 'request-1',
			tenantId: 7,
		});

		await scoped.users.findMany({
			meta: { requestId: 'request-2', traceId: 'trace-1' },
			take: 10,
		});

		expect(seen).toEqual([
			{ requestId: 'request-2', tenantId: 7, traceId: 'trace-1' },
		]);
	});

	test('runs plugin setup once and transforms hundreds of real rows', async () => {
		let setupCalls = 0;
		const activeOnly = definePlugin({
			id: 'mass-active-only',
			setup() {
				setupCalls += 1;
			},
			transform(operation) {
				if (
					operation.kind !== 'findMany' ||
					operation.state.includeInactive
				)
					return operation;
				operation.where = operation.where
					? { AND: [operation.where, { active: true }] }
					: { active: true };
				return operation;
			},
		});
		const client = better(ctx.raw, { plugins: [activeOnly], schema });

		const active = await client.users.findMany();
		const all = await client.users
			.$withState({ includeInactive: true })
			.findMany();
		const bypassed = await client.users.$withoutPlugins().findMany();

		expect(setupCalls).toBe(1);
		expect(active).toHaveLength(225);
		expect(all).toHaveLength(300);
		expect(bypassed).toHaveLength(300);
	});

	test('keeps client extensions on scoped and transaction clients', async () => {
		const client = ctx.client.extends((bound) => ({
			activeUsers() {
				return bound.users.count({ where: { active: true } });
			},
		}));
		const scoped = client.$withContext({ requestId: 'extension' });

		expect(await client.activeUsers()).toBe(225);
		expect(await scoped.activeUsers()).toBe(225);
		expect(await client.transaction(async (tx) => tx.activeUsers())).toBe(
			225,
		);
	});

	test('fires create, update, query and delete hooks against persisted rows', async () => {
		const events: string[] = [];
		const client = better(ctx.raw, {
			hooks: {
				afterCreate(context) {
					events.push(`after:${context.action}`);
				},
				afterDelete(context) {
					events.push(`after:${context.action}`);
				},
				afterQuery(context) {
					events.push(`after:${context.action}`);
				},
				afterUpdate(context) {
					events.push(`after:${context.action}`);
				},
				beforeCreate(context) {
					events.push(`before:${context.action}`);
				},
				beforeDelete(context) {
					events.push(`before:${context.action}`);
				},
				beforeQuery(context) {
					events.push(`before:${context.action}`);
				},
				beforeUpdate(context) {
					events.push(`before:${context.action}`);
				},
			},
			schema,
		});

		await client.entries.create({
			data: {
				id: ENTRY_COUNT + 1,
				payload: 'Hooks',
				token: 'hooks',
				value: 1,
			},
		});
		await client.entries.update({
			data: { value: 2 },
			where: { token: 'hooks' },
		});
		await client.entries.findFirst({ where: { token: 'hooks' } });
		await client.entries.delete({ where: { token: 'hooks' } });

		expect(events).toEqual([
			'before:create',
			'after:create',
			'before:update',
			'after:update',
			'before:findFirst',
			'after:findFirst',
			'before:delete',
			'after:delete',
		]);
	});
});

describe('massive sqlite raw sql and errors', () => {
	test('executes parameterized raw reads and writes on the real database', async () => {
		const rows = await ctx.client.$raw<{ id: number; name: string }>`
			select id, name from mass_users where active = ${1} and id <= ${5}
			order by id
		`;
		const result = await ctx.client.$executeRaw`
			update mass_entries set payload = ${'Raw updated'} where id <= ${50}
		`;

		expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 5]);
		expect(result.rowsAffected).toBe(50);
		expect(
			await ctx.client.entries.count({
				where: { payload: 'Raw updated' },
			}),
		).toBe(50);
	});

	test('keeps raw SQL bound to transactions and rolls it back', async () => {
		await expect(
			ctx.client.transaction(async (tx) => {
				await tx.$executeRaw(sql`
					delete from mass_entries where id <= 100
				`);
				throw new Error('raw rollback');
			}),
		).rejects.toThrow('raw rollback');

		expect(await ctx.client.entries.count()).toBe(ENTRY_COUNT);
	});

	test('blocks unsafe SQL by default and allows it only when configured', async () => {
		await expect(
			ctx.client.$rawUnsafe('select count(*) from mass_users'),
		).rejects.toThrow('Unsafe raw SQL is disabled');
		const unsafeClient = better(ctx.raw, {
			raw: { allowUnsafe: true },
			schema,
		});
		const rows = await unsafeClient.$rawUnsafe<{ total: number }>(
			'select count(*) as total from mass_users where age >= ?',
			[70],
		);

		expect(rows[0]?.total).toBeGreaterThan(0);
	});

	test('surfaces real unique and foreign-key database failures', async () => {
		await expect(
			ctx.client.users.create({
				data: {
					active: true,
					age: 30,
					email: 'user-1@example.com',
					id: 999_001,
					name: 'Duplicate',
				},
			}),
		).rejects.toThrow('UNIQUE constraint failed: mass_users.email');
		await expect(
			ctx.client.posts.create({
				data: {
					body: 'Invalid FK',
					id: 999_001,
					published: true,
					score: 1,
					title: 'Invalid FK',
					userId: 999_001,
				},
			}),
		).rejects.toThrow('FOREIGN KEY constraint failed');
	});
});
