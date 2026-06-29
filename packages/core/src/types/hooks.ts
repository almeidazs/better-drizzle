import type {
	CursorPaginationResult,
	OffsetPaginationResult,
} from './database';
import type {
	BatchResult,
	BetterDrizzleModelDelegate,
	CreateArgs,
	CreateManyArgs,
	DeleteArgs,
	DeleteManyArgs,
	UpdateArgs,
	UpdateEachArgs,
	UpdateManyArgs,
	UpsertManyArgs,
} from './delegate';
import type { AnyPlugin, OperationArgsWithPlugins } from './plugins';
import type {
	BetterMeta,
	CountArgs,
	CursorArgs,
	ExistsArgs,
	PaginationArgs,
	PayloadForArgs,
	QueryArgs,
} from './query';
import type { RawClientOptions, RawExecutionResult, RawOptions } from './raw';
import type {
	BetterDrizzleTransactionClient,
	TransactionOptions,
	TransactionUnsupportedOptionsBehavior,
} from './transaction';
import type { AnySchema, TableFor, TableKey } from './utils';

/** Action names for query (read) operations. */
export type QueryHookAction =
	| 'findMany'
	| 'findFirst'
	| 'findOne'
	| 'findUnique'
	| 'count'
	| 'exists'
	| 'paginate'
	| 'cursor';

/** Action names for create-oriented operations. */
export type CreateHookAction =
	| 'create'
	| 'createMany'
	| 'upsert'
	| 'upsertMany';
/** Action names for update-oriented operations. */
export type UpdateHookAction =
	| 'update'
	| 'updateEach'
	| 'updateMany'
	| 'upsert';
/** Action names for delete-oriented operations. */
export type DeleteHookAction = 'delete' | 'deleteMany';
/** Union of all CRUD and query hook action names. */
export type HookAction =
	| QueryHookAction
	| CreateHookAction
	| UpdateHookAction
	| DeleteHookAction;

/** Action names for raw SQL operations. */
export type RawHookAction = 'raw' | 'executeRaw' | 'rawUnsafe';

/** Lifecycle stage within a hook execution. */
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
	afterCommit(callback: () => unknown | Promise<unknown>): void;
	afterRollback(callback: () => unknown | Promise<unknown>): void;
	args: Args;
	db: unknown;
	isInTransaction: boolean;
	meta: Meta | undefined;
	options: BetterClientOptions<Schema, Meta, Plugins>;
	repository: BetterDrizzleModelDelegate<Schema, Name, Meta, Plugins>;
	schema: Schema;
	table: Name;
	tableConfig: import('./delegate').BetterTableConfig<Schema, Name>;
	tableInstance: TableFor<Schema, Name>;
	transaction: BetterDrizzleTransactionClient<Schema, Meta, Plugins> | null;
	transactionContext: Record<string, unknown> | undefined;
};

type TransactionHookBaseContext<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
> = {
	afterCommit(callback: () => unknown | Promise<unknown>): void;
	afterRollback(callback: () => unknown | Promise<unknown>): void;
	attempt: number;
	client: BetterDrizzleTransactionClient<Schema, Meta, Plugins>;
	comment?: string;
	db: unknown;
	depth: number;
	isInTransaction: true;
	meta: Meta | undefined;
	name?: string;
	options: BetterClientOptions<Schema, Meta, Plugins>;
	schema: Schema;
	transactionContext: Record<string, unknown> | undefined;
	transactionOptions: TransactionOptions & { meta?: Meta };
};

type RawHookBaseContext<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends RawHookAction,
	Result,
> = {
	action: Action;
	afterCommit(callback: () => unknown | Promise<unknown>): void;
	afterRollback(callback: () => unknown | Promise<unknown>): void;
	comment?: string;
	db: unknown;
	error?: unknown;
	isInTransaction: boolean;
	map?: RawOptions<unknown, unknown, Meta>['map'];
	meta: Meta | undefined;
	name?: string;
	options: BetterClientOptions<Schema, Meta, Plugins>;
	query: string;
	rawOptions: RawOptions<unknown, unknown, Meta>;
	result: Result;
	schema: Schema;
	signal?: AbortSignal;
	sql?: unknown;
	timeoutMs?: number;
	transaction: BetterDrizzleTransactionClient<Schema, Meta, Plugins> | null;
	transactionContext: Record<string, unknown> | undefined;
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
	: Action extends 'upsertMany'
		? OperationArgsWithPlugins<
				UpsertManyArgs<Schema, Name, Meta>,
				Plugins,
				'upsertMany'
			>
		: OperationArgsWithPlugins<
				CreateArgs<Schema, Name, Meta>,
				Plugins,
				Action
			>;

type CreateHookResultForAction<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
	Action extends CreateHookAction,
> = Action extends 'createMany' | 'upsertMany'
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
	: Action extends 'updateEach'
		? OperationArgsWithPlugins<
				UpdateEachArgs<Schema, Name, Meta>,
				Plugins,
				'updateEach'
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
	: Action extends 'updateEach'
		? BatchResult<
				PayloadForArgs<
					Schema,
					Name,
					UpdateHookArgsForAction<Schema, Name, Meta, Plugins, Action>
				>
			>
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
		: Action extends 'cursor'
			? OperationArgsWithPlugins<
					CursorArgs<Schema, Name, Meta>,
					Plugins,
					'cursor'
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
				: Action extends 'cursor'
					? CursorPaginationResult<
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
						>
					: OffsetPaginationResult<
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
		row?: Action extends 'createMany' | 'upsertMany'
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
		row?: Action extends 'updateEach' | 'updateMany'
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
 * Context available in create-oriented hooks.
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
	  }[TableKey<Schema>]
	| {
			[Name in TableKey<Schema>]: HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					UpsertManyArgs<Schema, Name, Meta>,
					Plugins,
					'upsertMany'
				>,
				'upsertMany'
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
	| CreateHookContext<Schema, Meta, Plugins, 'upsert'>
	| CreateHookContext<Schema, Meta, Plugins, 'upsertMany'>;

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
					UpdateEachArgs<Schema, Name, Meta>,
					Plugins,
					'updateEach'
				>,
				'updateEach'
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
	| UpdateHookContext<Schema, Meta, Plugins, 'updateEach'>
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
		  >
		| HookBaseContext<
				Schema,
				Name,
				Meta,
				Plugins,
				OperationArgsWithPlugins<
					CursorArgs<Schema, Name, Meta>,
					Plugins,
					'cursor'
				>,
				'cursor'
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
	| QueryHookContext<Schema, Meta, Plugins, 'cursor'>
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
 * Context available in the `beforeTransaction` hook, fired before the
 * transaction callback executes.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam Plugins - The plugin tuple.
 */
export type BeforeTransactionHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = TransactionHookBaseContext<Schema, Meta, Plugins>;

/**
 * Context available in the `afterTransactionCommit` hook, fired after a
 * transaction commits successfully.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam Plugins - The plugin tuple.
 */
export type AfterTransactionCommitHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = TransactionHookBaseContext<Schema, Meta, Plugins>;

/**
 * Context available in the `afterTransactionRollback` hook, fired after a
 * transaction rolls back. Includes the optional rollback reason.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam Plugins - The plugin tuple.
 */
export type AfterTransactionRollbackHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = TransactionHookBaseContext<Schema, Meta, Plugins> & {
	/** The reason the transaction was rolled back, if any. */
	reason?: unknown;
};

/**
 * Context available in the `onTransactionError` hook, fired when a
 * transaction callback throws an error. Includes the caught error.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam Plugins - The plugin tuple.
 */
export type TransactionErrorHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = TransactionHookBaseContext<Schema, Meta, Plugins> & {
	/** The error thrown by the transaction callback. */
	error: unknown;
};

/**
 * Context available in the `beforeRaw` hook.
 */
export type BeforeRawHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = RawHookBaseContext<Schema, Meta, Plugins, RawHookAction, unknown>;

/**
 * Context available in the `afterRaw` hook.
 */
export type AfterRawHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> =
	| RawHookBaseContext<Schema, Meta, Plugins, 'raw' | 'rawUnsafe', unknown[]>
	| RawHookBaseContext<
			Schema,
			Meta,
			Plugins,
			'executeRaw',
			RawExecutionResult
	  >;

/**
 * Context available in the `onRawError` hook.
 */
export type RawErrorHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = RawHookBaseContext<Schema, Meta, Plugins, RawHookAction, unknown> & {
	error: unknown;
};

/**
 * Configuration object passed to {@link better}. Includes the Drizzle schema,
 * optional plugins, and lifecycle hooks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 *
 * @example
 * ```ts
 * import { better } from 'better-drizzle';
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 * import * as schema from './schema';
 *
 * const raw = drizzle('file:local.db');
 *
 * const db = better(raw, {
 *   schema,
 *   plugins: [myPlugin],
 *   hooks: {
 *     beforeCreate(ctx) {
 *       console.log('Creating on table:', ctx.table);
 *     },
 *     afterQuery(ctx) {
 *       console.log('Query result:', ctx.result);
 *     },
 *   },
 *   raw: {
 *     enabled: true,
 *     allowUnsafe: false,
 *   },
 *   transaction: {
 *     unsupportedOptions: 'warn',
 *   },
 * });
 * ```
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
	/** Optional transaction configuration. */
	transaction?: {
		/** How to handle dialect-unsupported transaction options. */
		unsupportedOptions?: TransactionUnsupportedOptionsBehavior;
	};
	/** Optional row lock configuration. */
	locks?: import('./query').BetterLockClientOptions;
	/** Optional raw SQL configuration. */
	raw?: RawClientOptions;
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
 * @typeParam Plugins - The plugin tuple.
 *
 * @example
 * ```ts
 * const db = better(drizzle, {
 *   schema,
 *   hooks: {
 *     beforeCreate(ctx) {
 *       console.log('Creating on:', ctx.table, ctx.args.data);
 *     },
 *     afterCreate(ctx) {
 *       console.log('Created:', ctx.result);
 *     },
 *     beforeQuery(ctx) {
 *       console.log('Querying:', ctx.table, ctx.action);
 *     },
 *     afterQuery(ctx) {
 *       console.log('Query result:', ctx.result);
 *     },
 *     onError(ctx) {
 *       console.error('Error in', ctx.action, ':', ctx.error);
 *     },
 *   },
 * });
 * ```
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
	/** Called before a transaction callback runs. */
	beforeTransaction?(
		context: BeforeTransactionHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called before any raw SQL query executes. */
	beforeRaw?(context: BeforeRawHookContext<Schema, Meta, Plugins>): unknown;
	/** Called after a transaction commits successfully. */
	afterTransactionCommit?(
		context: AfterTransactionCommitHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called after any raw SQL query completes. */
	afterRaw?(context: AfterRawHookContext<Schema, Meta, Plugins>): unknown;
	/** Called after a transaction rolls back. */
	afterTransactionRollback?(
		context: AfterTransactionRollbackHookContext<Schema, Meta, Plugins>,
	): unknown;
	/** Called when any operation or hook throws an error. */
	onError?(context: ErrorHookContext<Schema, Meta, Plugins>): unknown;
	/** Called when a raw SQL query fails. */
	onRawError?(context: RawErrorHookContext<Schema, Meta, Plugins>): unknown;
	/** Called when a transaction callback fails. */
	onTransactionError?(
		context: TransactionErrorHookContext<Schema, Meta, Plugins>,
	): unknown;
}
