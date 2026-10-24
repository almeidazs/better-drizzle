import { Database } from 'bun:sqlite';
import { describe, expect, spyOn, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	BetterDrizzleTransactionRollbackError,
	better,
	definePlugin,
} from '../../src';

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
const relations = defineRelations(schema);

const createContext = (
	options?: Parameters<typeof better<typeof relations>>[1],
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

	const raw = drizzle({ client: sqlite, relations });
	const client = better(raw, {
		...options,
	});

	return {
		client,
		raw,
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

	test('rethrows callback errors unwrapped', async () => {
		class NotFoundException extends Error {}
		const error = new NotFoundException('missing');
		const hookErrors: unknown[] = [];
		const ctx = createContext({
			hooks: {
				onTransactionError: ({ error }) => {
					hookErrors.push(error);
				},
			},
		});

		const thrown = await ctx.client
			.transaction(async (tx) => {
				await tx.transaction(async (inner) => {
					await inner.users.create({
						data: { id: 1, email: 'a@test.com', name: 'Alice' },
					});
					throw error;
				});
			})
			.catch((caught: unknown) => caught);

		expect(thrown).toBe(error);
		expect(hookErrors).toHaveLength(2);
		expect(hookErrors[0]).toBeInstanceOf(BetterDrizzleError);
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

	test('afterCommit and afterRollback fail outside transactions', async () => {
		const ctx = createContext();

		expect(() => ctx.client.afterCommit(() => {})).toThrow(
			'afterCommit() can only be used inside a transaction.',
		);
		expect(() => ctx.client.afterRollback(() => {})).toThrow(
			'afterRollback() can only be used inside a transaction.',
		);

		try {
			ctx.client.afterCommit(() => {});
		} catch (error) {
			expect(error).toBeInstanceOf(BetterDrizzleError);
			expect((error as BetterDrizzleError).code).toBe(
				BetterDrizzleErrorCode.AfterCommitOutsideTransaction,
			);
		}

		try {
			ctx.client.afterRollback(() => {});
		} catch (error) {
			expect(error).toBeInstanceOf(BetterDrizzleError);
			expect((error as BetterDrizzleError).code).toBe(
				BetterDrizzleErrorCode.AfterRollbackOutsideTransaction,
			);
		}

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

	test('a failing async commit rejects the transaction and skips afterCommit', async () => {
		const ctx = createContext();
		const raw = ctx.raw as unknown as {
			run: (query: {
				queryChunks: Array<{ value: string[] }>;
			}) => unknown;
		};
		const run = raw.run.bind(raw);
		const statements: string[] = [];
		raw.run = (query) => {
			const text = query.queryChunks[0]?.value[0] ?? '';
			statements.push(text);
			if (text === 'commit')
				return Promise.reject(new Error('SQLITE_BUSY'));
			run(query);
			return Promise.resolve();
		};

		let committed = false;
		const error = await ctx.client
			.transaction(async (tx) => {
				tx.afterCommit(() => {
					committed = true;
				});
			})
			.catch((error) => error);

		expect(error).toBeInstanceOf(BetterDrizzleError);
		expect(error.message).toContain('SQLITE_BUSY');
		expect(committed).toBe(false);
		expect(statements).toEqual(['begin', 'commit', 'rollback']);
		ctx.close();
	});

	test('a failing begin rejects without issuing a rollback', async () => {
		const ctx = createContext();
		const raw = ctx.raw as unknown as {
			run: (query: {
				queryChunks: Array<{ value: string[] }>;
			}) => unknown;
		};
		const statements: string[] = [];
		raw.run = (query) => {
			statements.push(query.queryChunks[0]?.value[0] ?? '');
			return Promise.reject(new Error('SQLITE_BUSY'));
		};

		const error = await ctx.client
			.transaction(async () => {})
			.catch((error) => error);

		expect(error).toBeInstanceOf(BetterDrizzleError);
		expect(statements).toEqual(['begin']);
		ctx.close();
	});

	test('root transactions serialize across Drizzle clients sharing a SQLite connection', async () => {
		const ctx = createContext();
		const other = better(drizzle({ client: ctx.sqlite, relations }));
		const calls: string[] = [];
		try {
			await Promise.all([
				ctx.client.transaction(async (tx) => {
					calls.push('first');
					await tx.users.create({
						data: { id: 1, email: 'a@test.com', name: 'A' },
					});
					await Promise.resolve();
					calls.push('first done');
				}),
				other.transaction(async (tx) => {
					calls.push('second');
					await tx.users.create({
						data: { id: 2, email: 'b@test.com', name: 'B' },
					});
				}),
			]);
			expect(calls).toEqual(['first', 'first done', 'second']);
			expect(await ctx.client.users.count()).toBe(2);
		} finally {
			ctx.close();
		}
	});

	test('overlapping sibling savepoints reject before their callback and leave the parent usable', async () => {
		const ctx = createContext();
		try {
			await ctx.client.transaction(async (tx) => {
				let release!: () => void;
				let started!: () => void;
				const waiting = new Promise<void>((resolve) => {
					release = resolve;
				});
				const ready = new Promise<void>((resolve) => {
					started = resolve;
				});
				const first = tx.transaction(async (nested) => {
					await nested.users.create({
						data: { id: 1, email: 'a@test.com', name: 'A' },
					});
					started();
					await waiting;
				});
				await ready;
				let called = false;
				const error = await tx
					.transaction(() => {
						called = true;
					})
					.catch((error) => error);
				expect(error).toMatchObject({ code: 'INVALID_ARGS' });
				expect(called).toBe(false);
				release();
				await first;
				await tx.transaction(async (nested) => {
					await nested.users.create({
						data: { id: 2, email: 'b@test.com', name: 'B' },
					});
				});
			});
			expect(await ctx.client.users.count()).toBe(2);
		} finally {
			ctx.close();
		}
	});

	test('an uncaught overlapping savepoint error waits for the active child before rolling back', async () => {
		const ctx = createContext();
		try {
			const error = await ctx.client
				.transaction(async (tx) => {
					let release!: () => void;
					const waiting = new Promise<void>((resolve) => {
						release = resolve;
					});
					const first = tx.transaction(async (nested) => {
						await nested.users.create({
							data: { id: 1, email: 'a@test.com', name: 'A' },
						});
						await waiting;
					});
					const both = Promise.all([first, tx.transaction(() => {})]);
					both.catch(() => {
						release();
					});
					return both;
				})
				.catch((error) => error);
			expect(error).toMatchObject({ code: 'INVALID_ARGS' });
			expect(await ctx.client.users.count()).toBe(0);
			await ctx.client.transaction(() => {});
		} finally {
			ctx.close();
		}
	});

	test('async rollback failure preserves the callback error, hooks, and abort cleanup', async () => {
		const calls: string[] = [];
		const ctx = createContext({
			hooks: {
				onTransactionError() {
					calls.push('error');
				},
				afterTransactionRollback() {
					calls.push('rollback');
				},
			},
		});
		const raw = ctx.raw as unknown as {
			run: (query: {
				queryChunks: Array<{ value: string[] }>;
			}) => unknown;
		};
		const run = raw.run.bind(raw);
		let fail = true;
		raw.run = (query) => {
			const result = run(query);
			if (fail && query.queryChunks[0]?.value[0] === 'rollback') {
				fail = false;
				return Promise.reject(new Error('ROLLBACK_IO_FAILURE'));
			}
			return Promise.resolve(result);
		};
		const controller = new AbortController();
		const remove = spyOn(controller.signal, 'removeEventListener');
		const original = new Error('connection reset');
		let attempts = 0;
		try {
			const error = await ctx.client
				.transaction(
					(tx) => {
						attempts++;
						tx.afterRollback(() => {
							calls.push('callback');
						});
						throw original;
					},
					{
						signal: controller.signal,
						retries: { attempts: 3, on: ['connectionError'] },
					},
				)
				.catch((error) => error);
			expect(error).toBeInstanceOf(BetterDrizzleError);
			expect(error.message).toBe(original.message);
			expect(error.cause).toBe(original);
			expect(error.details.rollbackError.message).toBe(
				'ROLLBACK_IO_FAILURE',
			);
			expect(attempts).toBe(1);
			expect(calls).toEqual(['error', 'rollback', 'callback']);
			expect(remove).toHaveBeenCalledTimes(1);
			await ctx.client.transaction(() => {});
		} finally {
			remove.mockRestore();
			ctx.close();
		}
	});

	test('rollback observers all run when an error hook throws', async () => {
		const calls: string[] = [];
		const observer = new Error('observer failed');
		const ctx = createContext({
			hooks: {
				onTransactionError() {
					calls.push('error');
					throw observer;
				},
				afterTransactionRollback() {
					calls.push('rollback');
				},
			},
			plugins: [
				definePlugin({
					id: 'rollback-observer',
					hooks: {
						onTransactionError() {
							calls.push('plugin error');
						},
					},
				}),
			],
		});
		const controller = new AbortController();
		const remove = spyOn(controller.signal, 'removeEventListener');
		try {
			const error = await ctx.client
				.transaction(
					(tx) => {
						tx.afterRollback(() => {
							calls.push('callback');
						});
						throw new Error('stop');
					},
					{ signal: controller.signal },
				)
				.catch((error) => error);
			expect(error).toBe(observer);
			expect(calls).toEqual([
				'error',
				'plugin error',
				'rollback',
				'callback',
			]);
			expect(remove).toHaveBeenCalledTimes(1);
			await ctx.client.transaction(() => {});
		} finally {
			remove.mockRestore();
			ctx.close();
		}
	});

	test('afterCommit can start a new root transaction', async () => {
		const ctx = createContext();
		try {
			await ctx.client.transaction((tx) => {
				tx.afterCommit(() => ctx.client.transaction(() => {}));
			});
		} finally {
			ctx.close();
		}
	});

	test('an aborted queued transaction never begins or runs its callback', async () => {
		const ctx = createContext();
		const controller = new AbortController();
		let release!: () => void;
		let started!: () => void;
		const waiting = new Promise<void>((resolve) => {
			release = resolve;
		});
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		try {
			const first = ctx.client.transaction(async () => {
				started();
				await waiting;
			});
			await ready;
			let called = false;
			const queued = ctx.client
				.transaction(
					() => {
						called = true;
					},
					{ signal: controller.signal },
				)
				.catch((error) => error);
			controller.abort();
			release();
			await first;
			expect(await queued).toMatchObject({ code: 'TRANSACTION_ABORTED' });
			expect(called).toBe(false);
			await ctx.client.transaction(() => {});
		} finally {
			ctx.close();
		}
	});

	test.each(['onTransactionError', 'afterTransactionRollback'] as const)(
		'one throwing %s plugin does not skip later observers',
		async (hookName) => {
			const calls: string[] = [];
			const ctx = createContext({
				plugins: [
					definePlugin({
						id: 'first-observer',
						hooks: {
							[hookName]() {
								calls.push('first');
								throw new Error('plugin observer failed');
							},
						},
					}),
					definePlugin({
						id: 'second-observer',
						hooks: {
							[hookName]() {
								calls.push('second');
							},
						},
					}),
				],
			});
			try {
				const error = await ctx.client
					.transaction((tx) => {
						tx.afterRollback(() => {
							calls.push('callback');
						});
						throw new Error('stop');
					})
					.catch((error) => error);
				expect(error.message).toContain('plugin observer failed');
				expect(calls).toEqual(['first', 'second', 'callback']);
				await ctx.client.transaction(() => {});
			} finally {
				ctx.close();
			}
		},
	);

	test('SQLite clients without run reject unsupported transactions', async () => {
		const ctx = createContext();
		try {
			(ctx.raw as unknown as { run: unknown }).run = undefined;
			await expect(
				ctx.client.transaction(() => {}),
			).rejects.toMatchObject({ code: 'TRANSACTIONS_UNSUPPORTED' });
		} finally {
			ctx.close();
		}
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

	test('afterCommit failure keeps committed rows and does not run rollback hooks', async () => {
		const calls: string[] = [];
		const ctx = createContext({
			hooks: {
				afterTransactionRollback() {
					calls.push('rollback-hook');
				},
			},
		});

		await expect(
			ctx.client.transaction(async (tx) => {
				tx.afterCommit(() => {
					throw new Error('after commit failed');
				});
				tx.afterRollback(() => calls.push('rollback-callback'));
				await tx.users.create({
					data: { id: 1, email: 'a@test.com', name: 'Alice' },
				});
			}),
		).rejects.toThrow('after commit failed');

		expect(await ctx.client.users.count()).toBe(1);
		expect(calls).toEqual([]);
		ctx.close();
	});

	test('commit observers and callbacks all run and preserve the first error', async () => {
		const calls: string[] = [];
		const firstError = new Error('client commit observer failed');
		const ctx = createContext({
			hooks: {
				afterTransactionCommit() {
					calls.push('client');
					throw firstError;
				},
				afterTransactionRollback() {
					calls.push('rollback');
				},
			},
			plugins: [
				definePlugin({
					id: 'failing-commit-observer',
					hooks: {
						afterTransactionCommit() {
							calls.push('plugin-1');
							throw new Error('plugin failed');
						},
					},
				}),
				definePlugin({
					id: 'remaining-commit-observer',
					hooks: {
						afterTransactionCommit() {
							calls.push('plugin-2');
						},
					},
				}),
			],
		});
		await expect(
			ctx.client.transaction(async (tx) => {
				tx.afterCommit(() => {
					calls.push('callback-1');
					throw new Error('callback failed');
				});
				tx.afterCommit(() => {
					calls.push('callback-2');
				});
				await tx.users.create({
					data: { id: 1, email: 'a@test.com', name: 'Alice' },
				});
			}),
		).rejects.toBe(firstError);
		expect(calls).toEqual([
			'client',
			'plugin-1',
			'plugin-2',
			'callback-1',
			'callback-2',
		]);
		expect(await ctx.client.users.count()).toBe(1);
		ctx.close();
	});

	test('released savepoint retains commit callbacks when its observer throws', async () => {
		const calls: string[] = [];
		const ctx = createContext({
			hooks: {
				afterTransactionCommit(hook) {
					if (hook.depth === 2)
						throw new Error('nested observer failed');
				},
			},
		});
		await ctx.client.transaction(async (tx) => {
			await expect(
				tx.transaction(async (nested) => {
					nested.afterCommit(() => {
						calls.push('nested');
					});
					await nested.users.create({
						data: { id: 1, email: 'a@test.com', name: 'Alice' },
					});
				}),
			).rejects.toThrow('nested observer failed');
			expect(calls).toEqual([]);
		});
		expect(calls).toEqual(['nested']);
		expect(await ctx.client.users.count()).toBe(1);
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

	test('unsupported transaction options can throw on sqlite', async () => {
		const ctx = createContext({
			transaction: {
				unsupportedOptions: 'throw',
			},
		});

		await expect(
			ctx.client.transaction(async () => undefined, {
				isolationLevel: 'serializable',
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.TransactionUnsupportedOption,
			details: {
				option: 'isolationLevel',
			},
		});

		ctx.close();
	});

	test('unsupported transaction options can be ignored on sqlite', async () => {
		const ctx = createContext({
			transaction: {
				unsupportedOptions: 'ignore',
			},
		});

		await expect(
			ctx.client.transaction(async () => 'ok', {
				comment: 'ignored-on-sqlite',
				isolationLevel: 'serializable',
				readOnly: true,
			}),
		).resolves.toBe('ok');

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
