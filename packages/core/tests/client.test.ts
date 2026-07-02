import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	better,
	definePlugin,
} from '../src';

const users = sqliteTable('client_users', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const schema = { users };

const createContext = (
	options?: Parameters<typeof better<typeof schema>>[1],
) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE client_users (
			id INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL
		);
		INSERT INTO client_users (id, name) VALUES
			(1, 'Alice'),
			(2, 'Bob');
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
	};
};

describe('client', () => {
	test('extends adds object properties and callback helpers', async () => {
		const ctx = createContext();

		const client = ctx.client
			.extends({
				abc: 123 as const,
			})
			.extends((client) => ({
				findByIdOrName(idOrName: number | string) {
					return typeof idOrName === 'number'
						? client.users.findFirst({ where: { id: idOrName } })
						: client.users.findFirst({
								where: { name: idOrName },
							});
				},
			}));

		const byId = await client.findByIdOrName(1);
		const byName = await client.findByIdOrName('Bob');

		expect(client.abc).toBe(123);
		expect(byId?.name).toBe('Alice');
		expect(byName?.id).toBe(2);
		ctx.close();
	});

	test('extends propagates to scoped clients and transactions', async () => {
		const ctx = createContext();
		const client = ctx.client.extends((client) => ({
			findById(id: number) {
				return client.users.findFirst({ where: { id } });
			},
			label: 'root',
		}));
		const scoped = client.$withContext({ requestId: 'req-1' });

		const scopedUser = await scoped.findById(2);
		const transactionalUser = await client.transaction(async (tx) => {
			expect(tx.label).toBe('root');

			const nested = tx.$withContext({ nested: true });
			const nestedUser = await nested.findById(1);
			const savepointUser = await tx.transaction(async (nestedTx) => {
				expect(nestedTx.label).toBe('root');
				return nestedTx.findById(2);
			});

			expect(nestedUser?.id).toBe(1);
			return savepointUser;
		});

		expect(scoped.label).toBe('root');
		expect(scopedUser?.name).toBe('Bob');
		expect(transactionalUser?.id).toBe(2);
		ctx.close();
	});

	test('extends fails on conflicts with built-ins, plugins, and prior extensions', () => {
		const ctx = createContext({
			plugins: [
				definePlugin({
					extendClient() {
						return {
							pluginValue: 1,
						};
					},
					id: 'client-plugin-value',
				}),
			],
			schema,
		});

		ctx.client.extends({
			customValue: 1,
		});

		expect(() =>
			ctx.client.extends({
				repository: 1,
			}),
		).toThrow('Client extension cannot override "repository".');
		expect(() =>
			ctx.client.extends({
				pluginValue: 2,
			}),
		).toThrow('Client extension cannot override "pluginValue".');
		expect(() =>
			ctx.client.extends({
				customValue: 2,
			}),
		).toThrow('Client extension cannot override "customValue".');
		ctx.close();
	});

	test('$withContext returns isolated clones and merges nested metadata', async () => {
		const seen: Array<Record<string, unknown> | undefined> = [];
		const ctx = createContext({
			hooks: {
				beforeQuery(query) {
					seen.push(
						query.meta as Record<string, unknown> | undefined,
					);
				},
			},
			schema,
		});

		const scoped = ctx.client.$withContext({
			requestId: 'req-1',
			tenantId: 'tenant-a',
		});
		const nested = scoped.$withContext({
			requestId: 'req-2',
			userId: 'user-1',
		});

		await ctx.client.users.findMany();
		await scoped.users.findMany();
		await nested.users.findMany({
			meta: {
				requestId: 'req-3',
			},
		});

		expect(seen).toEqual([
			undefined,
			{
				requestId: 'req-1',
				tenantId: 'tenant-a',
			},
			{
				requestId: 'req-3',
				tenantId: 'tenant-a',
				userId: 'user-1',
			},
		]);

		ctx.close();
	});

	test('repository lookup works on scoped clients', async () => {
		const ctx = createContext();
		const scoped = ctx.client.$withContext({ requestId: 'req-1' });
		const repo = scoped.repository('client_users');
		const rows = await repo.findMany({
			orderBy: { id: 'asc' },
		});

		expect(rows.map((row: { id: number }) => row.id)).toEqual([1, 2]);
		ctx.close();
	});

	test('fails fast when dialect inference is impossible', () => {
		const fakeDb = {
			delete() {
				throw new Error('unused');
			},
			dialect: {
				constructor: {
					name: 'CustomDialect',
				},
			},
			insert() {
				throw new Error('unused');
			},
			query: {},
			select() {
				throw new Error('unused');
			},
			update() {
				throw new Error('unused');
			},
		};

		expect(() =>
			better(fakeDb as never, {
				schema,
			}),
		).toThrow('Unable to infer Better Drizzle dialect');

		try {
			better(fakeDb as never, { schema });
		} catch (error) {
			expect(error).toBeInstanceOf(BetterDrizzleError);
			expect((error as BetterDrizzleError).code).toBe(
				BetterDrizzleErrorCode.DialectInferenceFailed,
			);
		}
	});
});
