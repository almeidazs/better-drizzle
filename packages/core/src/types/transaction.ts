import { BetterDrizzleError, BetterDrizzleErrorCode } from '../shared/errors';
import type { AnyPlugin } from './plugins';
import type { AnySchema } from './utils';

/**
 * SQL isolation levels supported by transaction options.
 *
 * - `'readUncommitted'` – lowest isolation; allows dirty reads.
 * - `'readCommitted'` – default for most databases.
 * - `'repeatableRead'` – prevents non-repeatable reads.
 * - `'serializable'` – highest isolation; fully serializable.
 */
export type TransactionIsolationLevel =
	| 'readUncommitted'
	| 'readCommitted'
	| 'repeatableRead'
	| 'serializable';

/**
 * Categorises the reason a transaction attempt failed. Used by the retry
 * logic to decide whether a failed attempt should be retried.
 *
 * - `'connectionError'` – the database connection was lost or refused.
 * - `'deadlock'` – the database detected a deadlock.
 * - `'serializationFailure'` – a serializable transaction conflicted.
 */
export type TransactionRetryReason =
	| 'connectionError'
	| 'deadlock'
	| 'serializationFailure';

/**
 * Configuration for automatic transaction retries.
 */
export type TransactionRetryOptions = {
	/** Maximum number of attempts (must be >= 2 to enable retries). */
	attempts: number;
	/** Retry reasons that trigger a retry. Defaults to all three reasons. */
	on?: TransactionRetryReason[];
	/** Delay between attempts in ms, or a function that receives the attempt
	 *  number (1-indexed) and returns the delay. Defaults to `0`. */
	delayMs?: number | ((attempt: number) => number);
};

/**
 * Options passed to {@link BetterDrizzleClient.transaction}. Controls
 * isolation, read-only mode, retries, timeouts, and lifecycle context.
 */
export type TransactionOptions = {
	/** SQL isolation level for the transaction. Ignored on SQLite. */
	isolationLevel?: TransactionIsolationLevel;
	/** When `true`, opens the transaction in read-only mode. Ignored on SQLite. */
	readOnly?: boolean;
	/** Automatic retry configuration. */
	retries?: TransactionRetryOptions;
	/** Maximum duration in ms before the transaction is aborted. */
	timeoutMs?: number;
	/** An `AbortSignal` whose abort event rolls back the transaction. */
	signal?: AbortSignal;
	/** Custom context object merged into the transaction-scoped context. */
	context?: Record<string, unknown>;
	/** Optional name for named transactions (PostgreSQL SAVEPOINT). */
	name?: string;
	/** Comment attached to the transaction (PostgreSQL only). */
	comment?: string;
};

/**
 * How the client behaves when a transaction option is not supported by the
 * current SQL dialect (e.g. `isolationLevel` on SQLite).
 *
 * - `'ignore'` – silently skip the option.
 * - `'throw'` – throw an error.
 * - `'warn'` – log a `console.warn`. This is the default.
 */
export type TransactionUnsupportedOptionsBehavior = 'ignore' | 'throw' | 'warn';

/**
 * Error thrown when a transaction is explicitly rolled back via the
 * `rollback()` method on a transaction client.
 *
 * The optional `reason` property carries the value passed to `rollback()`.
 */
export class BetterDrizzleTransactionRollbackError extends BetterDrizzleError {
	/** The optional reason supplied to `rollback()`. */
	reason?: unknown;

	constructor(reason?: unknown) {
		super({
			code: BetterDrizzleErrorCode.TransactionRollback,
			cause: reason,
			details: { reason },
			message:
				typeof reason === 'string' && reason
					? reason
					: 'Transaction rolled back.',
		});

		this.reason = reason;
		this.name = 'BetterDrizzleTransactionRollbackError';
	}
}

/**
 * A full Better Drizzle client available inside a transaction callback.
 * Extends {@link BetterDrizzleClient} with transaction-specific methods:
 * `transaction()` for nested savepoints, `rollback()` to abort,
 * `afterCommit()` and `afterRollback()` for lifecycle callbacks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to `BetterMeta`.
 * @typeParam Plugins - The plugin tuple.
 */
export type BetterDrizzleTransactionClient<
	Schema extends AnySchema,
	Meta = import('./query').BetterMeta,
	Plugins extends readonly AnyPlugin[] = [],
> = import('./delegate').BetterDrizzleClient<Schema, Meta, Plugins> & {
	/** Starts a nested transaction (savepoint) inside the current one. */
	transaction<T>(
		callback: (
			tx: BetterDrizzleTransactionClient<Schema, Meta, Plugins>,
		) => Promise<T> | T,
		options?: TransactionOptions,
	): Promise<T>;
	/** Rolls back the current transaction, optionally with a reason. */
	rollback(reason?: unknown): never;
	/** Registers a callback to run after the transaction commits. */
	afterCommit(callback: () => unknown | Promise<unknown>): void;
	/** Registers a callback to run after the transaction rolls back. */
	afterRollback(callback: () => unknown | Promise<unknown>): void;
};
