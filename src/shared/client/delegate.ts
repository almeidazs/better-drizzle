import type {
	AfterCreateHookContext,
	AfterDeleteHookContext,
	AfterUpdateHookContext,
	AnyPlugin,
	AnySchema,
	BeforeCreateHookContext,
	BeforeDeleteHookContext,
	BeforeUpdateHookContext,
	BetterDrizzleModelDelegate,
	BetterTableKey,
	CompilableWhere,
	CountArgs,
	CreateArgs,
	CreateManyArgs,
	CursorArgs,
	DeleteArgs,
	DeleteManyArgs,
	ExistsArgs,
	ExplainOperation,
	OperationArgsWithPlugins,
	PaginationArgs,
	QueryArgs,
	RuntimeContext,
	UpdateArgs,
	UpdateEachArgs,
	UpdateManyArgs,
	UpsertArgs,
	UpsertManyArgs,
} from '../../types';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';
import { compileWhereInput, countRows } from '../query';
import { getTableRuntime } from './context';
import { explainOperation } from './explain';
import {
	attachExplain,
	attachThrow,
	buildHookContext,
	executeOperation,
	throwIfMissing,
} from './hooks';
import {
	createManyRecords,
	createRecord,
	cursorRecords,
	deleteManyRecords,
	deleteRecord,
	existsRecord,
	findFirstRecord,
	findManyRecords,
	paginateRecords,
	updateEachRecords,
	updateManyRecords,
	updateRecord,
	upsertManyRecords,
	upsertRecord,
	getCompiledUpdateSet,
} from './operations';
import {
	type InterceptState,
	createPluginState,
	hasPluginWork,
	mergePluginState,
	runPluginAfterHooks,
	runPluginIntercepts,
	runPluginPipeline,
	shouldRunPlugins,
	skipPluginsState,
} from './plugins';
import { type PreparedReadKind, fillParams, prepareRead } from './prepared';
import { hasRelationWrites } from './relations';

const EMPTY_VALUES = Object.freeze({}) as Record<string, unknown>;

/**
 * Creates a model delegate for a single table. The delegate exposes all
 * CRUD methods (`findMany`, `findFirst`, `create`, `update`, `delete`,
 * etc.) as well as plugin state management helpers (`$withState`,
 * `$withoutPlugins`). Each method wires up the appropriate before/after
 * client hooks, plugin pipeline, and error reporting.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type carried through hooks.
 * @typeParam Plugins - The plugin tuple.
 * @param context   - The runtime context.
 * @param tableName - The table to create a delegate for.
 * @param state     - Initial plugin state (defaults to an empty state).
 * @returns A fully-typed model delegate.
 */
export const createModelDelegate = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	tableName: BetterTableKey<Schema>,
	state = createPluginState(),
): BetterDrizzleModelDelegate<
	Schema,
	BetterTableKey<Schema>,
	Meta,
	Plugins
> => {
	const name = tableName as string;
	const runtime = getTableRuntime(context, name);
	const hookContext = (action: string, args: unknown) =>
		buildHookContext(context, runtime, name, action, args);
	const baseModel = {
		dbName: runtime.dbName,
		hasColumn(column: string) {
			return runtime.hasColumn(column);
		},
		name: tableName,
	};
	const shouldApplyPlugins = shouldRunPlugins(context.hasPlugins, state);
	const relationalWrite = <Args, Result>(
		method: 'create' | 'update' | 'upsert',
		args: Args,
		data: readonly unknown[],
		run: () => Promise<Result>,
	) => {
		if (
			context.transaction ||
			!data.some((value) => hasRelationWrites(runtime, value))
		)
			return run();
		const client = context.client as Record<string, unknown>;
		const transaction = client.transaction as (
			callback: (tx: Record<string, unknown>) => Promise<Result>,
		) => Promise<Result>;
		return transaction(async (tx) => {
			const repository = tx[name] as Record<string, unknown>;
			const scopedRepository = (
				repository.$withState as (
					value: Record<string, unknown>,
				) => Record<string, unknown>
			)(state);
			return (
				scopedRepository[method] as (value: Args) => Promise<Result>
			)(args);
		});
	};
	const delegate = {
		$model: baseModel,
		$state: state,
		$withState(nextState: Record<string, unknown>) {
			return createModelDelegate(
				context,
				tableName,
				mergePluginState(state, nextState),
			);
		},
		$withoutPlugins() {
			return createModelDelegate(
				context,
				tableName,
				mergePluginState(state, skipPluginsState()),
			);
		},
		$where(where?: CompilableWhere) {
			return compileWhereInput(
				{ ...context, runtime, tableName: name },
				where,
			);
		},
	} as BetterDrizzleModelDelegate<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		Plugins
	>;

	const assertTransactionNotAborted = () => {
		const abortError = context.transaction?.abortError;

		if (abortError)
			throw BetterDrizzleError.from(abortError, {
				code: BetterDrizzleErrorCode.TransactionAborted,
			});
	};

	type Spec<Args, Result> = {
		action: string;
		afterHookName?:
			| 'afterCreate'
			| 'afterDelete'
			| 'afterQuery'
			| 'afterUpdate';
		afterPayload?: (result: Result, operationArgs: Args) => unknown;
		beforeHookName?:
			| 'beforeCreate'
			| 'beforeDelete'
			| 'beforeQuery'
			| 'beforeUpdate';
		beforePayload?: (operationArgs: Args) => unknown;
		compiled?: (
			operationArgs: Args,
		) => Readonly<Record<string, unknown>> | undefined;
		kind:
			| 'count'
			| 'create'
			| 'createMany'
			| 'delete'
			| 'deleteMany'
			| 'exists'
			| 'findFirst'
			| 'findMany'
			| 'findOne'
			| 'findUnique'
			| 'cursor'
			| 'paginate'
			| 'update'
			| 'updateEach'
			| 'updateMany'
			| 'upsert'
			| 'upsertMany';
		operation: (operationArgs: Args) => Promise<Result>;
	};

	/**
	 * Runs an operation whose args already went through the plugin pipeline:
	 * client hooks, intercepts, then plugin after hooks.
	 */
	const runResolved = <Args, Result>(
		spec: Spec<Args, Result>,
		operationArgs: Args,
		execute: () => Promise<Result>,
		beforeHook: boolean,
		params?: Record<string, unknown>,
	): Promise<Result> =>
		(async () => {
			const { afterPayload, beforePayload, kind } = spec;
			const interception: InterceptState | undefined = context.plugins
				.byKind[kind].hasIntercepts
				? { annotations: undefined, skipAfterHooks: false }
				: undefined;
			const result = await executeOperation({
				action: spec.action,
				args: operationArgs,
				afterHookName: spec.afterHookName,
				afterPayload: afterPayload
					? (value: Result) => afterPayload(value, operationArgs)
					: undefined,
				beforeHookName: beforeHook ? spec.beforeHookName : undefined,
				beforePayload: beforePayload
					? () => beforePayload(operationArgs)
					: undefined,
				context,
				interception,
				operation: interception
					? () =>
							runPluginIntercepts(
								context,
								runtime,
								tableName,
								kind,
								operationArgs as never,
								state,
								delegate,
								execute,
								interception,
								params,
							)
					: execute,
				runtime,
				tableName: name,
			});

			if (!interception?.skipAfterHooks)
				await runPluginAfterHooks(
					context,
					runtime,
					tableName,
					kind,
					operationArgs as never,
					state,
					delegate,
					result,
					spec.compiled?.(operationArgs),
					interception?.annotations,
				);

			assertTransactionNotAborted();

			return result;
		})();

	const runOperation = <Args, Result>(
		spec: Spec<Args, Result>,
		args: Args,
	): Promise<Result> => {
		assertTransactionNotAborted();

		if (!shouldApplyPlugins || !hasPluginWork(context, spec.kind)) {
			const { afterPayload, beforePayload } = spec;
			return executeOperation({
				action: spec.action,
				args,
				afterHookName: spec.afterHookName,
				afterPayload: afterPayload
					? (result: Result) => afterPayload(result, args)
					: undefined,
				beforeHookName: spec.beforeHookName,
				beforePayload: beforePayload
					? () => beforePayload(args)
					: undefined,
				context,
				operation: () => spec.operation(args),
				runtime,
				tableName: name,
			});
		}

		return (async () => {
			assertTransactionNotAborted();

			const pipeline = await runPluginPipeline(
				context,
				runtime,
				tableName,
				spec.kind,
				args as never,
				state,
				delegate,
			);
			const operationArgs = pipeline.args as Args;

			return runResolved(
				spec,
				operationArgs,
				pipeline.hasOverride
					? () => Promise.resolve(pipeline.overrideResult as Result)
					: () => spec.operation(operationArgs),
				true,
			);
		})();
	};

	const resolveExplainArgs = async <Args>(
		kind: ExplainOperation,
		args: Args,
	) => {
		assertTransactionNotAborted();
		if (!shouldApplyPlugins || !hasPluginWork(context, kind)) return args;

		const pipeline = await runPluginPipeline(
			context,
			runtime,
			tableName,
			kind,
			args as never,
			state,
			delegate,
		);

		return pipeline.args as Args;
	};

	type ReadSpec = Spec<Record<string, unknown>, unknown> & {
		kind: PreparedReadKind;
	};

	const readSpec = (
		kind: PreparedReadKind,
		operation: (operationArgs: Record<string, unknown>) => Promise<unknown>,
		field?: 'row' | 'rows',
	): ReadSpec => ({
		action: kind,
		afterHookName: 'afterQuery',
		afterPayload: field
			? (result, resolvedArgs) => ({
					...hookContext(kind, resolvedArgs),
					result,
					[field]: result,
				})
			: (result, resolvedArgs) => ({
					...hookContext(kind, resolvedArgs),
					result,
				}),
		beforeHookName: 'beforeQuery',
		beforePayload: (resolvedArgs) => hookContext(kind, resolvedArgs),
		kind,
		operation,
	});

	const readOperation = (
		kind: PreparedReadKind,
	): ((resolvedArgs: Record<string, unknown>) => Promise<unknown>) => {
		if (kind === 'count')
			return (resolvedArgs) =>
				countRows(
					context,
					tableName,
					resolvedArgs.where as never,
					resolvedArgs.cursor as never,
				);
		if (kind === 'cursor')
			return (resolvedArgs) =>
				cursorRecords(context, tableName, resolvedArgs as never);
		if (kind === 'exists')
			return (resolvedArgs) =>
				existsRecord(context, tableName, resolvedArgs);
		if (kind === 'findMany')
			return (resolvedArgs) =>
				findManyRecords(context, tableName, resolvedArgs);
		if (kind === 'paginate')
			return (resolvedArgs) =>
				paginateRecords(context, tableName, resolvedArgs as never);
		return (resolvedArgs) =>
			findFirstRecord(context, tableName, resolvedArgs);
	};

	// Built on first use: every bound client (including each transaction)
	// creates delegates for all tables, and most never run every read kind.
	const reads = Object.create(null) as Partial<
		Record<PreparedReadKind, ReadSpec>
	>;
	const read = (kind: PreparedReadKind) =>
		reads[kind] ??
		(reads[kind] = readSpec(
			kind,
			readOperation(kind),
			kind === 'findMany'
				? 'rows'
				: kind === 'findFirst' ||
					  kind === 'findOne' ||
					  kind === 'findUnique'
					? 'row'
					: undefined,
		));

	type Plan = {
		args: Record<string, unknown>;
		check: (values: Record<string, unknown>) => void;
		run: (values: Record<string, unknown>) => Promise<unknown>;
	};

	/**
	 * Compiles a read into a prepared statement. The plugin pipeline and the
	 * client before hook run once here; when either is async, the statement
	 * waits for them on its first execution.
	 */
	const prepare = (
		source: unknown,
		args: unknown,
		statementName?: string,
	) => {
		const spec = source as ReadSpec;
		const { kind } = spec;
		const plugins = shouldApplyPlugins && hasPluginWork(context, kind);
		const hooks = context.options.hooks;
		const bare = !plugins && !hooks?.afterQuery && !context.hasOnError;
		const single =
			kind === 'findFirst' || kind === 'findOne' || kind === 'findUnique';
		const build = (
			operationArgs: Record<string, unknown>,
			override?: { value: unknown },
		): Plan => {
			const plan = prepareRead(
				context,
				tableName,
				kind,
				operationArgs,
				statementName,
			);
			return {
				args: operationArgs,
				check: plan.check,
				run: override
					? async (values) => {
							plan.check(values);
							return override.value;
						}
					: plan.run,
			};
		};

		assertTransactionNotAborted();

		let plan: Plan | undefined;
		const pending =
			!plugins && !hooks?.beforeQuery
				? undefined
				: (async () => {
						const pipeline = plugins
							? await runPluginPipeline(
									context,
									runtime,
									tableName,
									kind,
									args as never,
									state,
									delegate,
								)
							: undefined;
						const operationArgs = (pipeline?.args ??
							args) as Record<string, unknown>;
						if (hooks?.beforeQuery)
							await executeOperation({
								action: kind,
								args: operationArgs,
								beforeHookName: 'beforeQuery',
								beforePayload: () =>
									spec.beforePayload?.(operationArgs),
								context,
								operation: () => Promise.resolve(undefined),
								runtime,
								tableName: name,
							});
						plan = build(
							operationArgs,
							pipeline?.hasOverride
								? { value: pipeline.overrideResult }
								: undefined,
						);
						return plan;
					})();
		if (pending) pending.catch(() => undefined);
		else plan = build(args as Record<string, unknown>);

		const run = (
			current: Plan,
			values: Record<string, unknown> | undefined,
			options: { meta?: unknown } | undefined,
		) => {
			try {
				assertTransactionNotAborted();
			} catch (error) {
				return Promise.reject(error);
			}
			const input = values ?? EMPTY_VALUES;
			if (bare) return current.run(input);
			const operationArgs =
				options?.meta === undefined
					? current.args
					: {
							...current.args,
							meta: {
								...(current.args.meta as object | undefined),
								...(options.meta as object),
							},
						};
			const execute = () => current.run(input);
			if (!plugins)
				return executeOperation({
					action: kind,
					args: operationArgs,
					afterHookName: 'afterQuery',
					afterPayload: (result: unknown) =>
						spec.afterPayload?.(result, operationArgs),
					context,
					operation: execute,
					runtime,
					tableName: name,
				});
			return runResolved(spec, operationArgs, execute, false, input);
		};

		// Shared by every execution: `this` is the promise `execute()` returned.
		function throwMissing(this: Promise<unknown>, factory?: () => unknown) {
			return this.then((result) =>
				throwIfMissing(
					result,
					factory,
					context,
					runtime,
					kind,
					args,
					kind,
					name,
				),
			);
		}

		const execute = (
			values?: Record<string, unknown>,
			options?: { meta?: unknown },
		) => {
			const result = plan
				? run(plan, values, options)
				: (pending as Promise<Plan>).then((current) =>
						run(current, values, options),
					);
			if (single) (result as { throw?: unknown }).throw = throwMissing;
			return result;
		};

		return {
			execute,
			async explain(
				values?: Record<string, unknown>,
				options?: Parameters<typeof explainOperation>[4],
			) {
				const current = plan ?? (await (pending as Promise<Plan>));
				current.check(values ?? EMPTY_VALUES);
				return explainOperation(
					context,
					tableName,
					kind,
					fillParams(current.args, values ?? EMPTY_VALUES),
					options,
				);
			},
			name: statementName,
		};
	};

	const withExplain = <Args, Result>(
		operationThunk: () => Promise<Result>,
		operation: ExplainOperation,
		args: Args,
	) =>
		attachExplain(
			operationThunk,
			async (options) =>
				explainOperation(
					context,
					tableName,
					operation,
					await resolveExplainArgs(operation, args),
					options,
				),
			prepare,
			read(operation),
			args,
		);

	return Object.assign(delegate, {
		count: (
			args?: OperationArgsWithPlugins<
				CountArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'count'
			>,
		) => {
			const operationArgs = args ?? ({} as Record<string, unknown>);

			return withExplain(
				() => runOperation(read('count'), operationArgs),
				'count',
				operationArgs,
			);
		},
		exists: (
			args?: OperationArgsWithPlugins<
				ExistsArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'exists'
			>,
		) => {
			const operationArgs = args ?? ({} as Record<string, unknown>);

			return withExplain(
				() => runOperation(read('exists'), operationArgs),
				'exists',
				operationArgs,
			);
		},
		createMany: (
			args: OperationArgsWithPlugins<
				CreateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'createMany'
			>,
		) =>
			runOperation(
				{
					action: 'createMany',
					afterHookName: 'afterCreate',
					afterPayload: (result, resolvedArgs) =>
						({
							...hookContext('createMany', resolvedArgs),
							result,
						}) as AfterCreateHookContext<Schema, Meta, Plugins>,
					beforeHookName: 'beforeCreate',
					beforePayload: (resolvedArgs) =>
						hookContext(
							'createMany',
							resolvedArgs,
						) as BeforeCreateHookContext<Schema, Meta, Plugins>,
					kind: 'createMany',
					operation: (resolvedArgs) =>
						createManyRecords(context, tableName, resolvedArgs),
				},
				args,
			),
		findMany: (
			args?: OperationArgsWithPlugins<
				QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'findMany'
			>,
		) => {
			const operationArgs = args ?? ({} as Record<string, unknown>);

			return withExplain(
				() => runOperation(read('findMany'), operationArgs),
				'findMany',
				operationArgs,
			);
		},
		findFirst: (
			args?: OperationArgsWithPlugins<
				QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'findFirst'
			>,
		) => {
			const operationArgs = args ?? ({} as Record<string, unknown>);

			return attachThrow(
				withExplain(
					() => runOperation(read('findFirst'), operationArgs),
					'findFirst',
					operationArgs,
				) as Promise<Record<string, unknown> | null>,
				context,
				runtime,
				'findFirst',
				operationArgs,
				'findFirst',
				name,
			);
		},
		findOne: (
			args?: OperationArgsWithPlugins<
				QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'findOne'
			>,
		) => {
			const operationArgs = args ?? ({} as Record<string, unknown>);

			return attachThrow(
				withExplain(
					() => runOperation(read('findOne'), operationArgs),
					'findOne',
					operationArgs,
				) as Promise<Record<string, unknown> | null>,
				context,
				runtime,
				'findOne',
				operationArgs,
				'findOne',
				name,
			);
		},
		findUnique: (
			args: OperationArgsWithPlugins<
				QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'findUnique'
			>,
		) =>
			attachThrow(
				withExplain(
					() =>
						runOperation(
							read('findUnique'),
							args as Record<string, unknown>,
						),
					'findUnique',
					args,
				) as Promise<Record<string, unknown> | null>,
				context,
				runtime,
				'findUnique',
				args,
				'findUnique',
				name,
			),
		create: (
			args: OperationArgsWithPlugins<
				CreateArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'create'
			>,
		) =>
			relationalWrite('create', args, [args.data], () =>
				runOperation(
					{
						action: 'create',
						afterHookName: 'afterCreate',
						afterPayload: (result, resolvedArgs) =>
							({
								...hookContext('create', resolvedArgs),
								result,
								row: result,
							}) as AfterCreateHookContext<Schema, Meta, Plugins>,
						beforeHookName: 'beforeCreate',
						beforePayload: (resolvedArgs) =>
							hookContext(
								'create',
								resolvedArgs,
							) as BeforeCreateHookContext<Schema, Meta, Plugins>,
						kind: 'create',
						operation: (resolvedArgs) =>
							createRecord(context, tableName, resolvedArgs),
					},
					args,
				),
			),
		paginate: (
			args: OperationArgsWithPlugins<
				PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'paginate'
			>,
		) =>
			withExplain(
				() =>
					runOperation(
						read('paginate'),
						args as Record<string, unknown>,
					),
				'paginate',
				args,
			),
		cursor: (
			args: OperationArgsWithPlugins<
				CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'cursor'
			>,
		) =>
			withExplain(
				() =>
					runOperation(
						read('cursor'),
						args as Record<string, unknown>,
					),
				'cursor',
				args,
			),
		update: (
			args: OperationArgsWithPlugins<
				UpdateArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'update'
			>,
		) =>
			attachThrow(
				relationalWrite('update', args, [args.data], () =>
					runOperation<
						OperationArgsWithPlugins<
							UpdateArgs<Schema, BetterTableKey<Schema>, Meta>,
							Plugins,
							'update'
						>,
						Record<string, unknown> | null
					>(
						{
							action: 'update',
							afterHookName: 'afterUpdate',
							afterPayload: (result, resolvedArgs) =>
								({
									...hookContext('update', resolvedArgs),
									compiled: getCompiledUpdateSet(
										resolvedArgs.data,
									),
									result,
									row: result,
								}) as AfterUpdateHookContext<
									Schema,
									Meta,
									Plugins
								>,
							beforeHookName: 'beforeUpdate',
							beforePayload: (resolvedArgs) =>
								hookContext(
									'update',
									resolvedArgs,
								) as BeforeUpdateHookContext<
									Schema,
									Meta,
									Plugins
								>,
							kind: 'update',
							compiled: (resolvedArgs) =>
								getCompiledUpdateSet(resolvedArgs.data),
							operation: (resolvedArgs) =>
								updateRecord(context, tableName, resolvedArgs),
						},
						args,
					),
				),
				context,
				runtime,
				'update',
				args,
				'update',
				name,
			),
		updateMany: (
			args: OperationArgsWithPlugins<
				UpdateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'updateMany'
			>,
		) =>
			runOperation(
				{
					action: 'updateMany',
					afterHookName: 'afterUpdate',
					afterPayload: (result, resolvedArgs) =>
						({
							...hookContext('updateMany', resolvedArgs),
							compiled: getCompiledUpdateSet(resolvedArgs.data),
							result,
						}) as AfterUpdateHookContext<Schema, Meta, Plugins>,
					beforeHookName: 'beforeUpdate',
					beforePayload: (resolvedArgs) =>
						hookContext(
							'updateMany',
							resolvedArgs,
						) as BeforeUpdateHookContext<Schema, Meta, Plugins>,
					kind: 'updateMany',
					compiled: (resolvedArgs) =>
						getCompiledUpdateSet(resolvedArgs.data),
					operation: (resolvedArgs) =>
						updateManyRecords(context, tableName, resolvedArgs),
				},
				args,
			),
		updateEach: (
			args: OperationArgsWithPlugins<
				UpdateEachArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'updateEach'
			>,
		) =>
			runOperation(
				{
					action: 'updateEach',
					afterHookName: 'afterUpdate',
					afterPayload: (result, resolvedArgs) =>
						({
							...hookContext('updateEach', resolvedArgs),
							compiled: getCompiledUpdateSet(resolvedArgs.update),
							result,
						}) as AfterUpdateHookContext<Schema, Meta, Plugins>,
					beforeHookName: 'beforeUpdate',
					beforePayload: (resolvedArgs) =>
						hookContext(
							'updateEach',
							resolvedArgs,
						) as BeforeUpdateHookContext<Schema, Meta, Plugins>,
					kind: 'updateEach',
					compiled: (resolvedArgs) =>
						getCompiledUpdateSet(resolvedArgs.update),
					operation: (resolvedArgs) =>
						updateEachRecords(context, tableName, resolvedArgs),
				},
				args,
			),
		delete: (
			args: OperationArgsWithPlugins<
				DeleteArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'delete'
			>,
		) =>
			attachThrow(
				runOperation<
					OperationArgsWithPlugins<
						DeleteArgs<Schema, BetterTableKey<Schema>, Meta>,
						Plugins,
						'delete'
					>,
					Record<string, unknown> | null
				>(
					{
						action: 'delete',
						afterHookName: 'afterDelete',
						afterPayload: (result, resolvedArgs) =>
							({
								...hookContext('delete', resolvedArgs),
								result,
								row: result,
							}) as AfterDeleteHookContext<Schema, Meta, Plugins>,
						beforeHookName: 'beforeDelete',
						beforePayload: (resolvedArgs) =>
							hookContext(
								'delete',
								resolvedArgs,
							) as BeforeDeleteHookContext<Schema, Meta, Plugins>,
						kind: 'delete',
						operation: (resolvedArgs) =>
							deleteRecord(context, tableName, resolvedArgs),
					},
					args,
				),
				context,
				runtime,
				'delete',
				args,
				'delete',
				name,
			),
		deleteMany: (
			args: OperationArgsWithPlugins<
				DeleteManyArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'deleteMany'
			>,
		) =>
			runOperation(
				{
					action: 'deleteMany',
					afterHookName: 'afterDelete',
					afterPayload: (result, resolvedArgs) =>
						({
							...hookContext('deleteMany', resolvedArgs),
							result,
						}) as AfterDeleteHookContext<Schema, Meta, Plugins>,
					beforeHookName: 'beforeDelete',
					beforePayload: (resolvedArgs) =>
						hookContext(
							'deleteMany',
							resolvedArgs,
						) as BeforeDeleteHookContext<Schema, Meta, Plugins>,
					kind: 'deleteMany',
					operation: (resolvedArgs) =>
						deleteManyRecords(context, tableName, resolvedArgs),
				},
				args,
			),
		upsert: (
			args: OperationArgsWithPlugins<
				UpsertArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'upsert'
			>,
		) =>
			relationalWrite('upsert', args, [args.create, args.update], () =>
				runOperation(
					{
						action: 'upsert',
						afterHookName: 'afterCreate',
						afterPayload: (result, resolvedArgs) =>
							({
								...hookContext('upsert', resolvedArgs),
								compiled:
									getCompiledUpdateSet(resolvedArgs) ??
									getCompiledUpdateSet(resolvedArgs.update),
								result,
								row: result,
							}) as AfterCreateHookContext<Schema, Meta, Plugins>,
						beforeHookName: 'beforeCreate',
						beforePayload: (resolvedArgs) =>
							hookContext(
								'upsert',
								resolvedArgs,
							) as BeforeCreateHookContext<Schema, Meta, Plugins>,
						kind: 'upsert',
						compiled: (resolvedArgs) =>
							getCompiledUpdateSet(resolvedArgs) ??
							getCompiledUpdateSet(resolvedArgs.update),
						operation: (resolvedArgs) =>
							upsertRecord(context, tableName, resolvedArgs),
					},
					args,
				),
			),
		upsertMany: (
			args: OperationArgsWithPlugins<
				UpsertManyArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'upsertMany'
			>,
		) =>
			runOperation(
				{
					action: 'upsertMany',
					afterHookName: 'afterCreate',
					afterPayload: (result, resolvedArgs) =>
						({
							...hookContext('upsertMany', resolvedArgs),
							compiled: getCompiledUpdateSet(resolvedArgs),
							result,
						}) as AfterCreateHookContext<Schema, Meta, Plugins>,
					beforeHookName: 'beforeCreate',
					beforePayload: (resolvedArgs) =>
						hookContext(
							'upsertMany',
							resolvedArgs,
						) as BeforeCreateHookContext<Schema, Meta, Plugins>,
					kind: 'upsertMany',
					compiled: (resolvedArgs) =>
						getCompiledUpdateSet(resolvedArgs),
					operation: (resolvedArgs) =>
						upsertManyRecords(context, tableName, resolvedArgs),
				},
				args,
			),
	});
};
