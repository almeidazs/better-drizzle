import type {
	AfterCreateHookContext,
	AfterDeleteHookContext,
	AfterQueryHookContext,
	AfterUpdateHookContext,
	AnyPlugin,
	AnySchema,
	BeforeCreateHookContext,
	BeforeDeleteHookContext,
	BeforeQueryHookContext,
	BeforeUpdateHookContext,
	BetterDrizzleModelDelegate,
	BetterTableKey,
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
import { countRows } from '../query';
import { getTableRuntime } from './context';
import { explainOperation } from './explain';
import {
	attachExplain,
	attachThrow,
	buildHookContext,
	executeOperation,
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
} from './operations';
import {
	createPluginState,
	hasPluginWork,
	mergePluginState,
	runPluginAfterHooks,
	runPluginPipeline,
	shouldRunPlugins,
	skipPluginsState,
} from './plugins';

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

	const runOperation = <Args, Result>({
		action,
		args,
		afterHookName,
		afterPayload,
		beforeHookName,
		beforePayload,
		kind,
		operation,
	}: {
		action: string;
		args: Args;
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
	}): Promise<Result> => {
		assertTransactionNotAborted();

		if (!shouldApplyPlugins || !hasPluginWork(context, kind))
			return executeOperation({
				action,
				args,
				afterHookName,
				afterPayload: afterPayload
					? (result) => afterPayload(result, args)
					: undefined,
				beforeHookName,
				beforePayload: beforePayload
					? () => beforePayload(args)
					: undefined,
				context,
				operation: () => operation(args),
				runtime,
				tableName: name,
			});

		return (async () => {
			assertTransactionNotAborted();

			const pipeline = await runPluginPipeline(
				context,
				runtime,
				tableName,
				kind,
				args as never,
				state,
				delegate,
			);
			const operationArgs = pipeline.args as Args;
			const result = await executeOperation({
				action,
				args: operationArgs,
				afterHookName,
				afterPayload: afterPayload
					? (value) => afterPayload(value, operationArgs)
					: undefined,
				beforeHookName,
				beforePayload: beforePayload
					? () => beforePayload(operationArgs)
					: undefined,
				context,
				operation: () =>
					pipeline.hasOverride
						? Promise.resolve(pipeline.overrideResult as Result)
						: operation(operationArgs),
				runtime,
				tableName: name,
			});

			await runPluginAfterHooks(
				context,
				runtime,
				tableName,
				kind,
				operationArgs as never,
				state,
				delegate,
				result,
			);

			assertTransactionNotAborted();

			return result;
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

	const withExplain = <Args, Result>(
		operationThunk: () => Promise<Result>,
		operation: ExplainOperation,
		args: Args,
	) =>
		attachExplain(operationThunk, async (options) =>
			explainOperation(
				context,
				tableName,
				operation,
				await resolveExplainArgs(operation, args),
				options,
			),
		);

	return Object.assign(delegate, {
		count: (
			args?: OperationArgsWithPlugins<
				CountArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'count'
			>,
		) => {
			const operationArgs =
				args ??
				({} as OperationArgsWithPlugins<
					CountArgs<Schema, BetterTableKey<Schema>, Meta>,
					Plugins,
					'count'
				>);

			return withExplain(
				() =>
					runOperation({
						action: 'count',
						args: operationArgs,
						afterHookName: 'afterQuery',
						afterPayload: (result, resolvedArgs) =>
							({
								...hookContext('count', resolvedArgs),
								result,
							}) as AfterQueryHookContext<Schema, Meta, Plugins>,
						beforeHookName: 'beforeQuery',
						beforePayload: (resolvedArgs) =>
							hookContext(
								'count',
								resolvedArgs,
							) as BeforeQueryHookContext<Schema, Meta, Plugins>,
						kind: 'count',
						operation: (resolvedArgs) =>
							countRows(
								context,
								tableName,
								resolvedArgs.where,
								resolvedArgs.cursor,
							),
					}),
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
			const operationArgs =
				args ??
				({} as OperationArgsWithPlugins<
					ExistsArgs<Schema, BetterTableKey<Schema>, Meta>,
					Plugins,
					'exists'
				>);

			return withExplain(
				() =>
					runOperation({
						action: 'exists',
						args: operationArgs,
						afterHookName: 'afterQuery',
						afterPayload: (result, resolvedArgs) =>
							({
								...hookContext('exists', resolvedArgs),
								result,
							}) as AfterQueryHookContext<Schema, Meta, Plugins>,
						beforeHookName: 'beforeQuery',
						beforePayload: (resolvedArgs) =>
							hookContext(
								'exists',
								resolvedArgs,
							) as BeforeQueryHookContext<Schema, Meta, Plugins>,
						kind: 'exists',
						operation: (resolvedArgs) =>
							existsRecord(context, tableName, resolvedArgs),
					}),
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
			runOperation({
				action: 'createMany',
				args,
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
			}),
		findMany: (
			args?: OperationArgsWithPlugins<
				QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'findMany'
			>,
		) => {
			const operationArgs =
				args ??
				({} as OperationArgsWithPlugins<
					QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
					Plugins,
					'findMany'
				>);

			return withExplain(
				() =>
					runOperation({
						action: 'findMany',
						args: operationArgs,
						afterHookName: 'afterQuery',
						afterPayload: (result, resolvedArgs) =>
							({
								...hookContext('findMany', resolvedArgs),
								result,
								rows: result,
							}) as AfterQueryHookContext<Schema, Meta, Plugins>,
						beforeHookName: 'beforeQuery',
						beforePayload: (resolvedArgs) =>
							hookContext(
								'findMany',
								resolvedArgs,
							) as BeforeQueryHookContext<Schema, Meta, Plugins>,
						kind: 'findMany',
						operation: (resolvedArgs) =>
							findManyRecords(context, tableName, resolvedArgs),
					}),
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
			const operationArgs =
				args ??
				({} as OperationArgsWithPlugins<
					QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
					Plugins,
					'findFirst'
				>);

			return attachThrow(
				withExplain(
					() =>
						runOperation<
							OperationArgsWithPlugins<
								QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
								Plugins,
								'findFirst'
							>,
							Record<string, unknown> | null
						>({
							action: 'findFirst',
							args: operationArgs,
							afterHookName: 'afterQuery',
							afterPayload: (result, resolvedArgs) =>
								({
									...hookContext('findFirst', resolvedArgs),
									result,
									row: result,
								}) as AfterQueryHookContext<
									Schema,
									Meta,
									Plugins
								>,
							beforeHookName: 'beforeQuery',
							beforePayload: (resolvedArgs) =>
								hookContext(
									'findFirst',
									resolvedArgs,
								) as BeforeQueryHookContext<
									Schema,
									Meta,
									Plugins
								>,
							kind: 'findFirst',
							operation: (resolvedArgs) =>
								findFirstRecord(
									context,
									tableName,
									resolvedArgs,
								),
						}),
					'findFirst',
					operationArgs,
				),
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
			const operationArgs =
				args ??
				({} as OperationArgsWithPlugins<
					QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
					Plugins,
					'findOne'
				>);

			return attachThrow(
				withExplain(
					() =>
						runOperation<
							OperationArgsWithPlugins<
								QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
								Plugins,
								'findOne'
							>,
							Record<string, unknown> | null
						>({
							action: 'findOne',
							args: operationArgs,
							afterHookName: 'afterQuery',
							afterPayload: (result, resolvedArgs) =>
								({
									...hookContext('findOne', resolvedArgs),
									result,
									row: result,
								}) as AfterQueryHookContext<
									Schema,
									Meta,
									Plugins
								>,
							beforeHookName: 'beforeQuery',
							beforePayload: (resolvedArgs) =>
								hookContext(
									'findOne',
									resolvedArgs,
								) as BeforeQueryHookContext<
									Schema,
									Meta,
									Plugins
								>,
							kind: 'findOne',
							operation: (resolvedArgs) =>
								findFirstRecord(
									context,
									tableName,
									resolvedArgs,
								),
						}),
					'findOne',
					operationArgs,
				),
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
						runOperation<
							OperationArgsWithPlugins<
								QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
								Plugins,
								'findUnique'
							>,
							Record<string, unknown> | null
						>({
							action: 'findUnique',
							args,
							afterHookName: 'afterQuery',
							afterPayload: (result, resolvedArgs) =>
								({
									...hookContext('findUnique', resolvedArgs),
									result,
									row: result,
								}) as AfterQueryHookContext<
									Schema,
									Meta,
									Plugins
								>,
							beforeHookName: 'beforeQuery',
							beforePayload: (resolvedArgs) =>
								hookContext(
									'findUnique',
									resolvedArgs,
								) as BeforeQueryHookContext<
									Schema,
									Meta,
									Plugins
								>,
							kind: 'findUnique',
							operation: (resolvedArgs) =>
								findFirstRecord(
									context,
									tableName,
									resolvedArgs,
								),
						}),
					'findUnique',
					args,
				),
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
			runOperation({
				action: 'create',
				args,
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
			}),
		paginate: (
			args: OperationArgsWithPlugins<
				PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'paginate'
			>,
		) =>
			withExplain(
				() =>
					runOperation({
						action: 'paginate',
						args,
						afterHookName: 'afterQuery',
						afterPayload: (result, resolvedArgs) =>
							({
								...hookContext('paginate', resolvedArgs),
								result,
							}) as AfterQueryHookContext<Schema, Meta, Plugins>,
						beforeHookName: 'beforeQuery',
						beforePayload: (resolvedArgs) =>
							hookContext(
								'paginate',
								resolvedArgs,
							) as BeforeQueryHookContext<Schema, Meta, Plugins>,
						kind: 'paginate',
						operation: (resolvedArgs) =>
							paginateRecords(context, tableName, resolvedArgs),
					}),
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
					runOperation({
						action: 'cursor',
						args,
						afterHookName: 'afterQuery',
						afterPayload: (result, resolvedArgs) =>
							({
								...hookContext('cursor', resolvedArgs),
								result,
							}) as AfterQueryHookContext<Schema, Meta, Plugins>,
						beforeHookName: 'beforeQuery',
						beforePayload: (resolvedArgs) =>
							hookContext(
								'cursor',
								resolvedArgs,
							) as BeforeQueryHookContext<Schema, Meta, Plugins>,
						kind: 'cursor',
						operation: (resolvedArgs) =>
							cursorRecords(context, tableName, resolvedArgs),
					}),
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
				runOperation<
					OperationArgsWithPlugins<
						UpdateArgs<Schema, BetterTableKey<Schema>, Meta>,
						Plugins,
						'update'
					>,
					Record<string, unknown> | null
				>({
					action: 'update',
					args,
					afterHookName: 'afterUpdate',
					afterPayload: (result, resolvedArgs) =>
						({
							...hookContext('update', resolvedArgs),
							result,
							row: result,
						}) as AfterUpdateHookContext<Schema, Meta, Plugins>,
					beforeHookName: 'beforeUpdate',
					beforePayload: (resolvedArgs) =>
						hookContext(
							'update',
							resolvedArgs,
						) as BeforeUpdateHookContext<Schema, Meta, Plugins>,
					kind: 'update',
					operation: (resolvedArgs) =>
						updateRecord(context, tableName, resolvedArgs),
				}),
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
			runOperation({
				action: 'updateMany',
				args,
				afterHookName: 'afterUpdate',
				afterPayload: (result, resolvedArgs) =>
					({
						...hookContext('updateMany', resolvedArgs),
						result,
					}) as AfterUpdateHookContext<Schema, Meta, Plugins>,
				beforeHookName: 'beforeUpdate',
				beforePayload: (resolvedArgs) =>
					hookContext(
						'updateMany',
						resolvedArgs,
					) as BeforeUpdateHookContext<Schema, Meta, Plugins>,
				kind: 'updateMany',
				operation: (resolvedArgs) =>
					updateManyRecords(context, tableName, resolvedArgs),
			}),
		updateEach: (
			args: OperationArgsWithPlugins<
				UpdateEachArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'updateEach'
			>,
		) =>
			runOperation({
				action: 'updateEach',
				args,
				afterHookName: 'afterUpdate',
				afterPayload: (result, resolvedArgs) =>
					({
						...hookContext('updateEach', resolvedArgs),
						result,
					}) as AfterUpdateHookContext<Schema, Meta, Plugins>,
				beforeHookName: 'beforeUpdate',
				beforePayload: (resolvedArgs) =>
					hookContext(
						'updateEach',
						resolvedArgs,
					) as BeforeUpdateHookContext<Schema, Meta, Plugins>,
				kind: 'updateEach',
				operation: (resolvedArgs) =>
					updateEachRecords(context, tableName, resolvedArgs),
			}),
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
				>({
					action: 'delete',
					args,
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
				}),
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
			runOperation({
				action: 'deleteMany',
				args,
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
			}),
		upsert: (
			args: OperationArgsWithPlugins<
				UpsertArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'upsert'
			>,
		) =>
			runOperation({
				action: 'upsert',
				args,
				afterHookName: 'afterCreate',
				afterPayload: (result, resolvedArgs) =>
					({
						...hookContext('upsert', resolvedArgs),
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
				operation: (resolvedArgs) =>
					upsertRecord(context, tableName, resolvedArgs),
			}),
		upsertMany: (
			args: OperationArgsWithPlugins<
				UpsertManyArgs<Schema, BetterTableKey<Schema>, Meta>,
				Plugins,
				'upsertMany'
			>,
		) =>
			runOperation({
				action: 'upsertMany',
				args,
				afterHookName: 'afterCreate',
				afterPayload: (result, resolvedArgs) =>
					({
						...hookContext('upsertMany', resolvedArgs),
						result,
					}) as AfterCreateHookContext<Schema, Meta, Plugins>,
				beforeHookName: 'beforeCreate',
				beforePayload: (resolvedArgs) =>
					hookContext(
						'upsertMany',
						resolvedArgs,
					) as BeforeCreateHookContext<Schema, Meta, Plugins>,
				kind: 'upsertMany',
				operation: (resolvedArgs) =>
					upsertManyRecords(context, tableName, resolvedArgs),
			}),
	});
};
