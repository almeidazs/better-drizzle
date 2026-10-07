import { describe, expect, test } from 'bun:test';

import { defineRelations, sql, type SQL } from 'drizzle-orm';
import { int, MySqlDialect, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { PgDialect } from 'drizzle-orm/pg-core';
import { integer, SQLiteDialect, sqliteTable } from 'drizzle-orm/sqlite-core';

import {
	createRuntimeContext,
	getTableRuntime,
} from '../../src/shared/client/context';
import {
	compileCursorWhere,
	compileOrderBy,
} from '../../src/shared/query/compiler';
import type { WhereCompilerContext } from '../../src/types/runtime';

const records = sqliteTable('order_records', {
	id: integer('id').primaryKey(),
	value: integer('value'),
});

const schema = { records };
const runtime = {
	columns: { id: records.id, value: records.value },
} as WhereCompilerContext<typeof schema>['runtime'];

const compile = (
	dialect: 'mysql' | 'pg' | 'sqlite',
	orderBy: { value: { direction: 'asc' | 'desc'; nulls: 'first' | 'last' } },
) =>
	compileOrderBy(
		{ dialect, runtime } as WhereCompilerContext<typeof schema>,
		orderBy,
	);

const compileCursor = (
	dialect: 'mysql' | 'pg' | 'sqlite',
	cursor: { value: number | null },
	orderBy: {
		value:
			| 'asc'
			| 'desc'
			| { direction: 'asc' | 'desc'; nulls?: 'first' | 'last' };
	},
) =>
	compileCursorWhere(
		{ dialect, runtime } as WhereCompilerContext<typeof schema>,
		cursor,
		orderBy,
	);

const render = (
	dialect: { sqlToQuery(query: SQL): { sql: string } },
	clauses: ReturnType<typeof compileOrderBy>,
) =>
	dialect.sqlToQuery(
		sql`select * from ${records} order by ${sql.join(clauses ?? [], sql`, `)}`,
	).sql;

const renderCursor = (
	dialect: { sqlToQuery(query: SQL): { sql: string } },
	predicate: ReturnType<typeof compileCursorWhere>,
) =>
	dialect
		.sqlToQuery(
			sql`select * from ${records} where ${predicate ?? sql`true`}`,
		)
		.sql.toLowerCase();

describe('orderBy NULL placement by dialect', () => {
	test('uses native NULL ordering on PostgreSQL and SQLite', () => {
		const ascLast = { value: { direction: 'asc', nulls: 'last' } } as const;
		const descFirst = {
			value: { direction: 'desc', nulls: 'first' },
		} as const;

		expect(
			render(new PgDialect(), compile('pg', ascLast)).toLowerCase(),
		).toContain('asc nulls last');
		expect(
			render(new PgDialect(), compile('pg', descFirst)).toLowerCase(),
		).toContain('desc nulls first');
		expect(
			render(
				new SQLiteDialect(),
				compile('sqlite', ascLast),
			).toLowerCase(),
		).toContain('asc nulls last');
	});

	test('emulates only non-default NULL placement on MySQL', () => {
		const mysql = new MySqlDialect();
		const ascLast = render(
			mysql,
			compile('mysql', { value: { direction: 'asc', nulls: 'last' } }),
		).toLowerCase();
		const descFirst = render(
			mysql,
			compile('mysql', { value: { direction: 'desc', nulls: 'first' } }),
		).toLowerCase();
		const ascFirst = render(
			mysql,
			compile('mysql', { value: { direction: 'asc', nulls: 'first' } }),
		).toLowerCase();
		const descLast = render(
			mysql,
			compile('mysql', { value: { direction: 'desc', nulls: 'last' } }),
		).toLowerCase();

		expect(ascLast).toMatch(/is null\)? asc/);
		expect(descFirst).toMatch(/is null\)? desc/);
		expect(ascFirst).not.toContain('is null');
		expect(descLast).not.toContain('is null');
	});

	test('uses each dialect default for cursor NULL comparisons', () => {
		const pgAsc = renderCursor(
			new PgDialect(),
			compileCursor('pg', { value: 10 }, { value: 'asc' }),
		);
		const pgDesc = renderCursor(
			new PgDialect(),
			compileCursor('pg', { value: 10 }, { value: 'desc' }),
		);
		const sqliteAsc = renderCursor(
			new SQLiteDialect(),
			compileCursor('sqlite', { value: 10 }, { value: 'asc' }),
		);
		const sqliteDesc = renderCursor(
			new SQLiteDialect(),
			compileCursor('sqlite', { value: 10 }, { value: 'desc' }),
		);
		const mysqlAsc = renderCursor(
			new MySqlDialect(),
			compileCursor('mysql', { value: 10 }, { value: 'asc' }),
		);
		const mysqlDesc = renderCursor(
			new MySqlDialect(),
			compileCursor('mysql', { value: 10 }, { value: 'desc' }),
		);
		const mysqlNullsFirst = renderCursor(
			new MySqlDialect(),
			compileCursor(
				'mysql',
				{ value: null },
				{ value: { direction: 'asc', nulls: 'first' } },
			),
		);
		const mysqlNullsLast = renderCursor(
			new MySqlDialect(),
			compileCursor(
				'mysql',
				{ value: null },
				{ value: { direction: 'asc', nulls: 'last' } },
			),
		);

		expect(pgAsc).toContain('is null');
		expect(pgDesc).not.toContain('is null');
		expect(sqliteAsc).not.toContain('is null');
		expect(sqliteDesc).toContain('is null');
		expect(mysqlAsc).not.toContain('is null');
		expect(mysqlDesc).toContain('is null');
		expect(mysqlNullsFirst).toContain('is not null');
		expect(mysqlNullsLast).toContain('false');
	});
});

test('emulates MySQL NULL placement on relation sort expressions', () => {
	const authors = mysqlTable('order_authors', {
		id: int('id').primaryKey(),
		name: varchar('name', { length: 255 }),
	});
	const books = mysqlTable('order_books', {
		id: int('id').primaryKey(),
		authorId: int('author_id'),
	});
	const relations = defineRelations({ authors, books }, (r) => ({
		books: {
			author: r.one.authors({ from: r.books.authorId, to: r.authors.id }),
		},
	}));
	const context = createRuntimeContext(drizzleMysql.mock({ relations }), {});
	const clauses = compileOrderBy(
		{
			...context,
			runtime: getTableRuntime(context, 'books'),
			tableName: 'books',
		} as never,
		{ author: { name: { direction: 'asc', nulls: 'last' } } } as never,
	);
	const query = new MySqlDialect()
		.sqlToQuery(
			sql`select * from ${books} order by ${sql.join(clauses ?? [], sql`, `)}`,
		)
		.sql.toLowerCase();

	const subquery =
		'select `name` from `order_authors` `__better_order_0` where `__better_order_0`.`id` = `order_books`.`author_id` limit ?';
	expect(query).toContain(
		`order by (((${subquery})) is null) asc, ((${subquery})) asc`,
	);
	expect(query).not.toContain('nulls last');
});
