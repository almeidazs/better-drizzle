import type {
	AnyPlugin,
	AnySchema,
	BetterDrizzleClient,
	BetterDrizzleModelDelegate,
	BetterTableKey,
	CountArgs,
	CreateArgs,
	CreateManyArgs,
	CursorArgs,
	DeleteArgs,
	DeleteManyArgs,
	ExistsArgs,
	OperationArgsExtensionsOf,
	OperationArgsWithPlugins,
	PaginationArgs,
	PluginHookKind,
	PluginHooks,
	PluginMeta,
	PluginOperationArgsExtensionMap,
	PluginOperationInput,
	PluginRuntimeAfterHook,
	PluginRuntimeBeforeHook,
	PluginRuntimeBucket,
	PluginRuntimeTransactionHook,
	PluginRuntimeTransform,
	PluginState,
	QueryArgs,
	RuntimeContext,
	TableRuntime,
	UpdateArgs,
	UpdateEachArgs,
	UpdateManyArgs,
	UpsertArgs,
	UpsertManyArgs,
} from '../../types';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';
import { getMeta, isSimpleRecord } from './context';

const SKIP_PLUGINS_STATE = '__betterDrizzleSkipPlugins';

type AnyArgs<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
> =
	| OperationArgsWithPlugins<
			CountArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'count'
	  >
	| OperationArgsWithPlugins<
			CreateArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'create'
	  >
	| OperationArgsWithPlugins<
			CreateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'createMany'
	  >
	| OperationArgsWithPlugins<
			UpsertManyArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'upsertMany'
	  >
	| OperationArgsWithPlugins<
			DeleteArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'delete'
	  >
	| OperationArgsWithPlugins<
			DeleteManyArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'deleteMany'
	  >
	| OperationArgsWithPlugins<
			ExistsArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'exists'
	  >
	| OperationArgsWithPlugins<
			CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'cursor'
	  >
	| OperationArgsWithPlugins<
			PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'paginate'
	  >
	| OperationArgsWithPlugins<
			QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'findMany'
	  >
	| OperationArgsWithPlugins<
			QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'findFirst'
	  >
	| OperationArgsWithPlugins<
			QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'findOne'
	  >
	| OperationArgsWithPlugins<
			QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'findUnique'
	  >
	| OperationArgsWithPlugins<
			UpdateArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'update'
	  >
	| OperationArgsWithPlugins<
			UpdateEachArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'updateEach'
	  >
	| OperationArgsWithPlugins<
			UpdateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'updateMany'
	  >
	| OperationArgsWithPlugins<
			UpsertArgs<Schema, BetterTableKey<Schema>, Meta>,
			Plugins,
			'upsert'
	  >;

type HookName = keyof PluginHooks<AnySchema, unknown, PluginState>;
type PluginHookMap = Partial<Record<HookName, readonly PluginHookKind[]>>;
type TransactionHookName = Extract<
	HookName,
	| 'afterTransactionCommit'
	| 'afterTransactionRollback'
	| 'beforeTransaction'
	| 'onTransactionError'
>;
type RawHookName = Extract<HookName, 'afterRaw' | 'beforeRaw' | 'onRawError'>;
type BeforeHookResult<Args> = {
	args: Args;
	hasOverride: boolean;
	overrideResult: unknown;
};

const PLUGIN_HOOK_KINDS = {
	afterCreate: ['create', 'createMany', 'upsert', 'upsertMany'],
	afterDelete: ['delete', 'deleteMany'],
	afterQuery: [
		'count',
		'cursor',
		'exists',
		'findFirst',
		'findMany',
		'findOne',
		'findUnique',
		'paginate',
	],
	afterUpdate: ['update', 'updateEach', 'updateMany'],
	beforeCreate: ['create', 'createMany', 'upsert', 'upsertMany'],
	beforeDelete: ['delete', 'deleteMany'],
	beforeQuery: [
		'count',
		'cursor',
		'exists',
		'findFirst',
		'findMany',
		'findOne',
		'findUnique',
		'paginate',
	],
	beforeUpdate: ['update', 'updateEach', 'updateMany'],
} satisfies PluginHookMap;

const PLUGIN_TRANSACTION_HOOK_NAMES = [
	'afterTransactionCommit',
	'afterTransactionRollback',
	'beforeTransaction',
	'onTransactionError',
] as const satisfies readonly TransactionHookName[];

const PLUGIN_RAW_HOOK_NAMES = [
	'afterRaw',
	'beforeRaw',
	'onRawError',
] as const satisfies readonly RawHookName[];

const getPluginMeta = (plugin: AnyPlugin): PluginMeta => ({
	description: plugin.description,
	id: plugin.id,
	name: plugin.name,
	options: plugin.options,
	version: plugin.version,
});

const getBeforeHookName = (
	kind: PluginHookKind,
): Extract<
	HookName,
	'beforeCreate' | 'beforeDelete' | 'beforeQuery' | 'beforeUpdate'
> => {
	if (
		kind === 'create' ||
		kind === 'createMany' ||
		kind === 'upsert' ||
		kind === 'upsertMany'
	)
		return 'beforeCreate';
	if (kind === 'delete' || kind === 'deleteMany') return 'beforeDelete';
	if (kind === 'update' || kind === 'updateEach' || kind === 'updateMany')
		return 'beforeUpdate';
	return 'beforeQuery';
};

const getBucket = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	kind: PluginHookKind,
) => context.plugins.byKind[kind];

const registerBeforeHook = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	kind: PluginHookKind,
	hook: PluginRuntimeBeforeHook,
) => {
	const bucket = getBucket(context, kind);
	bucket.beforeHooks.push(hook);
	bucket.hasBeforeHooks = true;
};

const registerAfterHook = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	kind: PluginHookKind,
	hook: PluginRuntimeAfterHook,
) => {
	const bucket = getBucket(context, kind);
	bucket.afterHooks.push(hook);
	bucket.hasAfterHooks = true;
};

const registerTransform = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	transform: PluginRuntimeTransform,
) => {
	for (const kind of Object.keys(
		context.plugins.byKind,
	) as PluginHookKind[]) {
		const bucket = context.plugins.byKind[kind];
		bucket.transforms.push(transform);
		bucket.hasTransforms = true;
	}
};

const registerTransactionHook = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	hookName: TransactionHookName,
	hook: PluginRuntimeTransactionHook,
) => {
	const bucket = context.plugins.transaction;

	if (hookName === 'beforeTransaction') bucket.beforeHooks.push(hook);
	else if (hookName === 'afterTransactionCommit')
		bucket.afterCommitHooks.push(hook);
	else if (hookName === 'afterTransactionRollback')
		bucket.afterRollbackHooks.push(hook);
	else bucket.errorHooks.push(hook);
};

const registerRawHook = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	hookName: RawHookName,
	hook: PluginRuntimeAfterHook,
) => {
	const bucket = context.plugins.raw;

	if (hookName === 'beforeRaw') bucket.beforeHooks.push(hook);
	else if (hookName === 'afterRaw') bucket.afterHooks.push(hook);
	else bucket.errorHooks.push(hook);
};

const registerPluginHooks = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	hooks: PluginHooks<AnySchema, unknown, PluginState>,
) => {
	for (const hookName of Object.keys(PLUGIN_HOOK_KINDS) as Array<
		keyof typeof PLUGIN_HOOK_KINDS
	>) {
		const hook = hooks[hookName];
		if (!hook) continue;

		const kinds = PLUGIN_HOOK_KINDS[hookName];
		if (!kinds) continue;

		for (const kind of kinds)
			if (hookName.startsWith('before'))
				registerBeforeHook(
					context,
					kind,
					hook as unknown as PluginRuntimeBeforeHook,
				);
			else
				registerAfterHook(
					context,
					kind,
					hook as unknown as PluginRuntimeAfterHook,
				);
	}

	for (const hookName of PLUGIN_TRANSACTION_HOOK_NAMES) {
		const hook = hooks[hookName];
		if (!hook) continue;

		registerTransactionHook(
			context,
			hookName,
			hook as unknown as PluginRuntimeTransactionHook,
		);
	}

	for (const hookName of PLUGIN_RAW_HOOK_NAMES) {
		const hook = hooks[hookName];
		if (!hook) continue;

		registerRawHook(
			context,
			hookName,
			hook as unknown as PluginRuntimeAfterHook,
		);
	}
};

const createOperationInput = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	runtime: TableRuntime,
	tableName: BetterTableKey<Schema>,
	kind: PluginHookKind,
	args: AnyArgs<Schema, Meta, Plugins>,
	state: PluginState,
): PluginOperationInput<
	Schema,
	BetterTableKey<Schema>,
	Meta,
	PluginState,
	OperationArgsExtensionsOf<Plugins>
> => {
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
	const input = {
		afterCommit: registerAfterCommit,
		afterRollback: registerAfterRollback,
		args,
		db: context.db,
		dialect: context.dialect,
		isInTransaction: Boolean(context.transaction),
		kind,
		meta: getMeta(context, args),
		model: runtime.model,
		options: context.options,
		schema: context.fullSchema,
		state,
		table: tableName,
		transaction: context.transaction
			? (context.client as RuntimeContext<
					Schema,
					Meta,
					Plugins
				>['client'])
			: null,
		transactionContext: context.transaction?.context,
	} as PluginOperationInput<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		PluginState,
		OperationArgsExtensionsOf<Plugins>
	>;

	if ('where' in args) input.where = args.where as typeof input.where;
	if ('select' in args) input.select = args.select as typeof input.select;
	if ('include' in args) input.include = args.include as typeof input.include;
	if ('orderBy' in args) input.orderBy = args.orderBy as typeof input.orderBy;
	if ('take' in args) input.take = args.take as typeof input.take;
	if ('skip' in args) input.skip = args.skip as typeof input.skip;
	if ('cursor' in args)
		(input as Record<string, unknown>).cursor = args.cursor as unknown;

	if ('data' in args) input.data = args.data as typeof input.data;
	else if ('create' in args && 'update' in args)
		input.data = {
			create: args.create,
			update: args.update,
		} as typeof input.data;

	return input;
};

const assignOperationArgs = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	kind: PluginHookKind,
	args: AnyArgs<Schema, Meta, Plugins>,
	input: PluginOperationInput<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		PluginState,
		OperationArgsExtensionsOf<Plugins>
	>,
) => {
	(args as Record<string, unknown>).where = input.where as unknown;
	(args as Record<string, unknown>).select = input.select as unknown;
	(args as Record<string, unknown>).include = input.include as unknown;
	(args as Record<string, unknown>).orderBy = input.orderBy as unknown;
	(args as Record<string, unknown>).take = input.take as unknown;
	(args as Record<string, unknown>).skip = input.skip as unknown;
	(args as Record<string, unknown>).cursor = (
		input as Record<string, unknown>
	).cursor;

	if (
		kind === 'create' ||
		kind === 'createMany' ||
		kind === 'upsertMany' ||
		kind === 'update' ||
		kind === 'updateEach' ||
		kind === 'updateMany'
	)
		(args as { data?: unknown }).data = input.data;

	if (kind === 'upsert' && isSimpleRecord(input.data)) {
		const data = input.data as { create?: unknown; update?: unknown };
		(args as { create?: unknown }).create = data.create;
		(args as { update?: unknown }).update = data.update;
	}
};

const cloneArgs = <Args extends Record<string, unknown> | undefined>(
	args: Args,
) =>
	(args ? { ...args } : {}) as Args extends undefined
		? Record<string, never>
		: Args;

/**
 * Determines whether the plugin pipeline should run for a given operation.
 * Returns `false` when there are no plugins or the state explicitly
 * disables plugin execution (e.g. via `$withoutPlugins()`).
 *
 * @param hasPlugins - Whether any plugins are registered on the client.
 * @param state      - The current plugin state.
 * @returns `true` when the plugin pipeline should execute.
 */
export const shouldRunPlugins = (
	hasPlugins: boolean,
	state: PluginState | undefined,
) => hasPlugins && !state?.[SKIP_PLUGINS_STATE];

/**
 * Checks whether the given operation kind has any registered plugin
 * hooks or transforms that need to run.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @param context - The runtime context.
 * @param kind    - The operation kind to check.
 * @returns `true` when at least one before-hook, after-hook, or transform is registered.
 */
export const hasPluginWork = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	kind: PluginHookKind,
) => {
	const bucket = getBucket(context, kind);
	return (
		bucket.hasBeforeHooks || bucket.hasAfterHooks || bucket.hasTransforms
	);
};

/**
 * Creates an initial plugin state object. Returns the provided state
 * or a new empty object when none is given.
 *
 * @param state - Optional existing state to preserve.
 * @returns A `PluginState` object.
 */
export const createPluginState = (state?: PluginState) =>
	(state ?? Object.create(null)) as PluginState;

/**
 * Merges two plugin state objects into a new object without mutating
 * either input. Later properties take precedence.
 *
 * @param state - The base state.
 * @param next  - The state to merge on top.
 * @returns A new `PluginState` containing all properties from both inputs.
 */
export const mergePluginState = (state: PluginState, next: PluginState) =>
	Object.assign(Object.create(null), state, next) as PluginState;

/**
 * Initialises all registered plugins during client bootstrap. Validates
 * plugin IDs (uniqueness), dialect compatibility, column requirements,
 * and operation-arg ownership. Runs each plugin's `setup()` method
 * and registers their hooks, transforms, and extensions.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @param context - The runtime context to populate with plugin data.
 */
export const initializePlugins = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
) => {
	const seenIds = new Set<string>();
	const seenOperationArgs = Object.create(null) as Record<
		PluginHookKind,
		Record<string, string>
	>;
	const plugins = context.options.plugins ?? [];

	for (const kind of Object.keys(context.plugins.byKind) as PluginHookKind[])
		seenOperationArgs[kind] = Object.create(null) as Record<string, string>;

	for (const plugin of plugins) {
		if (seenIds.has(plugin.id))
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.PluginDuplicateId,
				message: `Duplicate Better Drizzle plugin id "${plugin.id}".`,
				details: { pluginId: plugin.id },
			});

		seenIds.add(plugin.id);

		if (
			plugin.config?.dialects?.length &&
			!plugin.config.dialects.includes(context.dialect)
		)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.PluginDialectUnsupported,
				dialect: context.dialect,
				message: `Plugin "${plugin.id}" does not support dialect "${context.dialect}".`,
				details: { pluginId: plugin.id },
			});

		const requiredColumns = plugin.config?.requires?.columns;
		if (requiredColumns?.length)
			for (const model of Object.values(context.models) as Array<{
				hasColumn(column: string): boolean;
				name: string;
			}>)
				for (const requirement of requiredColumns)
					if (!model.hasColumn(requirement.column))
						throw new BetterDrizzleError({
							code: BetterDrizzleErrorCode.PluginRequiredColumnMissing,
							column: requirement.column,
							message: `Plugin "${plugin.id}" requires column "${requirement.column}" on model "${model.name}".`,
							table: model.name,
							details: { pluginId: plugin.id },
						});

		if (plugin.operationArgs)
			for (const kind of Object.keys(
				plugin.operationArgs,
			) as PluginHookKind[]) {
				const extension = (
					plugin.operationArgs as Partial<PluginOperationArgsExtensionMap>
				)[kind];
				if (!extension) continue;

				for (const key of Object.keys(extension)) {
					const owner = seenOperationArgs[kind]?.[key];
					if (owner)
						throw new BetterDrizzleError({
							code: BetterDrizzleErrorCode.PluginOperationArgConflict,
							message: `Plugin "${plugin.id}" cannot override operation arg "${key}" on "${kind}" because it is already declared by plugin "${owner}".`,
							operation: kind,
							details: {
								key,
								owner,
								pluginId: plugin.id,
							},
						});

					seenOperationArgs[kind][key] = plugin.id;
				}
			}

		context.plugins.meta.push(getPluginMeta(plugin));
		if (plugin.hooks) registerPluginHooks(context, plugin.hooks);
		if (plugin.transform)
			registerTransform(
				context,
				plugin.transform as unknown as PluginRuntimeTransform,
			);

		plugin.setup?.({
			addHook(hook) {
				registerPluginHooks(
					context,
					hook as PluginHooks<AnySchema, unknown, PluginState>,
				);
			},
			addTransform(transform) {
				registerTransform(
					context,
					transform as unknown as PluginRuntimeTransform,
				);
			},
			dialect: context.dialect,
			isColumnExists(model, column) {
				return (
					context.models[model as BetterTableKey<Schema>]?.hasColumn(
						column,
					) ?? false
				);
			},
			models: context.models as never,
			plugin: getPluginMeta(plugin),
			schema: context.fullSchema,
		});
	}
};

const assertExtensionKeys = (
	scope: string,
	plugin: PluginMeta,
	target: Record<string, unknown>,
	extension: Record<string, unknown>,
) => {
	for (const key in extension)
		if (key in target)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.PluginExtensionConflict,
				message: `Plugin "${plugin.id}" cannot override "${key}" on ${scope}.`,
				details: {
					key,
					pluginId: plugin.id,
					scope,
				},
			});
};

/**
 * Applies model-level extensions from all registered plugins to a
 * delegate instance. Each plugin's `extendModel()` callback is invoked
 * and its returned properties are merged onto the delegate. Throws if
 * a plugin attempts to override an existing property.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @param context   - The runtime context.
 * @param tableName - The table key to apply extensions for.
 * @param delegate  - The model delegate to extend.
 * @returns The delegate with plugin extensions applied.
 */
export const applyModelExtensions = <
	Schema extends AnySchema,
	Meta,
	Name extends BetterTableKey<Schema>,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	tableName: Name,
	delegate: BetterDrizzleModelDelegate<Schema, Name, Meta, Plugins>,
) => {
	const plugins = context.options.plugins ?? [];
	const runtime = context.tables[tableName as string];
	if (!runtime) return delegate;

	for (const plugin of plugins) {
		const extension = plugin.extendModel?.({
			client: delegate,
			db: context.db,
			dialect: context.dialect,
			model: runtime.model,
			plugin: getPluginMeta(plugin),
			schema: context.fullSchema,
		} as never);
		if (!extension) continue;

		assertExtensionKeys(
			`model "${String(tableName)}"`,
			getPluginMeta(plugin),
			delegate as Record<string, unknown>,
			extension,
		);
		Object.assign(delegate as Record<string, unknown>, extension);
	}

	return delegate;
};

/**
 * Applies client-level extensions from all registered plugins to the
 * Better Drizzle client. Each plugin's `extendClient()` callback is
 * invoked and its returned properties are merged onto the client.
 * Throws if a plugin attempts to override an existing property.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @param context - The runtime context.
 * @param client  - The Better Drizzle client to extend.
 */
export const applyClientExtensions = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	client: BetterDrizzleClient<Schema, Meta, Plugins>,
) => {
	const plugins = context.options.plugins ?? [];

	for (const plugin of plugins) {
		const extension = plugin.extendClient?.({
			client,
			db: context.db,
			dialect: context.dialect,
			models: context.models as never,
			plugin: getPluginMeta(plugin),
			schema: context.fullSchema,
		});
		if (!extension) continue;

		assertExtensionKeys(
			'client',
			getPluginMeta(plugin),
			client as Record<string, unknown>,
			extension,
		);
		Object.assign(client as Record<string, unknown>, extension);
	}
};

const runBeforeHooks = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	bucket: PluginRuntimeBucket,
	input: PluginOperationInput<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		PluginState,
		OperationArgsExtensionsOf<Plugins>
	>,
	delegate: BetterDrizzleModelDelegate<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		Plugins
	>,
) => {
	if (!bucket.hasBeforeHooks) return;

	const hookName = getBeforeHookName(input.kind);
	let hasOverride = false;
	let overrideResult: unknown;

	for (const hook of bucket.beforeHooks) {
		const result = await hook({ ...input, client: delegate });
		if (
			result !== undefined &&
			(hookName === 'beforeCreate' || hookName === 'beforeUpdate')
		)
			input.data = result as typeof input.data;
		else if (
			result !== undefined &&
			(hookName === 'beforeDelete' || hookName === 'beforeQuery')
		) {
			hasOverride = true;
			overrideResult = result;
		}
	}

	return hasOverride
		? {
				hasOverride,
				result: overrideResult,
			}
		: undefined;
};

/**
 * Runs the full plugin pipeline for a given operation: clones the args,
 * builds a `PluginOperationInput`, executes all before-hooks and
 * transforms, then assigns the (possibly modified) args back.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @param context   - The runtime context.
 * @param runtime   - The table runtime metadata.
 * @param tableName - The TypeScript table key.
 * @param kind      - The operation kind.
 * @param args      - The original operation arguments.
 * @param state     - The current plugin state.
 * @param delegate  - The model delegate (passed to before-hooks).
 * @returns The operation arguments after all transforms have been applied.
 */
export const runPluginPipeline = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	runtime: TableRuntime,
	tableName: BetterTableKey<Schema>,
	kind: PluginHookKind,
	args: AnyArgs<Schema, Meta, Plugins>,
	state: PluginState,
	delegate: BetterDrizzleModelDelegate<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		Plugins
	>,
): Promise<BeforeHookResult<AnyArgs<Schema, Meta, Plugins>>> => {
	const bucket = getBucket(context, kind);
	if (!bucket.hasBeforeHooks && !bucket.hasTransforms)
		return {
			args,
			hasOverride: false,
			overrideResult: undefined,
		};

	const nextArgs = cloneArgs(args as Record<string, unknown>) as AnyArgs<
		Schema,
		Meta,
		Plugins
	>;
	const input = createOperationInput(
		context,
		runtime,
		tableName,
		kind,
		nextArgs,
		state,
	);

	const beforeHookResult = await runBeforeHooks(bucket, input, delegate);

	for (const transform of bucket.transforms) {
		const nextInput = transform(input as Record<string, unknown>);

		if (nextInput) Object.assign(input, nextInput);
	}

	assignOperationArgs(kind, nextArgs, input);
	return beforeHookResult
		? {
				args: nextArgs,
				hasOverride: true,
				overrideResult: beforeHookResult.result,
			}
		: {
				args: nextArgs,
				hasOverride: false,
				overrideResult: undefined,
			};
};

/**
 * Runs all registered after-hooks for a given operation kind. After-hooks
 * receive the operation result and can perform side-effects (logging,
 * metrics, cache invalidation) but cannot modify the result.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type.
 * @typeParam Plugins - The plugin tuple.
 * @typeParam Result  - The operation result type.
 * @param context   - The runtime context.
 * @param runtime   - The table runtime metadata.
 * @param tableName - The TypeScript table key.
 * @param kind      - The operation kind.
 * @param args      - The (possibly transformed) operation arguments.
 * @param state     - The current plugin state.
 * @param delegate  - The model delegate (passed to after-hooks).
 * @param result    - The result of the executed operation.
 */
export const runPluginAfterHooks = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Result,
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	runtime: TableRuntime,
	tableName: BetterTableKey<Schema>,
	kind: PluginHookKind,
	args: AnyArgs<Schema, Meta, Plugins>,
	state: PluginState,
	delegate: BetterDrizzleModelDelegate<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		Plugins
	>,
	result: Result,
) => {
	const bucket = getBucket(context, kind);
	if (!bucket.hasAfterHooks) return;

	const input = createOperationInput(
		context,
		runtime,
		tableName,
		kind,
		args,
		state,
	);

	for (const hook of bucket.afterHooks) {
		await hook({ ...input, client: delegate, result });
	}
};

export const runPluginTransactionHooks = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	hookName: TransactionHookName,
	payload: Record<string, unknown>,
) => {
	const bucket = context.plugins.transaction;
	const hooks =
		hookName === 'beforeTransaction'
			? bucket.beforeHooks
			: hookName === 'afterTransactionCommit'
				? bucket.afterCommitHooks
				: hookName === 'afterTransactionRollback'
					? bucket.afterRollbackHooks
					: bucket.errorHooks;

	for (const hook of hooks) await hook(payload);
};

export const runPluginRawHooks = async <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	hookName: RawHookName,
	payload: Record<string, unknown>,
) => {
	const bucket = context.plugins.raw;
	const hooks =
		hookName === 'beforeRaw'
			? bucket.beforeHooks
			: hookName === 'afterRaw'
				? bucket.afterHooks
				: bucket.errorHooks;

	for (const hook of hooks) await hook(payload);
};

/**
 * Creates a special plugin state that explicitly disables plugin
 * execution for the current operation. Used by `$withoutPlugins()`.
 *
 * @returns A `PluginState` with the skip-plugins flag set.
 */
export const skipPluginsState = () =>
	({
		[SKIP_PLUGINS_STATE]: true,
	}) as PluginState;
