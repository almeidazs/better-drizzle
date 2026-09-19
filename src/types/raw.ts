import type { SQL, SQLWrapper } from 'drizzle-orm';

/**
 * Options supported by raw SQL client methods.
 *
 * @typeParam Row - Input row shape returned by the driver before mapping.
 * @typeParam Mapped - Output row shape returned after `map()` runs.
 * @typeParam Meta - Custom metadata type forwarded to raw hooks.
 *
 * @example
 * ```ts
 * const users = await db.$raw(
 *   sql`SELECT * FROM users WHERE active = ${true}`,
 *   {
 *     name: 'active-users',
 *     comment: 'Fetch active users',
 *     meta: { requestId: 'abc-123' },
 *     timeoutMs: 5000,
 *     map: (row) => ({ ...row, name: row.name.toUpperCase() }),
 *   },
 * );
 * ```
 */
export type RawOptions<
	Row = unknown,
	Mapped = Row,
	Meta = import('./query').BetterMeta,
> = {
	/**
	 * Optional human-readable name for logs or debugging.
	 */
	name?: string;
	/**
	 * Optional SQL comment metadata. Only supported on PostgreSQL.
	 */
	comment?: string;
	/**
	 * Maximum duration in ms before the raw query is aborted.
	 */
	timeoutMs?: number;
	/**
	 * AbortSignal used to cancel the raw query.
	 */
	signal?: AbortSignal;
	/**
	 * Optional metadata merged over any client-scoped context.
	 */
	meta?: Meta;
	/**
	 * Optional row mapper applied to each returned row.
	 *
	 * @param row - The raw row from the driver.
	 * @returns The mapped row.
	 */
	map?: (row: Row) => Mapped;
};

/**
 * Global raw SQL configuration. Passed to {@link better} via `options.raw`.
 *
 * @example
 * ```ts
 * const db = better(drizzle, {
 *   schema,
 *   raw: {
 *     enabled: true,
 *     allowUnsafe: true,
 *     requireComment: false,
 *     timeoutMs: 10000,
 *   },
 * });
 * ```
 */
export type RawClientOptions = {
	/** Enables raw SQL methods on the client. Defaults to `true`. */
	enabled?: boolean;
	/** Allows calling `$rawUnsafe()`. Defaults to `false`. */
	allowUnsafe?: boolean;
	/** Requires every raw call to provide `options.comment`. Defaults to `false`. */
	requireComment?: boolean;
	/** Default timeout in ms applied when a raw call omits `timeoutMs`. */
	timeoutMs?: number;
	/** Enables raw-query logging metadata. */
	log?: boolean;
	/** How unsupported raw options should behave. Defaults to `'warn'`. */
	unsupportedOptions?: 'warn' | 'throw' | 'ignore';
};

/**
 * Normalized result returned by `$executeRaw()`.
 *
 * @example
 * ```ts
 * const result = await db.$executeRaw`UPDATE users SET active = false`;
 * console.log(result.rowsAffected); // number of updated rows
 * ```
 */
export type RawExecutionResult = {
	/** The number of rows affected by the statement, when available. */
	rowsAffected?: number;
};

/**
 * Safe raw SQL input accepted by `$raw()` and `$executeRaw()`.
 *
 * Can be a Drizzle `SQL` instance or any object implementing `getSQL()`.
 *
 * @example
 * ```ts
 * import { sql } from 'drizzle-orm';
 * const query = sql`SELECT * FROM users WHERE id = ${1}`;
 * const rows = await db.$raw(query);
 * ```
 */
export type RawSql = SQL | SQLWrapper;
