import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineRelations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { BetterDrizzleErrorCode, better, definePlugin } from '../../src';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

type Expect<T extends true> = T;

const users = sqliteTable('raw_users', {
	email: text('email').notNull(),
	id: integer('id').primaryKey(),
	status: text('status').notNull(),
});

const schema = { users };
const relations = defineRelations(schema);

const createContext = (
	options?: Parameters<typeof better<typeof relations>>[1],
) => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE raw_users (
			id INTEGER PRIMARY KEY NOT NULL,
			email TEXT NOT NULL,
			status TEXT NOT NULL
		);
		INSERT INTO raw_users (id, email, status) VALUES
			(1, 'alice@example.com', 'active'),
			(2, 'bob@example.com', 'inactive');
	`);

	const raw = drizzle({ client: sqlite, relations });
	const client = better(raw, {
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

describe('raw sql', () => {
	test('scoped context meta is merged into raw hooks and can be overridden', async () => {
		const seen: Array<Record<string, unknown> | undefined> = [];
		const ctx = createContext({
			hooks: {
				beforeRaw(raw) {
					seen.push(raw.meta as Record<string, unknown> | undefined);
				},
			},
		});

		const scoped = ctx.client.$withContext({
			organizationId: 'org-1',
			requestId: 'req-1',
		});

		await scoped.$raw(sql`select id from raw_users`, {
			meta: {
				requestId: 'req-2',
				userId: 'user-1',
			},
		});

		expect(seen).toEqual([
			{
				organizationId: 'org-1',
				requestId: 'req-2',
				userId: 'user-1',
			},
		]);
		ctx.close();
	});

	test('$raw returns rows', async () => {
		const ctx = createContext();

		const rows = await ctx.client.$raw<{ id: number; email: string }>`
			select id, email from raw_users where status = ${'active'}
		`;

		expect(rows).toEqual([{ email: 'alice@example.com', id: 1 }]);
		ctx.close();
	});

	test('$executeRaw executes mutation', async () => {
		const ctx = createContext();

		const result = await ctx.client.$executeRaw`
			update raw_users set status = ${'active'} where id = ${2}
		`;

		expect(result.rowsAffected).toBe(1);
		expect(
			await ctx.client.$raw<{ status: string }>`
				select status from raw_users where id = ${2}
			`,
		).toEqual([{ status: 'active' }]);
		ctx.close();
	});

	test('parameters are safe', async () => {
		const ctx = createContext();

		const rows = await ctx.client.$raw<{ id: number }>`
			select id from raw_users where email = ${"alice@example.com' OR 1=1 --"}
		`;

		expect(rows).toEqual([]);
		ctx.close();
	});

	test('$rawUnsafe is blocked by default', async () => {
		const ctx = createContext();

		await expect(
			ctx.client.$rawUnsafe('select id from raw_users'),
		).rejects.toThrow('Unsafe raw SQL is disabled');
		ctx.close();
	});

	test('$rawUnsafe works when enabled', async () => {
		const ctx = createContext({
			raw: {
				allowUnsafe: true,
			},
		});

		const rows = await ctx.client.$rawUnsafe<{ id: number }>(
			'select id from raw_users where status = ?',
			['active'],
		);

		expect(rows).toEqual([{ id: 1 }]);
		ctx.close();
	});

	test('raw methods can be disabled at the client level', async () => {
		const ctx = createContext({
			raw: {
				enabled: false,
			},
		});

		await expect(
			ctx.client.$raw(sql`select id from raw_users`),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.RawDisabled,
		});

		ctx.close();
	});

	test('requireComment enforces comments on raw queries', async () => {
		const ctx = createContext({
			raw: {
				requireComment: true,
			},
		});

		await expect(
			ctx.client.$raw(sql`select id from raw_users`),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.RawCommentRequired,
		});

		const rows = await ctx.client.$raw<{ id: number }>(
			sql`select id from raw_users order by id asc`,
			{
				comment: 'raw.users.required',
			},
		);

		expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
		ctx.close();
	});

	test('invalid safe raw inputs are rejected', async () => {
		const ctx = createContext();

		await expect(
			ctx.client.$raw('select id from raw_users' as never),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.RawInvalidQuery,
		});

		await expect(
			ctx.client.$executeRaw(
				'update raw_users set status = "x"' as never,
			),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.RawInvalidQuery,
		});

		ctx.close();
	});

	test('$rawUnsafe validates placeholder counts', async () => {
		const ctx = createContext({
			raw: {
				allowUnsafe: true,
			},
		});

		await expect(
			ctx.client.$rawUnsafe(
				'select id from raw_users where id = ? and status = ?',
				[1],
			),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.RawUnsafePlaceholderMismatch,
		});

		ctx.close();
	});

	test('options are passed to hooks', async () => {
		const seen: Array<Record<string, unknown>> = [];
		const ctx = createContext({
			hooks: {
				beforeRaw(raw) {
					seen.push({
						action: raw.action,
						comment: raw.comment,
						name: raw.name,
						timeoutMs: raw.timeoutMs,
					});
				},
			},
		});

		await ctx.client.$raw(sql`select id from raw_users`, {
			comment: 'raw.users.list',
			name: 'users-query',
			timeoutMs: 5000,
		});

		expect(seen).toEqual([
			{
				action: 'raw',
				comment: 'raw.users.list',
				name: 'users-query',
				timeoutMs: 5000,
			},
		]);
		ctx.close();
	});

	test('works inside transaction', async () => {
		const ctx = createContext();

		await ctx.client.transaction(async (tx) => {
			await tx.$executeRaw`
				update raw_users set status = ${'active'} where id = ${2}
			`;

			const rows = await tx.$raw<{ id: number }>`
				select id from raw_users where status = ${'active'} order by id asc
			`;

			expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
		});

		ctx.close();
	});

	test('map transforms rows', async () => {
		const ctx = createContext();

		const rows = await ctx.client.$raw<{ id: number }, { userId: number }>(
			sql`select id from raw_users order by id asc`,
			{
				map(row) {
					return {
						userId: row.id as number,
					};
				},
			},
		);

		expect(rows).toEqual([{ userId: 1 }, { userId: 2 }]);
		ctx.close();
	});

	test('map infers return type', async () => {
		const ctx = createContext();

		const rows = await ctx.client.$raw(
			sql`select id from raw_users order by id asc`,
			{
				map(row: { id: number }) {
					return row.id.toString();
				},
			},
		);

		type _ = Expect<Equal<typeof rows, string[]>>;

		expect(rows).toEqual(['1', '2']);
		ctx.close();
	});

	test('timeout and signal behavior', async () => {
		const timedOut = createContext();
		const controller = new AbortController();
		controller.abort(new Error('aborted'));

		await expect(
			timedOut.client.$raw(sql`select id from raw_users`, {
				timeoutMs: 0,
			}),
		).rejects.toThrow('Raw query timed out.');

		await expect(
			timedOut.client.$raw(sql`select id from raw_users`, {
				signal: controller.signal,
			}),
		).rejects.toThrow('aborted');

		timedOut.close();
	});

	test('unsupported raw options can throw when configured', async () => {
		const ctx = createContext({
			raw: {
				unsupportedOptions: 'throw',
			},
		});

		await expect(
			ctx.client.$raw(sql`select id from raw_users`, {
				comment: 'raw.unsupported.comment',
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.RawUnsupportedOption,
			details: {
				option: 'comment',
			},
		});

		ctx.close();
	});

	test('successful raw writes run every after hook and preserve the first error', async () => {
		for (const clientThrows of [false, true]) {
			const events: string[] = [];
			const ctx = createContext({
				hooks: {
					afterRaw() {
						events.push('client');
						if (clientThrows)
							throw new Error('client observer failed');
					},
				},
				plugins: [
					definePlugin({
						id: 'failing-raw-observer',
						hooks: {
							afterRaw() {
								events.push('plugin-1');
								throw new Error('plugin observer failed');
							},
						},
					}),
					definePlugin({
						id: 'remaining-raw-observer',
						hooks: {
							afterRaw() {
								events.push('plugin-2');
							},
						},
					}),
				],
			});
			await expect(
				ctx.client.$executeRaw(
					sql`update raw_users set status = 'updated' where id = 1`,
				),
			).rejects.toThrow(
				clientThrows
					? 'client observer failed'
					: 'plugin observer failed',
			);
			expect(events).toEqual(['client', 'plugin-1', 'plugin-2']);
			expect(
				(await ctx.client.users.findUnique({ where: { id: 1 } }))
					?.status,
			).toBe('updated');
			ctx.close();
		}
	});

	test('raw hooks run', async () => {
		const events: string[] = [];
		const plugin = definePlugin({
			hooks: {
				afterRaw(context) {
					events.push(`plugin:after:${context.action}`);
				},
				beforeRaw(context) {
					events.push(`plugin:before:${context.action}`);
				},
				onRawError(context) {
					events.push(
						`plugin:error:${context.action}:${String(context.error)}`,
					);
				},
			},
			id: 'raw-hooks',
			transform(operation) {
				if (operation.kind === 'findMany')
					operation.where = (
						operation.where
							? {
									AND: [
										operation.where,
										{ status: 'inactive' },
									],
								}
							: { status: 'inactive' }
					) as typeof operation.where;

				return operation;
			},
		});
		const ctx = createContext({
			hooks: {
				afterRaw(context) {
					events.push(`client:after:${context.action}`);
				},
				beforeRaw(context) {
					events.push(`client:before:${context.action}`);
				},
				onRawError(context) {
					events.push(
						`client:error:${context.action}:${String(context.error)}`,
					);
				},
			},
			plugins: [plugin],
		});

		const rawRows = await ctx.client.$raw<{ id: number }>`
			select id from raw_users where status = ${'active'}
		`;
		const modelRows = await ctx.client.users.findMany();

		expect(rawRows).toEqual([{ id: 1 }]);
		expect(modelRows).toEqual([
			{ email: 'bob@example.com', id: 2, status: 'inactive' },
		]);

		await expect(
			ctx.client.$raw(sql`select missing_column from raw_users`),
		).rejects.toThrow();

		expect(events).toEqual([
			'client:before:raw',
			'plugin:before:raw',
			'client:after:raw',
			'plugin:after:raw',
			'client:before:raw',
			'plugin:before:raw',
			'client:error:raw:BetterDrizzleError: no such column: missing_column',
			'plugin:error:raw:BetterDrizzleError: no such column: missing_column',
		]);

		ctx.close();
	});
});
