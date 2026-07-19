import { SQL, sql } from 'drizzle-orm';

import type {
	AnyPlugin,
	AnySchema,
	BetterTableKey,
	CursorArgs,
	ExplainOperation,
	ExplainOptions,
	ExplainResult,
	ExplainStatement,
	PaginationArgs,
	QueryArgs,
	RuntimeContext,
	WhereArg,
} from '../../types';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';
import {
	buildCountQuery,
	buildCursorPaginationQuery,
	buildOffsetPaginationQuery,
} from '../query';
import {
	buildExistsQuery,
	buildFindFirstQuery,
	buildFindManyQuery,
	getCursorExplainProbes,
} from './operations';
import { getDeferredRelationPlans } from './relations';

type ExplainableQuery = {
	key: string;
	query: SQL;
};

type ExplainDriver = ExplainResult['driver'];

const getQueryConfig = (dialect: ExplainDriver) => ({
	casing: {
		getColumnCasing(column: { name?: string }) {
			return column.name ?? '';
		},
	} as never,
	escapeName(name: string) {
		if (dialect === 'pg') return `"${name.replaceAll('"', '""')}"`;
		return `\`${name.replaceAll('`', '``')}\``;
	},
	escapeParam(index: number) {
		if (dialect === 'pg') return `$${index + 1}`;
		return '?';
	},
	escapeString(value: string) {
		return value;
	},
	inlineParams: false,
	paramStartIndex: { value: 0 },
});

const getStatementQuery = (dialect: ExplainDriver, query: SQL) =>
	query.toQuery(getQueryConfig(dialect));

const getUnsupportedExplainOptionKeys = (
	dialect: ExplainDriver,
	options: ExplainOptions,
) => {
	const ignored: Array<keyof ExplainOptions> = [];

	if (dialect === 'sqlite') {
		if (options.analyze !== undefined) ignored.push('analyze');
		if (options.verbose !== undefined) ignored.push('verbose');
		if (options.costs !== undefined) ignored.push('costs');
		if (options.timing !== undefined) ignored.push('timing');
		if (options.summary !== undefined) ignored.push('summary');
		if (options.name !== undefined) ignored.push('name');
		if (options.comment !== undefined) ignored.push('comment');
		return ignored;
	}

	if (dialect === 'mysql') {
		if (options.verbose !== undefined) ignored.push('verbose');
		if (options.costs !== undefined) ignored.push('costs');
		if (options.timing !== undefined) ignored.push('timing');
		if (options.summary !== undefined) ignored.push('summary');
		if (options.name !== undefined) ignored.push('name');
		if (options.comment !== undefined) ignored.push('comment');
	}

	return ignored;
};

const getAppliedExplainOptions = (
	dialect: ExplainDriver,
	options: ExplainOptions,
) => {
	const ignored = new Set(getUnsupportedExplainOptionKeys(dialect, options));
	const applied = Object.create(null) as Partial<ExplainOptions>;

	for (const key of Object.keys(options) as Array<keyof ExplainOptions>) {
		if (options[key] === undefined || ignored.has(key)) continue;
		applied[key] = options[key] as never;
	}

	return applied;
};

const withExplainComment = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	query: SQL,
	comment: string | undefined,
) => {
	if (!comment) return query;
	if (context.dialect !== 'pg') return query;

	const sanitized = comment.replaceAll('*/', '* /');
	return sql.join([sql.raw(`/* ${sanitized} */ `), query]);
};

const buildExplainQuery = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	query: SQL,
	options: ExplainOptions,
) => {
	if (context.dialect === 'sqlite')
		return sql.join([sql.raw('EXPLAIN QUERY PLAN '), query]);

	if (context.dialect === 'mysql')
		return sql.join([
			sql.raw(options.analyze ? 'EXPLAIN ANALYZE ' : 'EXPLAIN '),
			query,
		]);

	const parts = [];

	if (options.analyze !== undefined)
		parts.push(`ANALYZE ${options.analyze ? 'true' : 'false'}`);
	if (options.verbose !== undefined)
		parts.push(`VERBOSE ${options.verbose ? 'true' : 'false'}`);
	if (options.costs !== undefined)
		parts.push(`COSTS ${options.costs ? 'true' : 'false'}`);
	if (options.timing !== undefined)
		parts.push(`TIMING ${options.timing ? 'true' : 'false'}`);
	if (options.summary !== undefined)
		parts.push(`SUMMARY ${options.summary ? 'true' : 'false'}`);

	if (!parts.length) return sql.join([sql.raw('EXPLAIN '), query]);
	return sql.join([sql.raw(`EXPLAIN (${parts.join(', ')}) `), query]);
};

const withTimeout = async <T>(
	timeoutMs: number | undefined,
	run: () => Promise<T>,
) => {
	if (timeoutMs === undefined) return run();
	if (timeoutMs <= 0)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.RawTimeout,
			message: 'Explain query timed out.',
			operation: 'explain',
		});

	let timer: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			run(),
			new Promise<T>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new BetterDrizzleError({
								code: BetterDrizzleErrorCode.RawTimeout,
								message: 'Explain query timed out.',
								operation: 'explain',
							}),
						),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

const executeExplainQuery = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	query: SQL,
	options: ExplainOptions,
) => {
	if (context.dialect === 'sqlite') {
		const built = getStatementQuery(context.dialect, query);
		const session = (
			context.db as {
				session?: {
					client?: {
						prepare?: (sqlText: string) => {
							all?: (...params: unknown[]) => unknown;
							run?: (...params: unknown[]) => unknown;
						};
					};
				};
			}
		).session;
		const prepared = session?.client?.prepare?.(built.sql);

		if (prepared?.all)
			return withTimeout(options.timeoutMs, async () =>
				prepared.all?.(...built.params),
			);
	}

	const execute = context.db.execute;
	if (typeof execute === 'function')
		return withTimeout(options.timeoutMs, async () =>
			execute.call(context.db, query),
		);

	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.OperationError,
		message:
			'The provided Drizzle client does not support EXPLAIN execution.',
		operation: 'explain',
	});
};

const asExplainableSql = (query: unknown) => {
	if (query instanceof SQL) return query;
	if (
		typeof query === 'object' &&
		query !== null &&
		'getSQL' in query &&
		typeof (query as { getSQL?: unknown }).getSQL === 'function'
	)
		return (query as { getSQL(): SQL }).getSQL();

	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.OperationError,
		message: 'Could not extract SQL for explain().',
		operation: 'explain',
	});
};

const explainStatement = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	statement: ExplainableQuery,
	options: ExplainOptions,
): Promise<ExplainStatement> => {
	const query = withExplainComment(context, statement.query, options.comment);
	const raw = await executeExplainQuery(
		context,
		buildExplainQuery(context, query, options),
		options,
	);
	const built = getStatementQuery(context.dialect, statement.query);

	return {
		appliedOptions: getAppliedExplainOptions(context.dialect, options),
		ignoredOptions: getUnsupportedExplainOptionKeys(
			context.dialect,
			options,
		),
		key: statement.key,
		params: built.params,
		raw,
		sql: built.sql,
	};
};

const buildQueryList = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	tableName: BetterTableKey<Schema>,
	operation: ExplainOperation,
	args: unknown,
) => {
	switch (operation) {
		case 'findMany':
			return [
				{
					key: 'data',
					query: asExplainableSql(
						buildFindManyQuery(
							context,
							tableName,
							args as
								| QueryArgs<
										Schema,
										BetterTableKey<Schema>,
										Meta
								  >
								| undefined,
							'findMany',
						),
					),
				},
			] satisfies ExplainableQuery[];
		case 'findFirst':
		case 'findOne':
		case 'findUnique':
			return [
				{
					key: 'data',
					query: asExplainableSql(
						buildFindFirstQuery(
							context,
							tableName,
							args as
								| QueryArgs<
										Schema,
										BetterTableKey<Schema>,
										Meta
								  >
								| undefined,
							operation,
						),
					),
				},
			] satisfies ExplainableQuery[];
		case 'count': {
			const countArgs = args as {
				cursor?: CursorArgs<
					Schema,
					BetterTableKey<Schema>,
					Meta
				>['cursor'];
				where?: WhereArg<Schema, BetterTableKey<Schema>>;
			};
			return [
				{
					key: 'count',
					query: asExplainableSql(
						buildCountQuery(
							context,
							tableName,
							countArgs.where,
							countArgs.cursor,
						),
					),
				},
			] satisfies ExplainableQuery[];
		}
		case 'exists':
			return [
				{
					key: 'exists',
					query: asExplainableSql(
						buildExistsQuery(
							context,
							tableName,
							args as {
								cursor?: CursorArgs<
									Schema,
									BetterTableKey<Schema>,
									Meta
								>['cursor'];
								where?: WhereArg<
									Schema,
									BetterTableKey<Schema>
								>;
							},
						),
					),
				},
			] satisfies ExplainableQuery[];
		case 'paginate': {
			const paginationArgs = args as PaginationArgs<
				Schema,
				BetterTableKey<Schema>,
				Meta
			>;
			const { query } = buildOffsetPaginationQuery(paginationArgs);
			return [
				{
					key: 'data',
					query: asExplainableSql(
						buildFindManyQuery(
							context,
							tableName,
							query,
							'paginate',
						),
					),
				},
				{
					key: 'total',
					query: asExplainableSql(
						buildCountQuery(
							context,
							tableName,
							paginationArgs.where,
						),
					),
				},
			] satisfies ExplainableQuery[];
		}
		case 'cursor': {
			const cursorArgs = args as CursorArgs<
				Schema,
				BetterTableKey<Schema>,
				Meta
			>;
			const limit =
				Math.abs(cursorArgs.limit ?? cursorArgs.take ?? 10) || 10;
			const built = buildCursorPaginationQuery(cursorArgs, limit + 1);

			if ('error' in built)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.OperationError,
					message:
						built.error === 'AMBIGUOUS_CURSOR'
							? 'cursor() accepts either before or after, but not both.'
							: built.error === 'INVALID_BEFORE_CURSOR'
								? 'cursor() before must be a cursor object.'
								: 'cursor() after must be a cursor object.',
					operation: 'cursor',
				});

			const dataQuery = buildFindManyQuery(
				context,
				tableName,
				built.query,
				'cursor',
			);
			const statements = [
				{
					key: 'data',
					query: asExplainableSql(dataQuery),
				},
			] satisfies ExplainableQuery[];
			const probes = await getCursorExplainProbes(
				context,
				tableName,
				cursorArgs,
				built,
				dataQuery,
				limit,
			);

			for (const probe of probes)
				statements.push({
					key: probe.key,
					query: asExplainableSql(probe.query),
				});

			return statements;
		}
	}
};

/**
 * Builds and executes `EXPLAIN` for a single read operation against a table.
 *
 * This is the core explain implementation. It resolves the operation's
 * query or queries (most operations produce one; `paginate` produces two,
 * `cursor` may produce additional probe queries), wraps each in the
 * dialect-appropriate `EXPLAIN` prefix, executes them, and returns a
 * structured {@link ExplainResult}.
 *
 * Cross-dialect behavior:
 * - **PostgreSQL**: `EXPLAIN (ANALYZE, VERBOSE, ...) <query>` with optional
 *   comment and prepared statement name.
 * - **MySQL**: `EXPLAIN [ANALYZE] <query>` -- only `analyze` is honored.
 * - **SQLite**: `EXPLAIN QUERY PLAN <query>` -- no additional options.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - The scoped metadata type.
 * @typeParam Plugins - The plugin tuple type.
 * @param context - The runtime context containing the dialect, Drizzle
 *   client, and precomputed table metadata.
 * @param tableName - The schema key of the table to explain against.
 * @param operation - The read operation to explain (e.g. `"findMany"`).
 * @param args - The operation arguments, typed according to `operation`.
 * @param options - Optional flags that control the `EXPLAIN` output.
 *   Defaults to `{}`.
 * @returns A promise that resolves to an {@link ExplainResult} with the
 *   dialect, operation name, and per-statement details.
 *
 * @example
 * ```ts
 * // SQLite -- all options are ignored, EXPLAIN QUERY PLAN is used
 * const result = await explainOperation(
 *   context,
 *   "users",
 *   "findMany",
 *   { where: { active: true } },
 *   { analyze: true },
 * );
 * // result.driver === "sqlite"
 * // result.statements[0].ignoredOptions === ["analyze"]
 * ```
 *
 * @example
 * ```ts
 * // PostgreSQL -- analyze and verbose are applied
 * const result = await explainOperation(
 *   context,
 *   "users",
 *   "findMany",
 *   { where: { active: true } },
 *   { analyze: true, verbose: true, costs: false },
 * );
 * // result.driver === "pg"
 * // result.statements[0].appliedOptions === { analyze: true, verbose: true, costs: false }
 * ```
 */
export const explainOperation = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	tableName: BetterTableKey<Schema>,
	operation: ExplainOperation,
	args: unknown,
	options: ExplainOptions = {},
): Promise<ExplainResult> => {
	const queries = await buildQueryList(context, tableName, operation, args);

	return {
		deferredRelations: getDeferredRelationPlans(context, tableName, args),
		driver: context.dialect,
		operation,
		statements: await Promise.all(
			queries.map((statement) =>
				explainStatement(context, statement, options),
			),
		),
	};
};
