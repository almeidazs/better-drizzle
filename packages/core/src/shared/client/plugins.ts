import type {
	AnyPlugin,
	AnySchema,
	BetterDrizzleClient,
	BetterDrizzleModelDelegate,
	BetterTableKey,
	CountArgs,
	CreateArgs,
	CreateManyArgs,
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
	PluginRuntimeTransform,
	PluginState,
	QueryArgs,
	RuntimeContext,
	TableRuntime,
	UpdateArgs,
	UpdateManyArgs,
	UpsertArgs,
} from '../../types';
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

const PLUGIN_HOOK_KINDS = {
	afterCreate: ['create', 'createMany', 'upsert'],
	afterDelete: ['delete', 'deleteMany'],
	afterQuery: [
		'count',
		'exists',
		'findFirst',
		'findMany',
		'findOne',
		'findUnique',
		'paginate',
	],
	afterUpdate: ['update', 'updateMany'],
	beforeCreate: ['create', 'createMany', 'upsert'],
	beforeDelete: ['delete', 'deleteMany'],
	beforeQuery: [
		'count',
		'exists',
		'findFirst',
		'findMany',
		'findOne',
		'findUnique',
		'paginate',
	],
	beforeUpdate: ['update', 'updateMany'],
} satisfies PluginHookMap;

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
	if (kind === 'create' || kind === 'createMany' || kind === 'upsert')
		return 'beforeCreate';
	if (kind === 'delete' || kind === 'deleteMany') return 'beforeDelete';
	if (kind === 'update' || kind === 'updateMany') return 'beforeUpdate';
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

const registerPluginHooks = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	hooks: PluginHooks<AnySchema, unknown, PluginState>,
) => {
	for (const hookName of Object.keys(PLUGIN_HOOK_KINDS) as HookName[]) {
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
	const input = {
		args,
		db: context.db,
		dialect: context.dialect,
		kind,
		meta: getMeta<Meta>(args),
		model: runtime.model,
		options: context.options,
		schema: context.fullSchema,
		state,
		table: tableName,
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
		kind === 'update' ||
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

export const shouldRunPlugins = (
	hasPlugins: boolean,
	state: PluginState | undefined,
) => hasPlugins && !state?.[SKIP_PLUGINS_STATE];

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

export const createPluginState = (state?: PluginState) =>
	(state ?? Object.create(null)) as PluginState;

export const mergePluginState = (state: PluginState, next: PluginState) =>
	Object.assign(Object.create(null), state, next) as PluginState;

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
			throw new Error(
				`Duplicate Better Drizzle plugin id "${plugin.id}".`,
			);

		seenIds.add(plugin.id);

		if (
			plugin.config?.dialects?.length &&
			!plugin.config.dialects.includes(context.dialect)
		)
			throw new Error(
				`Plugin "${plugin.id}" does not support dialect "${context.dialect}".`,
			);

		const requiredColumns = plugin.config?.requires?.columns;
		if (requiredColumns?.length)
			for (const model of Object.values(context.models) as Array<{
				hasColumn(column: string): boolean;
				name: string;
			}>)
				for (const requirement of requiredColumns)
					if (!model.hasColumn(requirement.column))
						throw new Error(
							`Plugin "${plugin.id}" requires column "${requirement.column}" on model "${model.name}".`,
						);

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
						throw new Error(
							`Plugin "${plugin.id}" cannot override operation arg "${key}" on "${kind}" because it is already declared by plugin "${owner}".`,
						);

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
			throw new Error(
				`Plugin "${plugin.id}" cannot override "${key}" on ${scope}.`,
			);
};

export const applyModelExtensions = <
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	tableName: BetterTableKey<Schema>,
	delegate: BetterDrizzleModelDelegate<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		Plugins
	>,
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
		});
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
	for (const hook of bucket.beforeHooks) {
		const result = await hook({ ...input, client: delegate });
		if (
			result !== undefined &&
			(hookName === 'beforeCreate' || hookName === 'beforeUpdate')
		)
			input.data = result as typeof input.data;
	}
};

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
) => {
	const bucket = getBucket(context, kind);
	if (!bucket.hasBeforeHooks && !bucket.hasTransforms) return args;

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

	await runBeforeHooks(bucket, input, delegate);

	for (const transform of bucket.transforms) {
		const nextInput = await transform(input as Record<string, unknown>);
		if (nextInput) Object.assign(input, nextInput);
	}

	assignOperationArgs(kind, nextArgs, input);
	return nextArgs;
};

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

export const skipPluginsState = () =>
	({
		[SKIP_PLUGINS_STATE]: true,
	}) as PluginState;
