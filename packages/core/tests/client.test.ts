import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { BetterDrizzleError, BetterDrizzleErrorCode, better } from '../src';

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
