import type {
	AnySchema,
	BetterClientHooks,
	ErrorHookContext,
	NullableResult,
	RuntimeContext,
	ThrowFactory,
	ThrowingResult,
} from '../../types';
import { getMeta, getTableRuntime } from './context';

const HOOK_ERROR_REPORTED = Symbol('better-drizzle-hook-error-reported');

export const buildHookContext = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: keyof Schema & string,
	action: string,
	args: unknown,
) => {
	const runtime = getTableRuntime(context, tableName);

	return {
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
	};
};

export const reportError = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: keyof Schema & string,
	action: string,
	args: unknown,
	error: unknown,
	stage: ErrorHookContext<Schema, Meta>['stage'],
	hookName?: keyof BetterClientHooks<Schema, Meta>,
) => {
	try {
		await context.options.hooks?.onError?.({
			...buildHookContext(context, tableName, action, args),
			action: action as ErrorHookContext<Schema, Meta>['action'],
			error,
			hookName,
			stage,
		} as unknown as ErrorHookContext<Schema, Meta>);
	} catch {}
};

export const runHook = async <Schema extends AnySchema, Meta, Payload>(
	context: RuntimeContext<Schema, Meta>,
	tableName: keyof Schema & string,
	action: string,
	args: unknown,
	hookName: keyof BetterClientHooks<Schema, Meta>,
	payload: Payload,
) => {
	const hook = context.options.hooks?.[hookName] as
		| ((payload: Payload) => unknown)
		| undefined;

	if (!hook) return;

	try {
		await hook(payload);
	} catch (error) {
		await reportError(
			context,
			tableName,
			action,
			args,
			error,
			hookName.startsWith('after') ? 'afterHook' : 'beforeHook',
			hookName,
		);

		if (typeof error === 'object' && error !== null)
			Reflect.set(error, HOOK_ERROR_REPORTED, true);

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
	tableName,
}: {
	action: string;
	args: Args;
	afterHookName?: keyof BetterClientHooks<Schema, Meta>;
	afterPayload?: (result: Result) => unknown;
	beforeHookName?: keyof BetterClientHooks<Schema, Meta>;
	beforePayload?: unknown;
	context: RuntimeContext<Schema, Meta>;
	operation: () => Promise<Result>;
	tableName: keyof Schema & string;
}) => {
	try {
		if (beforeHookName && beforePayload)
			await runHook(
				context,
				tableName,
				action,
				args,
				beforeHookName,
				beforePayload,
			);

		const result = await operation();

		if (afterHookName && afterPayload)
			await runHook(
				context,
				tableName,
				action,
				args,
				afterHookName,
				afterPayload(result),
			);

		return result;
	} catch (error) {
		const wasErrorReported =
			typeof error === 'object' &&
			error !== null &&
			Boolean(Reflect.get(error, HOOK_ERROR_REPORTED));

		if (!wasErrorReported)
			await reportError(
				context,
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
	action: string,
	args: Args,
	methodName: string,
	tableName: keyof Schema & string,
): ThrowingResult<T> => {
	const wrapped = promise as ThrowingResult<T>;

	wrapped.throw = async (factory?: ThrowFactory) => {
		const result = await promise;

		if (result !== null) return result as Exclude<T, null | undefined>;

		const error =
			factory?.() ??
			new Error(
				`No record found for ${methodName} on "${String(tableName)}".`,
			);

		await reportError(context, tableName, action, args, error, 'operation');

		throw error;
	};

	return wrapped;
};
