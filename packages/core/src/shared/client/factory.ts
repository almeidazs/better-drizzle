import { isTable, sql } from 'drizzle-orm';

import type {
	AnyPlugin,
	AnySchema,
	BetterClientHooks,
	BetterClientOptions,
	BetterDrizzleClient,
	BetterDrizzleTransactionClient,
	BetterMeta,
	BetterTableKey,
	RuntimeContext,
	TransactionOptions,
	TransactionRetryReason,
	TransactionRuntime,
	TransactionUnsupportedOptionsBehavior,
} from '../../types';
import { BetterDrizzleTransactionRollbackError } from '../../types';
import { createDerivedRuntimeContext, createRuntimeContext } from './context';
import { createModelDelegate } from './delegate';
import {
	applyClientExtensions,
	applyModelExtensions,
	initializePlugins,
	runPluginTransactionHooks,
} from './plugins';

class TransactionRollbackSignal {
	reason?: unknown;

	constructor(reason?: unknown) {
		this.reason = reason;
	}
}

const isRollbackSignal = (error: unknown): error is TransactionRollbackSignal =>
	error instanceof TransactionRollbackSignal;

const normalizeRollbackReason = (reason?: unknown) =>
	reason === undefined ? new BetterDrizzleTransactionRollbackError() : reason;

const getUnsupportedBehavior = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
): TransactionUnsupportedOptionsBehavior =>
	context.options.transaction?.unsupportedOptions ?? 'warn';

const handleUnsupportedTransactionOption = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	option: string,
) => {
	const behavior = getUnsupportedBehavior(context);
	const message = `Transaction option "${option}" is not supported for dialect "${context.dialect}".`;

	if (behavior === 'ignore') return;
	if (behavior === 'throw') throw new Error(message);
	console.warn(message);
};

const normalizeIsolationLevel = (
	level: TransactionOptions['isolationLevel'],
) => {
	if (level === 'readUncommitted') return 'read uncommitted';
	if (level === 'readCommitted') return 'read committed';
	if (level === 'repeatableRead') return 'repeatable read';
	if (level === 'serializable') return 'serializable';
	return undefined;
};

const getDrizzleTransactionConfig = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	options: TransactionOptions,
) => {
	const config = Object.create(null) as Record<string, unknown>;
	const isolationLevel = normalizeIsolationLevel(options.isolationLevel);

	if (options.isolationLevel) {
		if (context.dialect === 'sqlite')
			handleUnsupportedTransactionOption(context, 'isolationLevel');
		else if (isolationLevel) config.isolationLevel = isolationLevel;
	}

	if (options.readOnly !== undefined) {
		if (context.dialect === 'sqlite')
			handleUnsupportedTransactionOption(context, 'readOnly');
		else config.accessMode = options.readOnly ? 'read only' : 'read write';
	}

	if (options.comment) handleUnsupportedTransactionOption(context, 'comment');

	return Object.keys(config).length ? config : undefined;
};

const createAbortError = (reason: string) => {
	const error = new Error(reason);
	error.name = 'AbortError';
	return error;
};

const runCallbacks = async (
	callbacks: Array<() => unknown | Promise<unknown>>,
) => {
	for (const callback of callbacks) await callback();
};

const getRetryReason = (error: unknown): TransactionRetryReason | null => {
	const details =
		typeof error === 'object' && error !== null
			? (error as {
					code?: string;
					errno?: string | number;
					message?: string;
				})
			: undefined;
	const code = `${details?.code ?? details?.errno ?? ''}`.toLowerCase();
	const message = `${details?.message ?? ''}`.toLowerCase();

	if (code === '40p01' || code === '1213' || message.includes('deadlock'))
		return 'deadlock';

	if (code === '40001' || message.includes('serialization failure'))
		return 'serializationFailure';

	if (
		code === 'econnreset' ||
		code === 'econnrefused' ||
		code === '08006' ||
		code === '57p01' ||
		message.includes('connection')
	)
		return 'connectionError';

	return null;
};

const shouldRetryTransaction = (
	error: unknown,
	options: TransactionOptions | undefined,
	attempt: number,
) => {
	const retries = options?.retries;
	if (!retries || retries.attempts <= 1 || attempt >= retries.attempts)
		return false;

	const reason = getRetryReason(error);
	if (!reason) return false;

	const allowed = retries.on ?? [
		'deadlock',
		'serializationFailure',
		'connectionError',
	];

	return allowed.includes(reason);
};

const delayRetry = async (
	options: TransactionOptions | undefined,
	attempt: number,
) => {
	const delay = options?.retries?.delayMs;
	const ms =
		typeof delay === 'function'
			? delay(attempt)
			: typeof delay === 'number'
				? delay
				: 0;

	if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
};

const createLifecyclePayload = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	client: BetterDrizzleTransactionClient<Schema, Meta, Plugins>,
	options: TransactionOptions,
) => {
	const transaction = context.transaction;
	if (!transaction)
		throw new Error(
			'Transaction lifecycle payload requires transaction state.',
		);

	const registerAfterCommit = (
		callback: () => unknown | Promise<unknown>,
	) => {
		transaction.afterCommit.push(callback);
	};
	const registerAfterRollback = (
		callback: () => unknown | Promise<unknown>,
	) => {
		transaction.afterRollback.push(callback);
	};

	return {
		afterCommit: registerAfterCommit,
		afterRollback: registerAfterRollback,
		attempt: transaction.attempt,
		client,
		comment: transaction.comment,
		db: context.db,
		dialect: context.dialect,
		depth: transaction.depth,
		isInTransaction: true as const,
		models: context.models,
		name: transaction.name,
		options: context.options,
		schema: context.fullSchema,
		transactionContext: transaction.context,
		transactionOptions: options,
	};
};

const runClientTransactionHook = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	hookName: keyof BetterClientHooks<Schema, Meta, Plugins>,
	payload: Record<string, unknown>,
) => {
	const hook = context.options.hooks?.[hookName];
	if (!hook) return;

	await (hook as (ctx: Record<string, unknown>) => unknown)(payload);
};

const runTransactionHooks = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	hookName:
		| 'afterTransactionCommit'
		| 'afterTransactionRollback'
		| 'beforeTransaction'
		| 'onTransactionError',
	payload: Record<string, unknown>,
) => {
	await runClientTransactionHook(context, hookName, payload);
	await runPluginTransactionHooks(context, hookName, payload);
};

const mergeTransactionQueues = (
	parent: TransactionRuntime,
	child: TransactionRuntime,
) => {
	parent.afterCommit.push(...child.afterCommit);
	parent.afterRollback.push(...child.afterRollback);
};

const bindAbortSignals = (transaction: TransactionRuntime) => {
	const cleanups: Array<() => void> = [];
	const options = transaction.options;
	const abort = (error: unknown) => {
		transaction.abortError = error;
	};

	if (options.timeoutMs !== undefined) {
		if (options.timeoutMs <= 0)
			abort(createAbortError('Transaction timed out.'));
		else {
			const timer = setTimeout(
				() => abort(createAbortError('Transaction timed out.')),
				options.timeoutMs,
			);
			cleanups.push(() => clearTimeout(timer));
		}
	}

	if (options.signal) {
		if (options.signal.aborted)
			abort(
				options.signal.reason ??
					createAbortError('Transaction aborted.'),
			);
		else {
			const onAbort = () =>
				abort(
					options.signal?.reason ??
						createAbortError('Transaction aborted.'),
				);

			options.signal.addEventListener('abort', onAbort, { once: true });
			cleanups.push(() =>
				options.signal?.removeEventListener('abort', onAbort),
			);
		}
	}

	return () => {
		for (const cleanup of cleanups) cleanup();
	};
};

const createTransactionState = (
	parent: TransactionRuntime | null,
	options: TransactionOptions | undefined,
	attempt: number,
): TransactionRuntime => ({
	abortError: undefined,
	afterCommit: [],
	afterRollback: [],
	attempt,
	comment: options?.comment,
	context:
		parent?.context || options?.context
			? Object.assign(
					Object.create(null),
					parent?.context,
					options?.context,
				)
			: undefined,
	depth: (parent?.depth ?? 0) + 1,
	name: options?.name,
	options: options ?? {},
	parent: parent ?? undefined,
});

const getSqliteSavepointName = (transaction: TransactionRuntime) =>
	`better_drizzle_sp_${transaction.depth}_${transaction.attempt}`;

type BoundClient<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
> =
	| BetterDrizzleClient<Schema, Meta, Plugins>
	| BetterDrizzleTransactionClient<Schema, Meta, Plugins>;

const runBetterTransaction = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	T,
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	callback: (
		tx: BetterDrizzleTransactionClient<Schema, Meta, Plugins>,
	) => Promise<T> | T,
	options: TransactionOptions = {},
): Promise<T> => {
	const transactionRunner = context.db.transaction;
	if (context.dialect !== 'sqlite' && typeof transactionRunner !== 'function')
		throw new Error(
			'The provided Drizzle client does not support transactions.',
		);

	let attempt = 0;

	while (true) {
		attempt += 1;
		let attemptContext: RuntimeContext<Schema, Meta, Plugins> | null = null;
		let attemptClient: BetterDrizzleTransactionClient<
			Schema,
			Meta,
			Plugins
		> | null = null;
		let attemptState: TransactionRuntime | null = null;

		if (context.dialect === 'sqlite') {
			attemptState = createTransactionState(
				context.transaction,
				options,
				attempt,
			);
			attemptContext = createDerivedRuntimeContext(
				context,
				context.db,
				attemptState,
			);
			attemptClient = createBoundClient(
				attemptContext,
			) as BetterDrizzleTransactionClient<Schema, Meta, Plugins>;

			const cleanupAbort = bindAbortSignals(attemptState);
			const payload = createLifecyclePayload(
				attemptContext,
				attemptClient,
				options,
			);
			const savepointName = attemptState.parent
				? getSqliteSavepointName(attemptState)
				: null;
			const beginSql = savepointName
				? sql.raw(`savepoint ${savepointName}`)
				: sql.raw('begin');
			const commitSql = savepointName
				? sql.raw(`release savepoint ${savepointName}`)
				: sql.raw('commit');
			const rollbackSql = savepointName
				? sql.raw(`rollback to savepoint ${savepointName}`)
				: sql.raw('rollback');

			context.db.run?.(beginSql);

			try {
				if (attemptState.abortError) throw attemptState.abortError;

				await runTransactionHooks(
					attemptContext,
					'beforeTransaction',
					payload,
				);

				const result = await callback(attemptClient);

				if (attemptState.abortError) throw attemptState.abortError;

				context.db.run?.(commitSql);

				await runTransactionHooks(
					attemptContext,
					'afterTransactionCommit',
					payload,
				);

				if (attemptState.parent)
					mergeTransactionQueues(attemptState.parent, attemptState);
				else await runCallbacks(attemptState.afterCommit);

				cleanupAbort();
				return result;
			} catch (error) {
				context.db.run?.(rollbackSql);

				const rollbackReason = isRollbackSignal(error)
					? normalizeRollbackReason(error.reason)
					: error;
				const rollbackPayload = {
					...payload,
					reason: rollbackReason,
				};

				if (!isRollbackSignal(error))
					await runTransactionHooks(
						attemptContext,
						'onTransactionError',
						{
							...rollbackPayload,
							error,
						},
					);

				await runTransactionHooks(
					attemptContext,
					'afterTransactionRollback',
					rollbackPayload,
				);
				await runCallbacks(attemptState.afterRollback);
				cleanupAbort();

				if (isRollbackSignal(error)) throw rollbackReason;
				if (!shouldRetryTransaction(error, options, attempt))
					throw error;

				await delayRetry(options, attempt);
				continue;
			}
		}

		try {
			const envelope = await transactionRunner?.call(
				context.db,
				async (rawTx) => {
					attemptState = createTransactionState(
						context.transaction,
						options,
						attempt,
					);
					attemptContext = createDerivedRuntimeContext(
						context,
						rawTx,
						attemptState,
					);
					attemptClient = createBoundClient(
						attemptContext,
					) as BetterDrizzleTransactionClient<Schema, Meta, Plugins>;

					const cleanupAbort = bindAbortSignals(attemptState);
					const payload = createLifecyclePayload(
						attemptContext,
						attemptClient,
						options,
					);

					try {
						if (attemptState.abortError)
							throw attemptState.abortError;

						await runTransactionHooks(
							attemptContext,
							'beforeTransaction',
							payload,
						);

						const result = await callback(attemptClient);

						if (attemptState.abortError)
							throw attemptState.abortError;

						return result;
					} finally {
						cleanupAbort();
					}
				},
				getDrizzleTransactionConfig(context, options),
			);

			if (!attemptState || !attemptContext || !attemptClient)
				throw new Error('Transaction runtime was not initialized.');
			const state = attemptState as TransactionRuntime;
			const txContext = attemptContext as RuntimeContext<
				Schema,
				Meta,
				Plugins
			>;
			const txClient = attemptClient as BetterDrizzleTransactionClient<
				Schema,
				Meta,
				Plugins
			>;

			const payload = createLifecyclePayload(
				txContext,
				txClient,
				options,
			);

			await runTransactionHooks(
				txContext,
				'afterTransactionCommit',
				payload,
			);

			if (state.parent) mergeTransactionQueues(state.parent, state);
			else await runCallbacks(state.afterCommit);

			return envelope as T;
		} catch (error) {
			if (!attemptState || !attemptContext || !attemptClient) throw error;
			const state = attemptState as TransactionRuntime;
			const txContext = attemptContext as RuntimeContext<
				Schema,
				Meta,
				Plugins
			>;
			const txClient = attemptClient as BetterDrizzleTransactionClient<
				Schema,
				Meta,
				Plugins
			>;

			const rollbackReason = isRollbackSignal(error)
				? normalizeRollbackReason(error.reason)
				: error;
			const payload = {
				...createLifecyclePayload(txContext, txClient, options),
				reason: rollbackReason,
			};

			if (!isRollbackSignal(error))
				await runTransactionHooks(txContext, 'onTransactionError', {
					...payload,
					error,
				});

			await runTransactionHooks(
				txContext,
				'afterTransactionRollback',
				payload,
			);
			await runCallbacks(state.afterRollback);

			if (isRollbackSignal(error)) throw rollbackReason;
			if (!shouldRetryTransaction(error, options, attempt)) throw error;

			await delayRetry(options, attempt);
		}
	}
};

/**
 * Creates a fully-bound Better Drizzle client from a runtime context.
 * Attaches a typed delegate for every table in the schema, registers the
 * `repository()` and `transaction()` methods, applies client-level plugin
 * extensions, and wires up transaction lifecycle callbacks when inside a
 * transaction.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam Plugins - The plugin tuple.
 * @param context - The runtime context built during client initialization.
 * @returns A client object with all table delegates, repository lookup, and
 *   transaction support.
 */
export const createBoundClient = <
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = [],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
): BoundClient<Schema, Meta, Plugins> => {
	const client = Object.create(null) as Record<string, unknown>;

	for (const [tableName, table] of Object.entries(context.fullSchema)) {
		if (!isTable(table)) continue;

		const delegate = applyModelExtensions(
			context,
			tableName as BetterTableKey<Schema>,
			createModelDelegate(context, tableName as BetterTableKey<Schema>),
		);
		const dbName = context.tables[tableName]?.dbName ?? tableName;

		client[tableName] = delegate;
		context.repositories[tableName] = delegate;
		context.repositories[dbName] = delegate;
	}

	client.repository = (name: string) => {
		const repository = context.repositories[name];

		if (!repository) throw new Error(`Repository "${name}" not found.`);

		return repository;
	};
	client.transaction = <T>(
		callback: (
			tx: BetterDrizzleTransactionClient<Schema, Meta, Plugins>,
		) => Promise<T> | T,
		options?: TransactionOptions,
	) => runBetterTransaction(context, callback, options);

	if (context.transaction) {
		client.afterCommit = (callback: () => unknown | Promise<unknown>) => {
			context.transaction?.afterCommit.push(callback);
		};
		client.afterRollback = (callback: () => unknown | Promise<unknown>) => {
			context.transaction?.afterRollback.push(callback);
		};
		client.rollback = (reason?: unknown) => {
			throw new TransactionRollbackSignal(reason);
		};
	}

	applyClientExtensions(
		context,
		client as BetterDrizzleClient<Schema, Meta, Plugins>,
	);

	context.client = client as BoundClient<Schema, Meta, Plugins>;
	return client as BoundClient<Schema, Meta, Plugins>;
};

/**
 * Creates a Better Drizzle client from a raw Drizzle database instance.
 *
 * This is the main entry point of the library. It builds a runtime context,
 * initializes plugins, and returns a fully-typed client with CRUD delegates
 * for every table, a `repository()` accessor, and transaction support.
 *
 * @typeParam Schema - The Drizzle schema type inferred from the schema object.
 * @typeParam Meta   - Custom metadata type carried through hooks. Defaults to
 *   {@link BetterMeta}.
 * @typeParam Plugins - The plugin tuple provided via `options.plugins`.
 * @param drizzle - The raw Drizzle database instance (`db` from `drizzle()`).
 * @param options - Client configuration including the schema, plugins, hooks,
 *   and transaction settings.
 * @returns A fully-typed {@link BetterDrizzleClient}.
 *
 * @example
 * ```ts
 * import { better } from 'better-drizzle';
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 * import * as schema from './schema';
 *
 * const raw = drizzle('file:local.db');
 * const db = better(raw, { schema });
 *
 * const users = await db.user.findMany();
 * ```
 */
export const better = <
	Schema extends AnySchema,
	Meta = BetterMeta,
	const Plugins extends readonly AnyPlugin[] = [],
>(
	drizzle: unknown,
	options: BetterClientOptions<Schema, Meta, Plugins>,
) => {
	const context = createRuntimeContext(drizzle, options);
	initializePlugins(context);
	return createBoundClient(context) as BetterDrizzleClient<
		Schema,
		Meta,
		Plugins
	>;
};
