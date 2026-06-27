import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	BetterDrizzleTransactionRollbackError,
	better,
	definePlugin,
} from '../src';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

type Expect<T extends true> = T;

const users = sqliteTable('transaction_users', {
	email: text('email').notNull().unique(),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const schema = { users };

const createContext = (
	options?: Parameters<typeof better<typeof schema>>[1],
) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		PRAGMA journal_mode = MEMORY;
		PRAGMA foreign_keys = ON;
		CREATE TABLE transaction_users (
			id INTEGER PRIMARY KEY NOT NULL,
			email TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL
		);
	`);

	const raw = drizzle(sqlite, { schema });
	const client = better(raw, {
		schema,
		...options,
	});

	return {
		client,
		close() {
			sqlite.close();
		},
		sqlite,
	};
};

describe('transactions', () => {
	test('scoped context is inherited by transaction hooks and tx client', async () => {
		const seen: Array<Record<string, unknown> | undefined> = [];
		const ctx = createContext({
			hooks: {
				beforeCreate(hook) {
					seen.push(hook.meta as Record<string, unknown> | undefined);
				},
				beforeTransaction(hook) {
					seen.push(hook.meta as Record<string, unknown> | undefined);
				},
			},
			schema,
		});

		const scoped = ctx.client.$withContext({
			organizationId: 'org-1',
			requestId: 'req-1',
		});

		await scoped.transaction(
			async (tx) => {
				await tx.users.create({
					data: { id: 1, email: 'a@test.com', name: 'Alice' },
					meta: {
						requestId: 'req-3',
						userId: 'user-1',
					},
				});
			},
			{
				meta: {
					requestId: 'req-2',
				},
			},
		);

		expect(seen).toEqual([
			{
				organizationId: 'org-1',
				requestId: 'req-2',
			},
			{
				organizationId: 'org-1',
				requestId: 'req-3',
				userId: 'user-1',
			},
		]);
		ctx.close();
	});

	test('basic commit', async () => {
		const ctx = createContext();

		await ctx.client.transaction(async (tx) => {
			await tx.users.create({
				data: { id: 1, email: 'a@test.com', name: 'Alice' },
			});
			await tx.users.create({
				data: { id: 2, email: 'b@test.com', name: 'Bob' },
			});
		});

		const rows = await ctx.client.users.findMany({
			orderBy: { id: 'asc' },
		});
		expect(rows.map((row) => row.id)).toEqual([1, 2]);
		ctx.close();
	});

	test('rollback on throw', async () => {
		const ctx = createContext();

		await expect(
			ctx.client.transaction(async (tx) => {
				await tx.users.create({
					data: { id: 1, email: 'a@test.com', name: 'Alice' },
				});

				throw new Error('boom');
			}),
		).rejects.toThrow('boom');

		expect(await ctx.client.users.count()).toBe(0);
		ctx.close();
	});

	test('rollback via tx.rollback()', async () => {
		const ctx = createContext();

		await expect(
			ctx.client.transaction(async (tx) => {
				await tx.users.create({
					data: { id: 1, email: 'a@test.com', name: 'Alice' },
				});

				tx.rollback();
			}),
		).rejects.toBeInstanceOf(BetterDrizzleTransactionRollbackError);

		expect(await ctx.client.users.count()).toBe(0);
		ctx.close();
	});

	test('return value from transaction', async () => {
		const ctx = createContext();

		const result = await ctx.client.transaction(async (tx) => {
			const user = await tx.users.create({
				data: { id: 1, email: 'a@test.com', name: 'Alice' },
			});

			return user.email;
		});

		expect(result).toBe('a@test.com');
		ctx.close();
	});

	test('context inheritance and override', async () => {
		const seen: Array<Record<string, unknown> | undefined> = [];
		const ctx = createContext({
			hooks: {
				beforeCreate(hook) {
					seen.push(hook.transactionContext);
				},
			},
			schema,
		});

		await ctx.client.transaction(
			async (tx) => {
				await tx.users.create({
					data: { id: 1, email: 'a@test.com', name: 'Alice' },
				});

				await tx.transaction(
					async (nestedTx) => {
						await nestedTx.users.create({
							data: { id: 2, email: 'b@test.com', name: 'Bob' },
						});
					},
					{
						context: {
							requestId: 'nested',
						},
					},
				);
			},
			{
				context: {
					requestId: 'outer',
					tenantId: 'tenant-a',
				},
			},
		);

		expect(seen).toEqual([
			{ requestId: 'outer', tenantId: 'tenant-a' },
			{ requestId: 'nested', tenantId: 'tenant-a' },
		]);
		ctx.close();
	});

	test('nested transaction savepoint', async () => {
		const ctx = createContext();

		await ctx.client.transaction(async (tx) => {
			await tx.users.create({
				data: { id: 1, email: 'a@test.com', name: 'Alice' },
			});

			try {
				await tx.transaction(async (nestedTx) => {
					await nestedTx.users.create({
						data: { id: 2, email: 'b@test.com', name: 'Bob' },
					});

					nestedTx.rollback('nested rollback');
				});
			} catch (error) {
				expect(error).toBeInstanceOf(
					BetterDrizzleTransactionRollbackError,
				);
				expect(error).toBeInstanceOf(BetterDrizzleError);
				expect(
					(error as BetterDrizzleTransactionRollbackError).reason,
				).toBe('nested rollback');
				expect((error as BetterDrizzleError).code).toBe(
					BetterDrizzleErrorCode.TransactionRollback,
				);
			}

			await tx.users.create({
				data: { id: 3, email: 'c@test.com', name: 'Charlie' },
			});
		});

		const rows = await ctx.client.users.findMany({
			orderBy: { id: 'asc' },
		});
		expect(rows.map((row) => row.id)).toEqual([1, 3]);
		ctx.close();
	});

	test('afterCommit only runs on commit', async () => {
		const calls: string[] = [];
		const ctx = createContext();

		await ctx.client.transaction(async (tx) => {
			tx.afterCommit(() => {
				calls.push('commit');
			});
			tx.afterRollback(() => {
				calls.push('rollback');
			});

			await tx.users.create({
				data: { id: 1, email: 'a@test.com', name: 'Alice' },
			});
		});

		expect(calls).toEqual(['commit']);
		ctx.close();
	});

	test('afterRollback only runs on rollback', async () => {
		const calls: string[] = [];
		const ctx = createContext();

		await expect(
			ctx.client.transaction(async (tx) => {
				tx.afterCommit(() => {
					calls.push('commit');
				});
				tx.afterRollback(() => {
					calls.push('rollback');
				});

				await tx.users.create({
					data: { id: 1, email: 'a@test.com', name: 'Alice' },
				});

				throw new Error('stop');
			}),
		).rejects.toThrow('stop');

		expect(calls).toEqual(['rollback']);
		ctx.close();
	});

	test('retry on transient error and discard failed afterCommit callbacks', async () => {
		const calls: string[] = [];
		const attempts: number[] = [];
		const ctx = createContext();
		let attempt = 0;

		await ctx.client.transaction(
			async (tx) => {
				attempt += 1;
				attempts.push(attempt);

				tx.afterCommit(() => {
					calls.push(`commit-${attempt}`);
				});

				await tx.users.create({
					data: {
						id: attempt,
						email: `${attempt}@test.com`,
						name: `User ${attempt}`,
					},
				});

				if (attempt === 1) {
					const error = Object.assign(new Error('deadlock'), {
						code: '40P01',
					});
					throw error;
				}
			},
			{
				retries: {
					attempts: 2,
				},
			},
		);

		expect(attempts).toEqual([1, 2]);
		expect(calls).toEqual(['commit-2']);
		expect(await ctx.client.users.count()).toBe(1);
		ctx.close();
	});

	test('does not retry by default', async () => {
		const ctx = createContext();
		let attempts = 0;

		await expect(
			ctx.client.transaction(async () => {
				attempts += 1;
				throw Object.assign(new Error('deadlock'), { code: '40P01' });
			}),
		).rejects.toThrow('deadlock');

		expect(attempts).toBe(1);
		ctx.close();
	});

	test('plugin transform and plugin-added operation args work inside tx', async () => {
		const seenAudit: Array<string | undefined> = [];
		const ctx = createContext({
			plugins: [
				definePlugin({
					hooks: {
						beforeCreate(operation) {
							if (operation.kind !== 'create') return;
							seenAudit.push(operation.args.audit);
						},
					},
					id: 'audit',
					operationArgs: {
						create: {
							audit: undefined as string | undefined,
						},
					},
					transform(operation) {
						if (operation.kind !== 'create') return operation;

						operation.data = {
							...(operation.data as Record<string, unknown>),
							name: `${(operation.data as { name: string }).name}-tx`,
						} as typeof operation.data;

						return operation;
					},
				}),
			],
			schema,
		});

		await ctx.client.transaction(async (tx) => {
			await tx.users.create({
				audit: 'create-user',
				data: { id: 1, email: 'a@test.com', name: 'Alice' },
			});
		});

		const user = await ctx.client.users.findFirst({ where: { id: 1 } });
		expect(user?.name).toBe('Alice-tx');
		expect(seenAudit).toEqual(['create-user']);
		ctx.close();
	});

	test('transaction hooks run for client and plugin hooks', async () => {
		const events: string[] = [];
		const ctx = createContext({
			hooks: {
				afterTransactionCommit() {
					events.push('client-commit');
				},
				afterTransactionRollback() {
					events.push('client-rollback');
				},
				beforeTransaction() {
					events.push('client-before');
				},
				onTransactionError() {
					events.push('client-error');
				},
			},
			plugins: [
				definePlugin({
					hooks: {
						afterTransactionCommit() {
							events.push('plugin-commit');
						},
						afterTransactionRollback() {
							events.push('plugin-rollback');
						},
						beforeTransaction() {
							events.push('plugin-before');
						},
						onTransactionError() {
							events.push('plugin-error');
						},
					},
					id: 'tx-hooks',
				}),
			],
			schema,
		});

		await ctx.client.transaction(async (tx) => {
			await tx.users.create({
				data: { id: 1, email: 'a@test.com', name: 'Alice' },
			});
		});

		await expect(
			ctx.client.transaction(async (tx) => {
				await tx.users.create({
					data: { id: 2, email: 'b@test.com', name: 'Bob' },
				});

				throw new Error('rollback');
			}),
		).rejects.toThrow('rollback');

		expect(events).toEqual([
			'client-before',
			'plugin-before',
			'client-commit',
			'plugin-commit',
			'client-before',
			'plugin-before',
			'client-error',
			'plugin-error',
			'client-rollback',
			'plugin-rollback',
		]);
		ctx.close();
	});

	test('tx type exposes same model methods as db', async () => {
		const ctx = createContext();

		await ctx.client.transaction(async (tx) => {
			type _UserMethods = Expect<
				Equal<keyof typeof tx.users, keyof typeof ctx.client.users>
			>;
			const check: _UserMethods = true;
			void check;

			await tx.users.create({
				data: { id: 1, email: 'a@test.com', name: 'Alice' },
			});
		});

		ctx.close();
	});
});
