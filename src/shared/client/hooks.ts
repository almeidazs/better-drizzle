import type {
	AnyPlugin,
	AnySchema,
	BetterClientHooks,
	ErrorHookContext,
	ExplainableResult,
	ExplainOptions,
	ExplainResult,
	RuntimeContext,
	TableRuntime,
	ThrowFactory,
	ThrowingWriteResult,
} from '../../types';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';
import { getMeta } from './context';
import type { InterceptState } from './plugins';

const HOOK_ERROR_REPORTED = Symbol('better-drizzle-hook-error-reported');

/** Compiles a read; `source` identifies the read, `args` are its arguments. */
type Preparer = (source: unknown, args: unknown, name?: string) => unknown;

/**
 * Builds the context object passed to client hooks (beforeCreate, afterQuery, etc.).
 * Includes the database handle, schema, table metadata, operation args, and meta.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @param context   - The runtime context.
 * @param runtime   - The table runtime metadata.
 * @param tableName - The TypeScript table key.
 * @param action    - The hook action name (e.g. `"create"`, `"findMany"`).
 * @param args      - The original operation arguments.
 * @returns A hook context object.
 */
export const buildHookContext = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	runtime: TableRuntime,
	tableName: string,
	action: string,
	args: unknown,
) => {
	const registerAfterCommit = (
		callback: () => unknown | Promise<unknown>,
	) => {
		const { transaction } = context;

		if (!transaction)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.AfterCommitOutsideTransaction,
				message: 'afterCommit() can only be used inside a transaction.',
			});

		transaction.afterCommit.push(callback);
	};

	const registerAfterRollback = (
		callback: () => unknown | Promise<unknown>,
	) => {
		const { transaction } = context;

		if (!transaction)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.AfterRollbackOutsideTransaction,
				message:
					'afterRollback() can only be used inside a transaction.',
			});

		transaction.afterRollback.push(callback);
	};

	return {
		action,
		afterCommit: registerAfterCommit,
		afterRollback: registerAfterRollback,
		args,
		db: context.db,
		isInTransaction: Boolean(context.transaction),
		meta: getMeta(context, args),
		options: context.options,
		repository: context.repositories[tableName],
		schema: context.fullSchema,
		table: tableName,
		tableConfig: runtime.tableConfig,
		tableInstance: runtime.table,
		transaction: context.transaction
			? (context.client as RuntimeContext<
					Schema,
					Meta,
					Plugins
				>['client'])
			: null,
		transactionContext: context.transaction?.context,
	};
};

const markErrorReported = (error: unknown) => {
	if (typeof error === 'object' && error !== null)
		Reflect.set(error, HOOK_ERROR_REPORTED, true);
};

const wasErrorReported = (error: unknown) =>
	typeof error === 'object' &&
	error !== null &&
	Boolean(Reflect.get(error, HOOK_ERROR_REPORTED));

/**
 * Reports an error to the `onError` client hook, if one is registered.
 * The error is marked as reported to prevent duplicate reporting when
 * the same error propagates through multiple layers.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @param context   - The runtime context.
 * @param runtime   - The table runtime metadata.
 * @param tableName - The TypeScript table key.
 * @param action    - The hook action name.
 * @param args      - The original operation arguments.
 * @param error     - The error that was thrown.
 * @param stage     - The lifecycle stage where the error occurred.
 * @param hookName  - The specific hook that threw (if applicable).
 */
export const reportError = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	runtime: TableRuntime,
	tableName: string,
	action: string,
	args: unknown,
	error: unknown,
	stage: ErrorHookContext<Schema, Meta, Plugins>['stage'],
	hookName?: keyof BetterClientHooks<Schema, Meta, Plugins>,
) => {
	if (!context.hasOnError) return;

	try {
		await context.options.hooks?.onError?.({
			...buildHookContext(context, runtime, tableName, action, args),
			action: action as ErrorHookContext<Schema, Meta, Plugins>['action'],
			error,
			hookName,
			stage,
		} as unknown as ErrorHookContext<Schema, Meta, Plugins>);
	} catch {}
};

const runHook = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Payload,
>(
	hook: ((payload: Payload) => unknown) | undefined,
	context: RuntimeContext<Schema, Meta, Plugins>,
	runtime: TableRuntime,
	tableName: string,
	action: string,
	args: unknown,
	hookName: keyof BetterClientHooks<Schema, Meta, Plugins>,
	payload: Payload,
) => {
	if (!hook) return;

	try {
		await hook(payload);
	} catch (error) {
		const normalized = BetterDrizzleError.from(error, {
			code: BetterDrizzleErrorCode.HookError,
			hookName: String(hookName),
			operation: action,
			stage: hookName.startsWith('after') ? 'afterHook' : 'beforeHook',
			table: tableName,
		});

		await reportError(
			context,
			runtime,
			tableName,
			action,
			args,
			normalized,
			normalized.stage as ErrorHookContext<
				Schema,
				Meta,
				Plugins
			>['stage'],
			hookName,
		);
		markErrorReported(normalized);
		throw normalized;
	}
};

/**
 * Executes an operation with optional before/after client hooks and error
 * reporting. When no hooks or error handler are registered this falls
 * through to a direct `operation()` call for zero overhead.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @typeParam Args    - The operation arguments type.
 * @typeParam Result  - The operation result type.
 */
export const executeOperation = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Args,
	Result,
>({
	action,
	args,
	afterHookName,
	afterPayload,
	beforeHookName,
	beforePayload,
	context,
	interception,
	operation,
	runtime,
	tableName,
}: {
	action: string;
	args: Args;
	afterHookName?: keyof BetterClientHooks<Schema, Meta, Plugins>;
	afterPayload?: (result: Result) => unknown;
	beforeHookName?: keyof BetterClientHooks<Schema, Meta, Plugins>;
	beforePayload?: () => unknown;
	context: RuntimeContext<Schema, Meta, Plugins>;
	interception?: InterceptState;
	operation: () => Promise<Result>;
	runtime: TableRuntime;
	tableName: string;
}) => {
	const hooks = context.options.hooks;
	const beforeHook = beforeHookName ? hooks?.[beforeHookName] : undefined;
	const afterHook = afterHookName ? hooks?.[afterHookName] : undefined;

	if (!beforeHook && !afterHook && !context.hasOnError) return operation();

	try {
		if (beforeHookName && beforeHook && beforePayload)
			await runHook(
				beforeHook as (payload: unknown) => unknown,
				context,
				runtime,
				tableName,
				action,
				args,
				beforeHookName,
				beforePayload(),
			);

		const result = await operation();

		if (
			afterHookName &&
			afterHook &&
			afterPayload &&
			!interception?.skipAfterHooks
		)
			await runHook(
				afterHook as (payload: unknown) => unknown,
				context,
				runtime,
				tableName,
				action,
				args,
				afterHookName,
				interception?.annotations
					? {
							...(afterPayload(result) as object),
							annotations: interception.annotations,
						}
					: afterPayload(result),
			);

		return result;
	} catch (error) {
		const normalized = BetterDrizzleError.from(error, {
			code: BetterDrizzleError.is(error)
				? error.code
				: BetterDrizzleErrorCode.OperationError,
			operation: action,
			table: tableName,
		});

		if (!wasErrorReported(error))
			await reportError(
				context,
				runtime,
				tableName,
				action,
				args,
				normalized,
				'operation',
			);

		throw normalized;
	}
};

/**
 * Wraps a nullable promise result with a `.throw()` helper. When the
 * result is `null`, calling `.throw()` invokes the `onError` hook and
 * throws an error (either from the provided factory or a default message).
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @typeParam Args    - The operation arguments type.
 * @typeParam T       - The non-null result type.
 * @param promise   - The promise that resolves to `T | null`.
 * @param context   - The runtime context.
 * @param runtime   - The table runtime metadata.
 * @param action    - The hook action name.
 * @param args      - The original operation arguments.
 * @param methodName - The delegate method name (e.g. `"findFirst"`).
 * @param tableName - The TypeScript table key.
 * @returns The same promise typed as `ThrowingWriteResult<T>`, with a `.throw()` method.
 */
export const attachThrow = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Args,
	T,
>(
	promise: PromiseLike<T | null>,
	context: RuntimeContext<Schema, Meta, Plugins>,
	runtime: TableRuntime,
	action: string,
	args: Args,
	methodName: string,
	tableName: string,
): ThrowingWriteResult<T> => {
	const wrapped = promise as ThrowingWriteResult<T>;

	wrapped.throw = async (factory?: ThrowFactory) =>
		throwIfMissing(
			await promise,
			factory,
			context,
			runtime,
			action,
			args,
			methodName,
			tableName,
		) as Exclude<T, null | undefined>;

	return wrapped;
};

/**
 * Returns `result`, or reports and throws `RESULT_NOT_FOUND` (or the
 * factory's error) when it is `null`.
 */
export const throwIfMissing = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	result: unknown,
	factory: ThrowFactory | undefined,
	context: RuntimeContext<Schema, Meta, Plugins>,
	runtime: TableRuntime,
	action: string,
	args: unknown,
	methodName: string,
	tableName: string,
) => {
	if (result !== null) return result;

	const fallbackMessage = `No record found for ${methodName} on "${tableName}".`;
	const produced = factory?.();
	const error =
		produced === undefined
			? new BetterDrizzleError({
					code: BetterDrizzleErrorCode.ResultNotFound,
					message: fallbackMessage,
					operation: methodName,
					status: 404,
					table: tableName,
				})
			: BetterDrizzleError.from(produced, {
					code: BetterDrizzleErrorCode.ResultNotFound,
					operation: methodName,
					status: 404,
					table: tableName,
				});

	await reportError(
		context,
		runtime,
		tableName,
		action,
		args,
		error,
		'operation',
	);
	throw error;
};

/**
 * Lazy read result, modeled on Drizzle's own `QueryPromise`: the operation
 * starts on the first `then` / `catch` / `finally` (i.e. when awaited), never
 * on creation, so `.explain()` alone does not execute the read or its hooks.
 * `Promise.prototype` is in the prototype chain, so `instanceof Promise`
 * holds; it is not a native promise, because a pending native promise that
 * starts lazily would hang consumers that read promise state directly.
 */
class ExplainableQuery<T> {
	#operation: () => Promise<T>;
	#promise: Promise<T> | undefined;
	#prepare: Preparer | undefined;
	#source: unknown;
	#args: unknown;
	explain: (options?: ExplainOptions) => Promise<ExplainResult>;

	constructor(
		operation: () => Promise<T>,
		explain: (options?: ExplainOptions) => Promise<ExplainResult>,
		prepare?: Preparer,
		source?: unknown,
		args?: unknown,
	) {
		this.#operation = operation;
		this.explain = explain;
		this.#prepare = prepare;
		this.#source = source;
		this.#args = args;
	}

	prepare(name?: string) {
		return (this.#prepare as Preparer)(this.#source, this.#args, name);
	}

	#run() {
		if (!this.#promise)
			this.#promise = Promise.resolve().then(this.#operation);
		return this.#promise;
	}

	then<Resolved = T, Rejected = never>(
		onFulfilled?: ((value: T) => Resolved | PromiseLike<Resolved>) | null,
		onRejected?:
			| ((reason: unknown) => Rejected | PromiseLike<Rejected>)
			| null,
	) {
		return this.#run().then(onFulfilled, onRejected);
	}

	catch<Rejected = never>(
		onRejected?:
			| ((reason: unknown) => Rejected | PromiseLike<Rejected>)
			| null,
	) {
		return this.#run().catch(onRejected);
	}

	finally(onFinally?: (() => void) | null) {
		return this.#run().finally(onFinally);
	}

	get [Symbol.toStringTag]() {
		return 'Promise';
	}
}

Object.setPrototypeOf(ExplainableQuery.prototype, Promise.prototype);

/**
 * Wraps a read operation in a lazy thenable with an independent `.explain()`
 * method. The read runs only when the result is awaited.
 */
export const attachExplain = <T>(
	operation: () => Promise<T>,
	explain: (options?: ExplainOptions) => Promise<ExplainResult>,
	prepare?: Preparer,
	source?: unknown,
	args?: unknown,
) =>
	new ExplainableQuery(
		operation,
		explain,
		prepare,
		source,
		args,
	) as unknown as ExplainableResult<T>;
