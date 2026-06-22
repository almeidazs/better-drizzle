import type {
	AnySchema,
	BetterClientHooks,
	ErrorHookContext,
	NullableResult,
	RuntimeContext,
	TableRuntime,
	ThrowFactory,
	ThrowingResult,
} from '../../types';
import { getMeta } from './context';

const HOOK_ERROR_REPORTED = Symbol('better-drizzle-hook-error-reported');

export const buildHookContext = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	tableName: string,
	action: string,
	args: unknown,
) => ({
	action,
	args,
	db: context.db,
	meta: getMeta<Meta>(args),
	options: context.options,
	repository: context.repositories[tableName],
	schema: context.fullSchema,
	table: tableName,
	tableConfig: runtime.tableConfig,
	tableInstance: runtime.table,
});

const markErrorReported = (error: unknown) => {
	if (typeof error === 'object' && error !== null)
		Reflect.set(error, HOOK_ERROR_REPORTED, true);
};

const wasErrorReported = (error: unknown) =>
	typeof error === 'object' &&
	error !== null &&
	Boolean(Reflect.get(error, HOOK_ERROR_REPORTED));

export const reportError = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	tableName: string,
	action: string,
	args: unknown,
	error: unknown,
	stage: ErrorHookContext<Schema, Meta>['stage'],
	hookName?: keyof BetterClientHooks<Schema, Meta>,
) => {
	if (!context.hasOnError) return;

	try {
		await context.options.hooks?.onError?.({
			...buildHookContext(context, runtime, tableName, action, args),
			action: action as ErrorHookContext<Schema, Meta>['action'],
			error,
			hookName,
			stage,
		} as unknown as ErrorHookContext<Schema, Meta>);
	} catch {}
};

const runHook = async <Schema extends AnySchema, Meta, Payload>(
	hook: ((payload: Payload) => unknown) | undefined,
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	tableName: string,
	action: string,
	args: unknown,
	hookName: keyof BetterClientHooks<Schema, Meta>,
	payload: Payload,
) => {
	if (!hook) return;

	try {
		await hook(payload);
	} catch (error) {
		await reportError(
			context,
			runtime,
			tableName,
			action,
			args,
			error,
			hookName.startsWith('after') ? 'afterHook' : 'beforeHook',
			hookName,
		);
		markErrorReported(error);
		throw error;
	}
};

export const executeOperation = async <
	Schema extends AnySchema,
	Meta,
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
	operation,
	runtime,
	tableName,
}: {
	action: string;
	args: Args;
	afterHookName?: keyof BetterClientHooks<Schema, Meta>;
	afterPayload?: (result: Result) => unknown;
	beforeHookName?: keyof BetterClientHooks<Schema, Meta>;
	beforePayload?: () => unknown;
	context: RuntimeContext<Schema, Meta>;
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

		if (afterHookName && afterHook && afterPayload)
			await runHook(
				afterHook as (payload: unknown) => unknown,
				context,
				runtime,
				tableName,
				action,
				args,
				afterHookName,
				afterPayload(result),
			);

		return result;
	} catch (error) {
		if (!wasErrorReported(error))
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
	}
};

export const attachThrow = <Schema extends AnySchema, Meta, Args, T>(
	promise: NullableResult<T>,
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	action: string,
	args: Args,
	methodName: string,
	tableName: string,
): ThrowingResult<T> => {
	const wrapped = promise as ThrowingResult<T>;

	wrapped.throw = async (factory?: ThrowFactory) => {
		const result = await promise;

		if (result !== null) return result as Exclude<T, null | undefined>;

		const error =
			factory?.() ??
			new Error(`No record found for ${methodName} on "${tableName}".`);

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

	return wrapped;
};
