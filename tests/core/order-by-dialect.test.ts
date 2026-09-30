import { describe, expect, test } from 'bun:test';

import { sql, type SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import { integer, SQLiteDialect, sqliteTable } from 'drizzle-orm/sqlite-core';

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
