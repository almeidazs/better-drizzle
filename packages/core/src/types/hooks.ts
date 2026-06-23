import type { PaginationResult } from './database';
import type {
	BatchResult,
	CreateArgs,
	CreateManyArgs,
	DeleteArgs,
	DeleteManyArgs,
	UpdateArgs,
	UpdateManyArgs,
} from './delegate';
import type { Plugin } from './plugins';
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
	Args,
	Action extends HookAction,
> = {
	action: Action;
	args: Args;
	db: unknown;
	meta: Meta | undefined;
	options: BetterClientOptions<Schema, Meta>;
	repository: import('./delegate').BetterDrizzleModelDelegate<
		Schema,
		Name,
		Meta
	>;
	schema: Schema;
	table: Name;
	tableConfig: import('./delegate').BetterTableConfig<Schema, Name>;
	tableInstance: TableFor<Schema, Name>;
};

type CreateHookArgsForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Action extends CreateHookAction,
> = Action extends 'createMany'
	? CreateManyArgs<Schema, Name, Meta>
	: CreateArgs<Schema, Name, Meta>;

type CreateHookResultForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Action extends CreateHookAction,
> = Action extends 'createMany'
	? BatchResult<
			PayloadForArgs<Schema, Name, CreateManyArgs<Schema, Name, Meta>>
		>
	: PayloadForArgs<Schema, Name, CreateArgs<Schema, Name, Meta>>;

type UpdateHookArgsForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Action extends UpdateHookAction,
> = Action extends 'updateMany'
	? UpdateManyArgs<Schema, Name, Meta>
	: UpdateArgs<Schema, Name, Meta>;

type UpdateHookResultForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Action extends UpdateHookAction,
> = Action extends 'updateMany'
	? BatchResult<never>
	: PayloadForArgs<Schema, Name, UpdateArgs<Schema, Name, Meta>> | null;

type DeleteHookArgsForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Action extends DeleteHookAction,
> = Action extends 'deleteMany'
	? DeleteManyArgs<Schema, Name, Meta>
	: DeleteArgs<Schema, Name, Meta>;

type DeleteHookResultForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Action extends DeleteHookAction,
> = Action extends 'deleteMany'
	? BatchResult<never>
	: PayloadForArgs<Schema, Name, DeleteArgs<Schema, Name, Meta>> | null;

type QueryHookArgsForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Action extends QueryHookAction,
> = Action extends 'count'
	? CountArgs<Schema, Name, Meta>
	: Action extends 'exists'
		? ExistsArgs<Schema, Name, Meta>
		: Action extends 'paginate'
			? PaginationArgs<Schema, Name, Meta>
			: QueryArgs<Schema, Name, Meta>;

type QueryHookResultForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Action extends QueryHookAction,
> = Action extends 'findMany'
	? PayloadForArgs<Schema, Name, QueryArgs<Schema, Name, Meta>>[]
	: Action extends 'findFirst' | 'findOne' | 'findUnique'
		? PayloadForArgs<Schema, Name, QueryArgs<Schema, Name, Meta>> | null
		: Action extends 'count'
			? number
			: Action extends 'exists'
				? boolean
				: PaginationResult<
						PayloadForArgs<
							Schema,
							Name,
							PaginationArgs<Schema, Name, Meta>
						>
					>;

type CreateHookContext<
	Schema extends AnySchema,
	Meta,
	Action extends CreateHookAction,
> = {
	[Name in TableKey<Schema>]: HookBaseContext<
		Schema,
		Name,
		Meta,
		CreateHookArgsForAction<Schema, Name, Meta, Action>,
		Action
	> & {
		result: CreateHookResultForAction<Schema, Name, Meta, Action>;
		row?: Action extends 'createMany'
			? never
			: CreateHookResultForAction<Schema, Name, Meta, Action>;
	};
}[TableKey<Schema>];

type UpdateHookContext<
	Schema extends AnySchema,
	Meta,
	Action extends UpdateHookAction,
> = {
	[Name in TableKey<Schema>]: HookBaseContext<
		Schema,
		Name,
		Meta,
		UpdateHookArgsForAction<Schema, Name, Meta, Action>,
		Action
	> & {
		result: UpdateHookResultForAction<Schema, Name, Meta, Action>;
		row?: Action extends 'updateMany'
			? never
			: UpdateHookResultForAction<Schema, Name, Meta, Action>;
	};
}[TableKey<Schema>];

type DeleteHookContext<
	Schema extends AnySchema,
	Meta,
	Action extends DeleteHookAction,
> = {
	[Name in TableKey<Schema>]: HookBaseContext<
		Schema,
		Name,
		Meta,
		DeleteHookArgsForAction<Schema, Name, Meta, Action>,
		Action
	> & {
		result: DeleteHookResultForAction<Schema, Name, Meta, Action>;
		row?: Action extends 'deleteMany'
			? never
			: DeleteHookResultForAction<Schema, Name, Meta, Action>;
	};
}[TableKey<Schema>];

type QueryHookContext<
	Schema extends AnySchema,
	Meta,
	Action extends QueryHookAction,
> = {
	[Name in TableKey<Schema>]: HookBaseContext<
		Schema,
		Name,
		Meta,
		QueryHookArgsForAction<Schema, Name, Meta, Action>,
		Action
	> & {
		result: QueryHookResultForAction<Schema, Name, Meta, Action>;
		row?: Action extends 'findFirst' | 'findOne' | 'findUnique'
			? QueryHookResultForAction<Schema, Name, Meta, Action>
			: never;
		rows?: Action extends 'findMany'
			? QueryHookResultForAction<Schema, Name, Meta, Action>
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
> =
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				CreateArgs<Schema, Name, Meta>,
				'create' | 'upsert'
			>;
	  }[TableKey<Schema>]
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				CreateManyArgs<Schema, Name, Meta>,
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
> =
	| CreateHookContext<Schema, Meta, 'create'>
	| CreateHookContext<Schema, Meta, 'createMany'>
	| CreateHookContext<Schema, Meta, 'upsert'>;

/**
 * Context available in the `beforeUpdate` and `beforeUpdateMany` hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type BeforeUpdateHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> =
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				UpdateArgs<Schema, Name, Meta>,
				'update' | 'upsert'
			>;
	  }[TableKey<Schema>]
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				UpdateManyArgs<Schema, Name, Meta>,
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
> =
	| UpdateHookContext<Schema, Meta, 'update'>
	| UpdateHookContext<Schema, Meta, 'updateMany'>
	| UpdateHookContext<Schema, Meta, 'upsert'>;

/**
 * Context available in the `beforeDelete` and `beforeDeleteMany` hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type BeforeDeleteHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> =
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				DeleteArgs<Schema, Name, Meta>,
				'delete'
			>;
	  }[TableKey<Schema>]
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				DeleteManyArgs<Schema, Name, Meta>,
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
> =
	| DeleteHookContext<Schema, Meta, 'delete'>
	| DeleteHookContext<Schema, Meta, 'deleteMany'>;

/**
 * Context available in the `beforeQuery` hook (runs before any read operation).
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type BeforeQueryHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> = {
	[Name in TableKey<Schema>]:
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				QueryArgs<Schema, Name, Meta>,
				'findMany' | 'findFirst' | 'findOne' | 'findUnique'
		  >
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				CountArgs<Schema, Name, Meta>,
				'count' | 'exists'
		  >
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				PaginationArgs<Schema, Name, Meta>,
				'paginate'
		  >;
}[TableKey<Schema>];

/**
 * Context available in the `afterQuery` hook (runs after any read operation).
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type AfterQueryHookContext<Schema extends AnySchema, Meta = BetterMeta> =
	| QueryHookContext<Schema, Meta, 'findMany'>
	| QueryHookContext<Schema, Meta, 'findFirst'>
	| QueryHookContext<Schema, Meta, 'findOne'>
	| QueryHookContext<Schema, Meta, 'findUnique'>
	| QueryHookContext<Schema, Meta, 'count'>
	| QueryHookContext<Schema, Meta, 'exists'>
	| QueryHookContext<Schema, Meta, 'paginate'>;

/**
 * Context passed to the `onError` hook whenever an operation or another hook
 * throws.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type ErrorHookContext<Schema extends AnySchema, Meta = BetterMeta> = {
	/** The operation that triggered the error. */
	action: HookAction;
	/** The original arguments passed to the operation. */
	args: unknown;
	/** The underlying Drizzle database instance. */
	db: unknown;
	/** The error that was thrown. */
	error: unknown;
	/** The hook that triggered the error, if applicable. */
	hookName?: keyof BetterClientHooks<Schema, Meta>;
	/** Custom metadata from the operation arguments. */
	meta: Meta | undefined;
	/** The client configuration. */
	options: BetterClientOptions<Schema, Meta>;
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
	Plugins extends readonly Plugin[] = readonly Plugin[],
> {
	/** The Drizzle schema object containing all table definitions. */
	schema: Schema;
	/** Optional plugins to extend the client. */
	plugins?: Plugins;
	/** Optional lifecycle hooks. */
	hooks?: BetterClientHooks<Schema, Meta>;
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
> {
	/** Called before a single or batch create operation. */
	beforeCreate?(context: BeforeCreateHookContext<Schema, Meta>): unknown;
	/** Called after a single or batch create operation completes. */
	afterCreate?(context: AfterCreateHookContext<Schema, Meta>): unknown;
	/** Called before a single or batch update operation. */
	beforeUpdate?(context: BeforeUpdateHookContext<Schema, Meta>): unknown;
	/** Called after a single or batch update operation completes. */
	afterUpdate?(context: AfterUpdateHookContext<Schema, Meta>): unknown;
	/** Called before a single or batch delete operation. */
	beforeDelete?(context: BeforeDeleteHookContext<Schema, Meta>): unknown;
	/** Called after a single or batch delete operation completes. */
	afterDelete?(context: AfterDeleteHookContext<Schema, Meta>): unknown;
	/** Called before any read (query) operation. */
	beforeQuery?(context: BeforeQueryHookContext<Schema, Meta>): unknown;
	/** Called after any read (query) operation completes. */
	afterQuery?(context: AfterQueryHookContext<Schema, Meta>): unknown;
	/** Called when any operation or hook throws an error. */
	onError?(context: ErrorHookContext<Schema, Meta>): unknown;
}
