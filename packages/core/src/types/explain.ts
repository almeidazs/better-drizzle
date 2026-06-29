import type { DatabaseDriver } from '../shared/errors';

/**
 * Options that control how `EXPLAIN` is executed and what metadata is returned.
 *
 * Not every driver supports every option. Unsupported options are silently
 * ignored and reported in {@link ExplainStatement.ignoredOptions} so callers
 * can detect when a flag had no effect.
 *
 * @example
 * ```ts
 * const result = await db.repository('users')
 *   .findMany({ where: { active: true } })
 *   .explain({ analyze: true, verbose: true });
 * ```
 */
export type ExplainOptions = {
	/**
	 * When `true`, the database runs the query and reports actual execution
	 * statistics instead of estimates.
	 *
	 * - **PostgreSQL**: supported — maps to `EXPLAIN (ANALYZE true)`.
	 * - **MySQL**: supported — maps to `EXPLAIN ANALYZE`.
	 * - **SQLite**: not supported — reported as ignored.
	 */
	analyze?: boolean;

	/**
	 * When `true`, the output includes additional columns such as the
	 * output schema of each plan node.
	 *
	 * - **PostgreSQL**: supported — maps to `EXPLAIN (VERBOSE true)`.
	 * - **MySQL**: not supported — reported as ignored.
	 * - **SQLite**: not supported — reported as ignored.
	 */
	verbose?: boolean;

	/**
	 * When `false`, the estimated startup and total cost of each plan node
	 * are omitted from the output.
	 *
	 * - **PostgreSQL**: supported — maps to `EXPLAIN (COSTS false)`.
	 * - **MySQL**: not supported — reported as ignored.
	 * - **SQLite**: not supported — reported as ignored.
	 */
	costs?: boolean;

	/**
	 * When `false`, the actual time spent in each plan node is omitted even
	 * when `analyze` is `true`.
	 *
	 * - **PostgreSQL**: supported — maps to `EXPLAIN (TIMING false)`.
	 * - **MySQL**: not supported — reported as ignored.
	 * - **SQLite**: not supported — reported as ignored.
	 */
	timing?: boolean;

	/**
	 * When `false`, the summary line (e.g. "Planning Time", "Execution Time")
	 * is omitted from the output.
	 *
	 * - **PostgreSQL**: supported — maps to `EXPLAIN (SUMMARY false)`.
	 * - **MySQL**: not supported — reported as ignored.
	 * - **SQLite**: not supported — reported as ignored.
	 */
	summary?: boolean;

	/**
	 * Optional timeout in milliseconds for the `EXPLAIN` execution itself.
	 *
	 * If the database does not return within this window the operation is
	 * rejected with a `BetterDrizzleError` whose code is `RAW_TIMEOUT`.
	 * A value of `0` or less throws immediately without running the query.
	 *
	 * This option is driver-agnostic and applies to all dialects.
	 */
	timeoutMs?: number;

	/**
	 * Optional name for the prepared statement created by `EXPLAIN`.
	 *
	 * - **PostgreSQL**: supported — maps to `EXPLAIN (NAME '...')`.
	 * - **MySQL**: not supported — reported as ignored.
	 * - **SQLite**: not supported — reported as ignored.
	 */
	name?: string;

	/**
	 * Optional SQL comment that is prepended to the explained query.
	 *
	 * The comment is sanitized to prevent SQL injection via comment
	 * termination: the star-slash sequence is split with a space.
	 *
	 * - **PostgreSQL**: supported -- prepended as a block comment before the query.
	 * - **MySQL**: not supported -- reported as ignored.
	 * - **SQLite**: not supported -- reported as ignored.
	 */
	comment?: string;
};

/**
 * The set of read operations that support `.explain()`.
 *
 * Write operations (`create`, `update`, `delete`, etc.) do **not** support
 * explain and will throw if `.explain()` is called on their results.
 */
export type ExplainOperation =
	| 'count'
	| 'cursor'
	| 'exists'
	| 'findFirst'
	| 'findMany'
	| 'findOne'
	| 'findUnique'
	| 'paginate';

/**
 * A single statement inside an {@link ExplainResult}.
 *
 * Complex operations such as `paginate` and `cursor` may produce multiple
 * statements (e.g. one for the data query one for the total count, or
 * probe queries for `hasNext`/`hasPrevious`).
 *
 * @example
 * ```ts
 * const result = await client.users
 *   .findMany({ where: { active: true } })
 *   .explain();
 *
 * const stmt = result.statements[0];
 * console.log(stmt.key);            // "data"
 * console.log(stmt.sql);            // "select ... from users where ..."
 * console.log(stmt.params);         // []
 * console.log(stmt.appliedOptions); // {}
 * console.log(stmt.ignoredOptions); // []
 * console.log(stmt.raw);            // [{ "QUERY PLAN": "Seq Scan on users" }]
 * ```
 */
export interface ExplainStatement {
	/**
	 * A stable key identifying the role of this statement within the
	 * operation (e.g. `"data"`, `"total"`, `"probe:hasNext"`).
	 */
	key: string;

	/**
	 * The compiled SQL string that was sent to the database, **without**
	 * the `EXPLAIN` prefix.
	 */
	sql: string;

	/**
	 * The ordered list of parameter values bound to the SQL string.
	 */
	params: unknown[];

	/**
	 * The subset of {@link ExplainOptions} that were actually applied by
	 * the driver. Options unsupported by the current dialect are excluded.
	 */
	appliedOptions: Partial<ExplainOptions>;

	/**
	 * The {@link ExplainOptions} keys that were provided but are not
	 * supported by the current driver and were therefore ignored.
	 */
	ignoredOptions: Array<keyof ExplainOptions>;

	/**
	 * The raw result returned by the database driver for this `EXPLAIN`
	 * statement. The shape varies by driver:
	 *
	 * - **PostgreSQL**: an array of row objects from `pg`'s `EXPLAIN` output.
	 * - **MySQL**: an array of row objects from `EXPLAIN [ANALYZE]`.
	 * - **SQLite**: an array of `{ id, parent, detail }` objects from
	 *   `EXPLAIN QUERY PLAN`.
	 */
	raw: unknown;
}

/**
 * The full result of an `.explain()` call on a read operation.
 *
 * Contains the dialect, the operation name, and one or more
 * {@link ExplainStatement}s that describe the queries executed.
 *
 * @example
 * ```ts
 * const result = await client.users
 *   .findMany({ where: { active: true } })
 *   .explain({ analyze: true });
 *
 * console.log(result.driver);      // "sqlite" | "pg" | "mysql"
 * console.log(result.operation);   // "findMany"
 * console.log(result.statements);  // [{ key: "data", sql: "...", ... }]
 * ```
 *
 * @example
 * ```ts
 * // paginate() produces two statements
 * const result = await client.users
 *   .paginate({ limit: 10, orderBy: { id: "asc" } })
 *   .explain();
 *
 * console.log(result.statements.map(s => s.key));
 * // ["data", "total"]
 * ```
 */
export interface ExplainResult {
	/**
	 * The database driver that was used to execute the `EXPLAIN`.
	 */
	driver: Exclude<DatabaseDriver, 'unknown'>;

	/**
	 * The operation that was explained (e.g. `"findMany"`, `"paginate"`).
	 */
	operation: ExplainOperation;

	/**
	 * The statements produced by the `EXPLAIN`. Most operations yield a
	 * single statement; `paginate` yields two (`data` + `total`), and
	 * `cursor` may yield additional probe statements.
	 */
	statements: ExplainStatement[];
}

/**
 * A `Promise<T>` augmented with an `.explain()` method.
 *
 * Calling `.explain()` does **not** start the underlying database operation.
 * It runs the `EXPLAIN` path independently while preserving native promise
 * behavior for `await`, `.then()`, and test helpers such as
 * `expect(...).resolves` / `expect(...).rejects`.
 *
 * @typeParam T - The resolved type of the underlying operation.
 *
 * @example
 * ```ts
 * const result = db.repository('users').findMany({ where: { active: true } });
 *
 * // Inspect the plan without running the query
 * const plan = await result.explain({ analyze: true });
 * console.log(plan.statements[0].sql);
 *
 * // Now actually run the query
 * const users = await result;
 * ```
 */
export type ExplainableResult<T> = Promise<T> & {
	/**
	 * Returns the `EXPLAIN` plan for the underlying operation without
	 * executing it.
	 *
	 * @param options - Optional flags that control the `EXPLAIN` output.
	 *   See {@link ExplainOptions} for per-dialect support details.
	 * @returns A promise that resolves to an {@link ExplainResult} containing
	 *   the dialect, operation name, and statement details.
	 */
	explain(options?: ExplainOptions): Promise<ExplainResult>;
};
