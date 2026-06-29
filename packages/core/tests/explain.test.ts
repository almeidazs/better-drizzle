import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better, definePlugin } from '../src';
import { createTestContext } from './setup';

const explainUsers = sqliteTable('explain_users', {
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const explainSchema = {
	users: explainUsers,
};

const toSqlText = (query: { toQuery(config: unknown): { sql: string } }) =>
	query.toQuery({
		casing: {
			getColumnCasing(column: { name?: string }) {
				return column.name ?? '';
			},
		} as never,
		escapeName(name: string) {
			return `"${name}"`;
		},
		escapeParam(index: number) {
			return `$${index + 1}`;
		},
		escapeString(value: string) {
			return value;
		},
		inlineParams: false,
		paramStartIndex: { value: 0 },
	}).sql;

const createFakeSelectQuery = (
	rows: Record<string, unknown>[] = [{ id: 1, name: 'Alice' }],
) => {
	const query = {
		for() {
			return query;
		},
		getSQL() {
			return sql.raw('select * from explain_users');
		},
		innerJoin() {
			return query;
		},
		leftJoin() {
			return query;
		},
		limit() {
			return query;
		},
		offset() {
			return query;
		},
		orderBy() {
			return query;
		},
		where() {
			return query;
		},
	};

	return Object.assign(query, {
		// biome-ignore lint/suspicious/noThenProperty: test double intentionally mimics Drizzle's awaitable query builder.
		then<TResult1 = Record<string, unknown>[], TResult2 = never>(
			onfulfilled?:
				| ((
						value: Record<string, unknown>[],
				  ) => TResult1 | PromiseLike<TResult1>)
				| null,
			onrejected?:
				| ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
				| null,
		) {
			return Promise.resolve(rows).then(onfulfilled, onrejected);
		},
	});
};

const createFakePgDb = () => {
	const executed: string[] = [];
	const selectQuery = createFakeSelectQuery();
	const db = {
		dialect: {
			constructor: {
				name: 'PgDialect',
			},
		},
		execute(query: { toQuery(config: unknown): { sql: string } }) {
			executed.push(toSqlText(query));
			return Promise.resolve([
				{ 'QUERY PLAN': 'Seq Scan on explain_users' },
			]);
		},
		query: {
			users: {
				findFirst() {
					throw new Error('unexpected relational findFirst');
				},
				findMany() {
					throw new Error('unexpected relational findMany');
				},
			},
		},
		select() {
			return {
				from() {
					return selectQuery;
				},
			};
		},
	};

	return {
		db,
		executed,
	};
};

describe('explain', () => {
	test('findMany explain returns structured sqlite plan and ignored options', async () => {
		const ctx = createTestContext();

		const result = await ctx.better.users
			.findMany({
				orderBy: { id: 'asc' },
				where: { active: true },
			})
			.explain({
				analyze: true,
				comment: 'ignored-on-sqlite',
				costs: false,
				name: 'users.findMany',
				summary: false,
				timing: true,
				verbose: true,
			});

		expect(result.driver).toBe('sqlite');
		expect(result.operation).toBe('findMany');
		expect(result.statements).toHaveLength(1);
		expect(result.statements[0]?.key).toBe('data');
		expect(result.statements[0]?.sql).toContain('select');
		expect(result.statements[0]?.ignoredOptions).toEqual([
			'analyze',
			'verbose',
			'costs',
			'timing',
			'summary',
			'name',
			'comment',
		]);
		expect(result.statements[0]?.raw).toBeArray();

		ctx.close();
	});

	test('count, exists and paginate explain expose statement metadata', async () => {
		const ctx = createTestContext();

		const countResult = await ctx.better.users
			.count({
				where: { active: true },
			})
			.explain();
		const existsResult = await ctx.better.users
			.exists({
				where: { id: 1 },
			})
			.explain();
		const paginateResult = await ctx.better.users
			.paginate({
				limit: 2,
				orderBy: { id: 'asc' },
			})
			.explain();

		expect(
			countResult.statements.map((statement) => statement.key),
		).toEqual(['count']);
		expect(
			existsResult.statements.map((statement) => statement.key),
		).toEqual(['exists']);
		expect(
			paginateResult.statements.map((statement) => statement.key),
		).toEqual(['data', 'total']);

		ctx.close();
	});

	test('cursor explain includes runtime probe statements when needed', async () => {
		const ctx = createTestContext();

		const result = await ctx.better.users
			.cursor({
				after: { id: 2 },
				limit: 2,
				orderBy: { id: 'asc' },
			})
			.explain();

		expect(result.statements.map((statement) => statement.key)).toEqual([
			'data',
			'probe:hasPrevious',
		]);

		ctx.close();
	});

	test('explain reflects plugin transforms on read promises', async () => {
		const ctx = createTestContext();
		const beforeQueryCalls: string[] = [];
		const forceActive = definePlugin({
			id: 'force-active',
			transform(operation) {
				if (operation.kind !== 'findMany') return operation;
				operation.where = operation.where
					? { AND: [operation.where, { active: true }] }
					: { active: true };
				return operation;
			},
		});
		const client = better(ctx.raw, {
			hooks: {
				beforeQuery(context) {
					beforeQueryCalls.push(context.action);
				},
			},
			plugins: [forceActive],
			schema: ctx.schema,
		});

		const result = await client.users
			.findMany({
				where: { id: 1 },
			})
			.explain();

		expect(beforeQueryCalls).toEqual(['findMany']);
		expect(result.statements[0]?.sql).toContain('active');

		ctx.close();
	});

	test('postgres explain applies supported options and prefixes the query', async () => {
		const fake = createFakePgDb();
		const client = better(fake.db as never, {
			schema: explainSchema,
		});

		const result = await client.users
			.findMany({ where: { id: 1 } })
			.explain({
				analyze: true,
				comment: 'users.findMany',
				costs: false,
				name: 'users.findMany',
				summary: false,
				timing: true,
				verbose: true,
			});

		expect(result.driver).toBe('pg');
		expect(result.statements[0]?.appliedOptions).toEqual({
			analyze: true,
			comment: 'users.findMany',
			costs: false,
			name: 'users.findMany',
			summary: false,
			timing: true,
			verbose: true,
		});
		expect(fake.executed[0]).toContain(
			'EXPLAIN (ANALYZE true, VERBOSE true, COSTS false, TIMING true, SUMMARY false)',
		);
		expect(fake.executed[0]).toContain('/* users.findMany */');
	});
});
