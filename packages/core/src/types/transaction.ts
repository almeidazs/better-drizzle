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
 *
 * @example
 * ```ts
 * await db.transaction(async (tx) => {
 *   // ...
 * }, { isolationLevel: 'serializable' });
 * ```
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
 *
 * @example
 * ```ts
 * await db.transaction(async (tx) => {
 *   // ...
 * }, {
 *   retries: {
 *     attempts: 3,
 *     on: ['deadlock', 'serializationFailure'],
 *   },
 * });
 * ```
 */
export type TransactionRetryReason =
	| 'connectionError'
	| 'deadlock'
	| 'serializationFailure';

/**
 * Configuration for automatic transaction retries.
 *
 * @example
 * ```ts
 * await db.transaction(async (tx) => {
 *   // ...
 * }, {
 *   retries: {
 *     attempts: 3,
 *     on: ['deadlock', 'connectionError'],
 *     delayMs: (attempt) => attempt * 100,
 *   },
 * });
 * ```
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
 *
 * @example
 * ```ts
 * // Basic transaction
 * await db.transaction(async (tx) => {
 *   const user = await tx.user.findFirst({ where: { id: 1 } });
 *   await tx.user.update({ where: { id: 1 }, data: { active: false } });
 * });
 *
 * // With options
 * await db.transaction(async (tx) => {
 *   // ...
 * }, {
 *   isolationLevel: 'serializable',
 *   readOnly: false,
 *   timeoutMs: 10000,
 *   retries: { attempts: 3 },
 *   context: { requestId: 'abc-123' },
 * });
 *
 * // With AbortSignal
 * const controller = new AbortController();
 * setTimeout(() => controller.abort(), 5000);
 * await db.transaction(async (tx) => {
 *   // ...
 * }, { signal: controller.signal });
 * ```
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
	/** Optional metadata merged over any client-scoped context. */
	meta?: import('./query').BetterMeta;
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
 *
 * @example
 * ```ts
 * const db = better(drizzle, {
 *   schema,
 *   transaction: { unsupportedOptions: 'throw' },
 * });
 * ```
 */
export type TransactionUnsupportedOptionsBehavior = 'ignore' | 'throw' | 'warn';

/**
 * Error thrown when a transaction is explicitly rolled back via the
 * `rollback()` method on a transaction client.
 *
 * The optional `reason` property carries the value passed to `rollback()`.
 *
 * @example
 * ```ts
 * await db.transaction(async (tx) => {
 *   // ...
 *   tx.rollback('Something went wrong');
 *   // This line is never reached
 * });
 * // Catching the rollback error
 * try {
 *   await db.transaction(async (tx) => {
 *     tx.rollback(new Error('Aborted'));
 *   });
 * } catch (error) {
 *   if (error instanceof BetterDrizzleTransactionRollbackError) {
 *     console.log('Rollback reason:', error.reason);
 *   }
 * }
 * ```
 */
export class BetterDrizzleTransactionRollbackError extends BetterDrizzleError {
	/** The optional reason supplied to `rollback()`. */
	reason?: unknown;

	/**
	 * Creates a new `BetterDrizzleTransactionRollbackError`.
	 *
	 * @param reason - The optional reason passed to `rollback()`.
	 */
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
 *
 * @example
 * ```ts
 * await db.transaction(async (tx) => {
 *   // Full CRUD access
 *   const user = await tx.user.findFirst({ where: { id: 1 } });
 *   await tx.user.update({ where: { id: 1 }, data: { active: false } });
 *
 *   // Nested transaction (savepoint)
 *   await tx.transaction(async (nestedTx) => {
 *     await nestedTx.post.create({ data: { title: 'Hello', authorId: 1 } });
 *   });
 *
 *   // Lifecycle callbacks
 *   tx.afterCommit(() => console.log('Committed!'));
 *   tx.afterRollback(() => console.log('Rolled back!'));
 *
 *   // Explicit rollback
 *   tx.rollback('Something went wrong');
 * });
 * ```
 */
export type BetterDrizzleTransactionClient<
	Schema extends AnySchema,
	Meta = import('./query').BetterMeta,
	Plugins extends readonly AnyPlugin[] = [],
> = import('./delegate').BetterDrizzleClient<Schema, Meta, Plugins> & {
	/**
	 * Extends the current transaction client with custom properties and helper
	 * methods. The extension is reapplied to nested transactions and scoped
	 * clones derived from this transaction client.
	 */
	extends<Extension extends Record<string, unknown>>(
		extension:
			| Extension
			| ((
					client: BetterDrizzleTransactionClient<
						Schema,
						Meta,
						Plugins
					>,
			  ) => Extension | undefined),
	): BetterDrizzleTransactionClient<Schema, Meta, Plugins> & Extension;
	/**
	 * Returns a cloned transaction client with default metadata merged into
	 * every subsequent operation, raw query, and nested transaction.
	 */
	$withContext(
		meta: Partial<Meta>,
	): BetterDrizzleTransactionClient<Schema, Meta, Plugins>;
	/**
	 * Starts a nested transaction (savepoint) inside the current one.
	 *
	 * On SQLite, savepoints are managed explicitly with `SAVEPOINT` SQL.
	 * On other dialects, this delegates to the Drizzle transaction runner.
	 *
	 * @typeParam T - The return type of the callback.
	 * @param callback - A function receiving the nested transaction client.
	 * @param options - Optional nested transaction options.
	 * @returns A promise resolving to the callback's return value.
	 */
	transaction<T>(
		callback: (
			tx: BetterDrizzleTransactionClient<Schema, Meta, Plugins>,
		) => Promise<T> | T,
		options?: TransactionOptions & { meta?: Meta },
	): Promise<T>;
	/**
	 * Rolls back the current transaction, optionally with a reason.
	 *
	 * Throws a {@link BetterDrizzleTransactionRollbackError} that propagates
	 * out of the transaction callback. Code after `rollback()` is unreachable.
	 *
	 * @param reason - An optional value describing why the transaction was rolled back.
	 */
	rollback(reason?: unknown): never;
	/**
	 * Registers a callback to run after the transaction commits.
	 *
	 * Inside nested transactions, the callback is deferred to the root commit.
	 *
	 * @param callback - A function to run after commit. May be async.
	 *
	 * @example
	 * ```ts
	 * await db.transaction(async (tx) => {
	 *   await tx.user.create({ data: { name: 'Alice' } });
	 *   tx.afterCommit(() => sendWelcomeEmail('alice@example.com'));
	 * });
	 * ```
	 */
	afterCommit(callback: () => unknown | Promise<unknown>): void;
	/**
	 * Registers a callback to run after the transaction rolls back.
	 *
	 * @param callback - A function to run after rollback. May be async.
	 *
	 * @example
	 * ```ts
	 * await db.transaction(async (tx) => {
	 *   tx.afterRollback(() => console.log('Transaction failed, cleaning up...'));
	 *   // ...
	 * });
	 * ```
	 */
	afterRollback(callback: () => unknown | Promise<unknown>): void;
};
