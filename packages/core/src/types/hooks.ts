import type { PaginationResult } from './database';
import type {
	BatchResult,
	BetterDrizzleModelDelegate,
	CreateArgs,
	CreateManyArgs,
	DeleteArgs,
	DeleteManyArgs,
	UpdateArgs,
	UpdateManyArgs,
} from './delegate';
import type { AnyPlugin, OperationArgsWithPlugins } from './plugins';
import type {
	BetterMeta,
	CountArgs,
	ExistsArgs,
	PaginationArgs,
	PayloadForArgs,
	QueryArgs,
} from './query';
import type { AnySchema, TableFor, TableKey } from './utils';

/** Action names for query operations. */
export type QueryHookAction =
	| 'findMany'
	| 'findFirst'
	| 'findOne'
	| 'findUnique'
	| 'count'
	| 'exists'
	| 'paginate';

/** Action names for create operations. */
export type CreateHookAction = 'create' | 'createMany' | 'upsert';
/** Action names for update operations. */
export type UpdateHookAction = 'update' | 'updateMany' | 'upsert';
/** Action names for delete operations. */
export type DeleteHookAction = 'delete' | 'deleteMany';
/** Union of all hook action names. */
export type HookAction =
	| QueryHookAction
	| CreateHookAction
	| UpdateHookAction
	| DeleteHookAction;

/** Stage within a hook lifecycle. */
export type HookStage = 'beforeHook' | 'afterHook' | 'operation';

type HookBaseContext<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Args,
	Action extends HookAction,
> = {
	action: Action;
	args: Args;
	db: unknown;
	meta: Meta | undefined;
	options: BetterClientOptions<Schema, Meta, Plugins>;
	repository: BetterDrizzleModelDelegate<Schema, Name, Meta, Plugins>;
	schema: Schema;
	table: Name;
	tableConfig: import('./delegate').BetterTableConfig<Schema, Name>;
	tableInstance: TableFor<Schema, Name>;
};

type CreateHookArgsForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends CreateHookAction,
> = Action extends 'createMany'
	? OperationArgsWithPlugins<
			CreateManyArgs<Schema, Name, Meta>,
			Plugins,
			'createMany'
		>
	: OperationArgsWithPlugins<CreateArgs<Schema, Name, Meta>, Plugins, Action>;

type CreateHookResultForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends CreateHookAction,
> = Action extends 'createMany'
	? BatchResult<
			PayloadForArgs<
				Schema,
				Name,
				CreateHookArgsForAction<Schema, Name, Meta, Plugins, Action>
			>
		>
	: PayloadForArgs<
			Schema,
			Name,
			CreateHookArgsForAction<Schema, Name, Meta, Plugins, Action>
		>;

type UpdateHookArgsForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends UpdateHookAction,
> = Action extends 'updateMany'
	? OperationArgsWithPlugins<
			UpdateManyArgs<Schema, Name, Meta>,
			Plugins,
			'updateMany'
		>
	: Action extends 'upsert'
		? OperationArgsWithPlugins<
				UpdateArgs<Schema, Name, Meta>,
				Plugins,
				'upsert'
			>
		: OperationArgsWithPlugins<
				UpdateArgs<Schema, Name, Meta>,
				Plugins,
				'update'
			>;

type UpdateHookResultForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends UpdateHookAction,
> = Action extends 'updateMany'
	? BatchResult<never>
	: PayloadForArgs<
			Schema,
			Name,
			UpdateHookArgsForAction<Schema, Name, Meta, Plugins, Action>
		> | null;

type DeleteHookArgsForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends DeleteHookAction,
> = Action extends 'deleteMany'
	? OperationArgsWithPlugins<
			DeleteManyArgs<Schema, Name, Meta>,
			Plugins,
			'deleteMany'
		>
	: OperationArgsWithPlugins<
			DeleteArgs<Schema, Name, Meta>,
			Plugins,
			'delete'
		>;

type DeleteHookResultForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends DeleteHookAction,
> = Action extends 'deleteMany'
	? BatchResult<never>
	: PayloadForArgs<
			Schema,
			Name,
			DeleteHookArgsForAction<Schema, Name, Meta, Plugins, Action>
		> | null;

type QueryHookArgsForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends QueryHookAction,
> = Action extends 'count'
	? OperationArgsWithPlugins<CountArgs<Schema, Name, Meta>, Plugins, 'count'>
	: Action extends 'exists'
		? OperationArgsWithPlugins<
				ExistsArgs<Schema, Name, Meta>,
				Plugins,
				'exists'
			>
		: Action extends 'paginate'
			? OperationArgsWithPlugins<
					PaginationArgs<Schema, Name, Meta>,
					Plugins,
					'paginate'
				>
			: OperationArgsWithPlugins<
					QueryArgs<Schema, Name, Meta>,
					Plugins,
					Action
				>;

type QueryHookResultForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends QueryHookAction,
> = Action extends 'findMany'
	? PayloadForArgs<
			Schema,
			Name,
			QueryHookArgsForAction<Schema, Name, Meta, Plugins, Action>
		>[]
	: Action extends 'findFirst' | 'findOne' | 'findUnique'
		? PayloadForArgs<
				Schema,
				Name,
				QueryHookArgsForAction<Schema, Name, Meta, Plugins, Action>
			> | null
		: Action extends 'count'
			? number
			: Action extends 'exists'
				? boolean
				: PaginationResult<
						PayloadForArgs<
							Schema,
							Name,
							QueryHookArgsForAction<
								Schema,
								Name,
								Meta,
								Plugins,
								Action
							>
						>
					>;

type CreateHookContext<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends CreateHookAction,
> = {
	[Name in TableKey<Schema>]: HookBaseContext<
		Schema,
		Name,
		Meta,
		Plugins,
		CreateHookArgsForAction<Schema, Name, Meta, Plugins, Action>,
		Action
	> & {
		result: CreateHookResultForAction<Schema, Name, Meta, Plugins, Action>;
		row?: Action extends 'createMany'
			? never
			: CreateHookResultForAction<Schema, Name, Meta, Plugins, Action>;
	};
}[TableKey<Schema>];

type UpdateHookContext<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends UpdateHookAction,
> = {
	[Name in TableKey<Schema>]: HookBaseContext<
		Schema,
		Name,
		Meta,
		Plugins,
		UpdateHookArgsForAction<Schema, Name, Meta, Plugins, Action>,
		Action
	> & {
		result: UpdateHookResultForAction<Schema, Name, Meta, Plugins, Action>;
		row?: Action extends 'updateMany'
			? never
			: UpdateHookResultForAction<Schema, Name, Meta, Plugins, Action>;
	};
}[TableKey<Schema>];

type DeleteHookContext<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends DeleteHookAction,
> = {
	[Name in TableKey<Schema>]: HookBaseContext<
		Schema,
		Name,
		Meta,
		Plugins,
		DeleteHookArgsForAction<Schema, Name, Meta, Plugins, Action>,
		Action
	> & {
		result: DeleteHookResultForAction<Schema, Name, Meta, Plugins, Action>;
		row?: Action extends 'deleteMany'
			? never
			: DeleteHookResultForAction<Schema, Name, Meta, Plugins, Action>;
	};
}[TableKey<Schema>];

type QueryHookContext<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends QueryHookAction,
> = {
	[Name in TableKey<Schema>]: HookBaseContext<
		Schema,
		Name,
		Meta,
		Plugins,
		QueryHookArgsForAction<Schema, Name, Meta, Plugins, Action>,
		Action
	> & {
		result: QueryHookResultForAction<Schema, Name, Meta, Plugins, Action>;
		row?: Action extends 'findFirst' | 'findOne' | 'findUnique'
			? QueryHookResultForAction<Schema, Name, Meta, Plugins, Action>
			: never;
		rows?: Action extends 'findMany'
			? QueryHookResultForAction<Schema, Name, Meta, Plugins, Action>
			: never;
	};
}[TableKey<Schema>];

/**
 * Context available in the `beforeCreate` and `beforeCreateMany` hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type BeforeCreateHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> =
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					CreateArgs<Schema, Name, Meta>,
					Plugins,
					'create'
				>,
				'create' | 'upsert'
			>;
	  }[TableKey<Schema>]
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					CreateManyArgs<Schema, Name, Meta>,
					Plugins,
					'createMany'
				>,
				'createMany'
			>;
	  }[TableKey<Schema>];

/**
 * Context available in the `afterCreate`, `afterCreateMany`, and
 * `afterCreate` (upsert) hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type AfterCreateHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> =
	| CreateHookContext<Schema, Meta, Plugins, 'create'>
	| CreateHookContext<Schema, Meta, Plugins, 'createMany'>
	| CreateHookContext<Schema, Meta, Plugins, 'upsert'>;

/**
 * Context available in the `beforeUpdate` and `beforeUpdateMany` hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type BeforeUpdateHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> =
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					UpdateArgs<Schema, Name, Meta>,
					Plugins,
					'update'
				>,
				'update' | 'upsert'
			>;
	  }[TableKey<Schema>]
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					UpdateManyArgs<Schema, Name, Meta>,
					Plugins,
					'updateMany'
				>,
				'updateMany'
			>;
	  }[TableKey<Schema>];

/**
 * Context available in the `afterUpdate`, `afterUpdateMany`, and
 * `afterUpdate` (upsert) hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type AfterUpdateHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> =
	| UpdateHookContext<Schema, Meta, Plugins, 'update'>
	| UpdateHookContext<Schema, Meta, Plugins, 'updateMany'>
	| UpdateHookContext<Schema, Meta, Plugins, 'upsert'>;

/**
 * Context available in the `beforeDelete` and `beforeDeleteMany` hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type BeforeDeleteHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> =
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					DeleteArgs<Schema, Name, Meta>,
					Plugins,
					'delete'
				>,
				'delete'
			>;
	  }[TableKey<Schema>]
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					DeleteManyArgs<Schema, Name, Meta>,
					Plugins,
					'deleteMany'
				>,
				'deleteMany'
			>;
	  }[TableKey<Schema>];

/**
 * Context available in the `afterDelete` and `afterDeleteMany` hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type AfterDeleteHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> =
	| DeleteHookContext<Schema, Meta, Plugins, 'delete'>
	| DeleteHookContext<Schema, Meta, Plugins, 'deleteMany'>;

/**
 * Context available in the `beforeQuery` hook (runs before any read operation).
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type BeforeQueryHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = {
	[Name in TableKey<Schema>]:
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					QueryArgs<Schema, Name, Meta>,
					Plugins,
					'findMany'
				>,
				'findMany'
		  >
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					QueryArgs<Schema, Name, Meta>,
					Plugins,
					'findFirst'
				>,
				'findFirst'
		  >
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					QueryArgs<Schema, Name, Meta>,
					Plugins,
					'findOne'
				>,
				'findOne'
		  >
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					QueryArgs<Schema, Name, Meta>,
					Plugins,
					'findUnique'
				>,
				'findUnique'
		  >
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					CountArgs<Schema, Name, Meta>,
					Plugins,
					'count'
				>,
				'count'
		  >
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					ExistsArgs<Schema, Name, Meta>,
					Plugins,
					'exists'
				>,
				'exists'
		  >
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					PaginationArgs<Schema, Name, Meta>,
					Plugins,
					'paginate'
				>,
				'paginate'
		  >;
}[TableKey<Schema>];

/**
 * Context available in the `afterQuery` hook (runs after any read operation).
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type AfterQueryHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> =
	| QueryHookContext<Schema, Meta, Plugins, 'findMany'>
	| QueryHookContext<Schema, Meta, Plugins, 'findFirst'>
	| QueryHookContext<Schema, Meta, Plugins, 'findOne'>
	| QueryHookContext<Schema, Meta, Plugins, 'findUnique'>
	| QueryHookContext<Schema, Meta, Plugins, 'count'>
	| QueryHookContext<Schema, Meta, Plugins, 'exists'>
	| QueryHookContext<Schema, Meta, Plugins, 'paginate'>;

/**
 * Context passed to the `onError` hook whenever an operation or another hook
 * throws.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type ErrorHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = {
	/** The operation that triggered the error. */
	action: HookAction;
	/** The original arguments passed to the operation. */
	args: unknown;
	/** The underlying Drizzle database instance. */
	db: unknown;
	/** The error that was thrown. */
	error: unknown;
	/** The hook that triggered the error, if applicable. */
	hookName?: keyof BetterClientHooks<Schema, Meta, Plugins>;
	/** Custom metadata from the operation arguments. */
	meta: Meta | undefined;
	/** The client configuration. */
	options: BetterClientOptions<Schema, Meta, Plugins>;
	/** The full Drizzle schema object. */
	schema: Schema;
	/** The lifecycle stage where the error occurred. */
	stage: HookStage;
	/** The table key the operation was performed on. */
	table: import('./delegate').BetterTableKey<Schema>;
	/** The relational configuration for the table. */
	tableConfig: import('./delegate').BetterRelationalConfig;
	/** The Drizzle table instance. */
	tableInstance: import('drizzle-orm').Table;
};

/**
 * Configuration object passed to {@link better}. Includes the Drizzle schema,
 * optional plugins, and lifecycle hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface BetterClientOptions<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> {
	/** The Drizzle schema object containing all table definitions. */
	schema: Schema;
	/** Optional plugins to extend the client. */
	plugins?: Plugins;
	/** Optional lifecycle hooks. */
	hooks?: BetterClientHooks<Schema, Meta, Plugins>;
}

/**
 * Lifecycle hooks that can be registered on the Better Drizzle client. Each
 * hook receives a rich context object with access to the schema, table
 * metadata, and the original operation arguments.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface BetterClientHooks<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> {
	/** Called before a single or batch create operation. */
	beforeCreate?(
		context: BeforeCreateHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called after a single or batch create operation completes. */
	afterCreate?(
		context: AfterCreateHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called before a single or batch update operation. */
	beforeUpdate?(
		context: BeforeUpdateHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called after a single or batch update operation completes. */
	afterUpdate?(
		context: AfterUpdateHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called before a single or batch delete operation. */
	beforeDelete?(
		context: BeforeDeleteHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called after a single or batch delete operation completes. */
	afterDelete?(
		context: AfterDeleteHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called before any read (query) operation. */
	beforeQuery?(
		context: BeforeQueryHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called after any read (query) operation completes. */
	afterQuery?(context: AfterQueryHookContext<Schema, Meta, Plugins>): unknown;
	/** Called when any operation or hook throws an error. */
	onError?(context: ErrorHookContext<Schema, Meta, Plugins>): unknown;
}
