import type { SQL, SQLWrapper } from 'drizzle-orm';

/**
 * Options supported by raw SQL client methods.
 *
 * @typeParam Row - Input row shape returned by the driver before mapping.
 * @typeParam Mapped - Output row shape returned after `map()` runs.
 */
export type RawOptions<Row = unknown, Mapped = Row> = {
	/**
	 * Optional human-readable name for logs or debugging.
	 */
	name?: string;
	/**
	 * Optional SQL comment metadata.
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
	 * Optional row mapper applied to each returned row.
	 */
	map?: (row: Row) => Mapped;
};

/**
 * Global raw SQL configuration.
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
 */
export type RawExecutionResult = {
	rowsAffected?: number;
};

/**
 * Safe raw SQL input accepted by `$raw()` and `$executeRaw()`.
 */
export type RawSql = SQL | SQLWrapper;
