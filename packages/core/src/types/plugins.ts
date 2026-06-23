import type { AnyColumn } from 'drizzle-orm';

import type {
	AnySchema,
	BetterClientOptions,
	BetterMeta,
	BetterTableKey,
	InsertModelFor,
	TableKey,
} from '.';
import type {
	BatchResult,
	BetterDrizzleClient,
	BetterDrizzleModelDelegate,
	CreateArgs,
	CreateManyArgs,
	DeleteArgs,
	DeleteManyArgs,
	UpdateArgs,
	UpdateManyArgs,
	UpsertArgs,
} from './delegate';
import type { CountArgs, ExistsArgs, PaginationArgs, QueryArgs } from './query';
import type {
	BetterDrizzleTransactionClient,
	TransactionOptions,
} from './transaction';

/**
 * Supported SQL dialects that plugins can target.
 * - `'pg'` — PostgreSQL
 * - `'mysql'` — MySQL / MariaDB
 * - `'sqlite'` — SQLite
 */
export type PluginDialect = 'pg' | 'mysql' | 'sqlite';

/**
 * Arbitrary key-value state carried by a plugin instance and forwarded to
 * every hook and transform invocation. Plugins use this to share data
 * across operations within a single request lifecycle.
 */
export type PluginState = Record<string, unknown>;

/**
 * Shape of the object returned by a plugin's `extendClient` or
 * `extendModel` methods. Each key becomes a property on the delegate
 * or client instance.
 */
export type PluginExtension = Record<string, unknown>;

/**
 * Describes a column that a plugin requires on a model. Used in
 * {@link PluginConfig.requires.columns} to fail fast during bootstrap
 * when a model is missing a required column.
 */
export type PluginColumnRequirement = {
	/** The column name that must exist. */
	column: string;
	/** When `true`, the plugin can operate without this column. */
	optional?: boolean;
	/** Expected Drizzle column type name (for informational purposes). */
	type?: string;
};

/**
 * Static configuration for a plugin. Controls which dialects the plugin
 * supports and which model requirements must be satisfied.
 */
export type PluginConfig = {
	/** Restrict the plugin to specific SQL dialects. When omitted the plugin runs on all dialects. */
	dialects?: PluginDialect[];
	/** Model-level requirements that must be met before the plugin can initialise. */
	requires?: {
		/** Columns that must be present on every model the plugin operates on. */
		columns?: PluginColumnRequirement[];
	};
};

/**
 * Descriptive metadata for a plugin. Returned by {@link definePlugin} and
 * forwarded to setup contexts and extension callbacks.
 *
 * @typeParam Options - The options shape accepted by the plugin.
 */
export type PluginMeta<Options = unknown> = {
	/** Human-readable description of what the plugin does. */
	description?: string;
	/** Unique identifier for the plugin (e.g. `"soft-delete"`). */
	id: string;
	/** Human-readable display name. */
	name?: string;
	/** Plugin-specific options stored for later reference. */
	options?: Options;
	/** Semver version string. */
	version?: string;
};

/**
 * Per-model information exposed to plugins during setup, hooks, and
 * extension callbacks.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name  - The table key within the schema.
 */
export type PluginModelInfo<
	Schema extends AnySchema = AnySchema,
	Name extends string = Extract<TableKey<Schema>, string>,
> = {
	/** Map of column name to Drizzle column instance. */
	columns: Record<string, AnyColumn>;
	/** The database table name. */
	dbName: string;
	/** Checks whether a column with the given name exists on this model. */
	hasColumn(column: string): boolean;
	/** The TypeScript table key. */
	name: Name;
};

/**
 * Registry mapping TypeScript table keys to their {@link PluginModelInfo}
 * descriptors. Provided to plugins during setup and extension callbacks.
 *
 * @typeParam Schema - The Drizzle schema type.
 */
export type ModelRegistry<Schema extends AnySchema = AnySchema> = Record<
	string,
	PluginModelInfo<Schema, string>
>;

/**
 * Discriminated union of all operation kinds that plugin hooks can
 * intercept. Each kind maps to its corresponding argument and result
 * types in {@link PluginOperationInput}.
 */
export type PluginHookKind =
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
	| 'paginate'
	| 'update'
	| 'updateMany'
	| 'upsert';

/**
 * Maps each {@link PluginHookKind} to a record of extra operation-argument
 * keys that a plugin can declare. Plugins use this to type-safely extend
 * delegate method signatures with additional fields (e.g. a `traced`
 * flag on every operation).
 */
export type PluginOperationArgsExtensionMap = {
	[K in PluginHookKind]: Record<string, unknown>;
};

type OperationArgsForKind<OperationArgs, Kind extends PluginHookKind> =
	OperationArgs extends Partial<PluginOperationArgsExtensionMap>
		? Kind extends keyof OperationArgs
			? OperationArgs[Kind] extends Record<string, unknown>
				? OperationArgs[Kind]
				: Record<never, never>
			: Record<never, never>
		: Record<never, never>;

type PluginOperationArgsMap<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap>,
> = {
	count: CountArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'count'>;
	create: CreateArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'create'>;
	createMany: CreateManyArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'createMany'>;
	delete: DeleteArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'delete'>;
	deleteMany: DeleteManyArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'deleteMany'>;
	exists: ExistsArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'exists'>;
	findFirst: QueryArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'findFirst'>;
	findMany: QueryArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'findMany'>;
	findOne: QueryArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'findOne'>;
	findUnique: QueryArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'findUnique'>;
	paginate: PaginationArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'paginate'>;
	update: UpdateArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'update'>;
	updateMany: UpdateManyArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'updateMany'>;
	upsert: UpsertArgs<Schema, Name, Meta> &
		OperationArgsForKind<OperationArgs, 'upsert'>;
};

type PluginOperationResultMap<
	Schema extends AnySchema,
	_Name extends TableKey<Schema>,
	_Meta,
> = {
	count: number;
	create: unknown;
	createMany: BatchResult<unknown>;
	delete: unknown;
	deleteMany: BatchResult<never>;
	exists: boolean;
	findFirst: unknown;
	findMany: unknown[];
	findOne: unknown;
	findUnique: unknown;
	paginate: unknown;
	update: unknown;
	updateMany: BatchResult<never>;
	upsert: unknown;
};

/**
 * Fully-typed input passed to plugin hooks and transforms for every
 * operation. The shape is narrowed by the `Kind` type parameter so that
 * `args`, `data`, `select`, `include`, `where`, etc. reflect the
 * concrete operation being performed.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name   - The table key within the schema.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam State  - Plugin state type. Defaults to {@link PluginState}.
 * @typeParam Kind   - The operation kind discriminant.
 */
type PluginOperationInputBase<
	Schema extends AnySchema = AnySchema,
	Name extends TableKey<Schema> = TableKey<Schema>,
	Meta = BetterMeta,
	State extends PluginState = PluginState,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap> = Record<
		never,
		never
	>,
	Kind extends PluginHookKind = PluginHookKind,
> = {
	afterCommit(callback: () => unknown | Promise<unknown>): void;
	afterRollback(callback: () => unknown | Promise<unknown>): void;
	args: PluginOperationArgsMap<Schema, Name, Meta, OperationArgs>[Kind];
	data?: Kind extends 'create'
		? InsertModelFor<Schema, Name>
		: Kind extends 'createMany'
			? InsertModelFor<Schema, Name>[]
			: Kind extends 'update' | 'updateMany'
				? Partial<InsertModelFor<Schema, Name>>
				: Kind extends 'upsert'
					? {
							create: InsertModelFor<Schema, Name>;
							update: Partial<InsertModelFor<Schema, Name>>;
						}
					: never;
	db: unknown;
	dialect: PluginDialect;
	isInTransaction: boolean;
	include?: PluginOperationArgsMap<
		Schema,
		Name,
		Meta,
		OperationArgs
	>[Kind] extends {
		include?: infer Include;
	}
		? Include
		: never;
	kind: Kind;
	meta: Meta | undefined;
	model: PluginModelInfo<Schema, Name>;
	options: BetterClientOptions<Schema, Meta, readonly AnyPlugin[]>;
	orderBy?: PluginOperationArgsMap<
		Schema,
		Name,
		Meta,
		OperationArgs
	>[Kind] extends {
		orderBy?: infer OrderBy;
	}
		? OrderBy
		: never;
	cursor?: PluginOperationArgsMap<
		Schema,
		Name,
		Meta,
		OperationArgs
	>[Kind] extends {
		cursor?: infer Cursor;
	}
		? Cursor
		: never;
	schema: Schema;
	select?: PluginOperationArgsMap<
		Schema,
		Name,
		Meta,
		OperationArgs
	>[Kind] extends {
		select?: infer Select;
	}
		? Select
		: never;
	skip?: PluginOperationArgsMap<
		Schema,
		Name,
		Meta,
		OperationArgs
	>[Kind] extends {
		skip?: infer Skip;
	}
		? Skip
		: never;
	state: State;
	table: Name;
	transaction: BetterDrizzleTransactionClient<
		Schema,
		Meta,
		readonly AnyPlugin[]
	> | null;
	transactionContext: Record<string, unknown> | undefined;
	take?: PluginOperationArgsMap<
		Schema,
		Name,
		Meta,
		OperationArgs
	>[Kind] extends {
		take?: infer Take;
	}
		? Take
		: never;
	where?: PluginOperationArgsMap<
		Schema,
		Name,
		Meta,
		OperationArgs
	>[Kind] extends {
		where?: infer Where;
	}
		? Where
		: never;
};

export type PluginOperationInput<
	Schema extends AnySchema = AnySchema,
	Name extends TableKey<Schema> = TableKey<Schema>,
	Meta = BetterMeta,
	State extends PluginState = PluginState,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap> = Record<
		never,
		never
	>,
	Kind extends PluginHookKind = PluginHookKind,
> = Kind extends PluginHookKind
	? PluginOperationInputBase<Schema, Name, Meta, State, OperationArgs, Kind>
	: never;

type PluginBeforeHookContext<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	State extends PluginState,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap>,
	Kind extends PluginHookKind,
> = PluginOperationInput<Schema, Name, Meta, State, OperationArgs, Kind> & {
	client: BetterDrizzleModelDelegate<Schema, Name, Meta>;
};

type PluginAfterHookContext<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	State extends PluginState,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap>,
	Kind extends PluginHookKind,
> = PluginBeforeHookContext<Schema, Name, Meta, State, OperationArgs, Kind> & {
	result: PluginOperationResultMap<Schema, Name, Meta>[Kind];
};

export type PluginTransactionHookContext<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = {
	afterCommit(callback: () => unknown | Promise<unknown>): void;
	afterRollback(callback: () => unknown | Promise<unknown>): void;
	attempt: number;
	client: BetterDrizzleTransactionClient<Schema, Meta, Plugins>;
	comment?: string;
	db: unknown;
	dialect: PluginDialect;
	depth: number;
	isInTransaction: true;
	models: ModelRegistry<Schema>;
	name?: string;
	options: BetterClientOptions<Schema, Meta, Plugins>;
	schema: Schema;
	transactionContext: Record<string, unknown> | undefined;
	transactionOptions: TransactionOptions;
};

export type PluginTransactionErrorHookContext<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = PluginTransactionHookContext<Schema, Meta, Plugins> & {
	error: unknown;
};

export type PluginTransactionRollbackHookContext<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = PluginTransactionHookContext<Schema, Meta, Plugins> & {
	reason?: unknown;
};

/**
 * Lifecycle hooks that a plugin can register. Each hook receives a rich
 * context object containing the operation arguments, model info, plugin
 * state, and (for after-hooks) the operation result.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam State  - Plugin state type. Defaults to {@link PluginState}.
 */
export type PluginHooks<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	State extends PluginState = PluginState,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap> = Record<
		never,
		never
	>,
> = {
	afterCreate?(
		context: PluginAfterHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			OperationArgs,
			'create' | 'createMany' | 'upsert'
		>,
	): unknown;
	afterDelete?(
		context: PluginAfterHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			OperationArgs,
			'delete' | 'deleteMany'
		>,
	): unknown;
	afterQuery?(
		context: PluginAfterHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			OperationArgs,
			| 'count'
			| 'exists'
			| 'findFirst'
			| 'findMany'
			| 'findOne'
			| 'findUnique'
			| 'paginate'
		>,
	): unknown;
	afterTransactionCommit?(
		context: PluginTransactionHookContext<
			Schema,
			Meta,
			readonly AnyPlugin[]
		>,
	): unknown;
	afterTransactionRollback?(
		context: PluginTransactionRollbackHookContext<
			Schema,
			Meta,
			readonly AnyPlugin[]
		>,
	): unknown;
	afterUpdate?(
		context: PluginAfterHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			OperationArgs,
			'update' | 'updateMany'
		>,
	): unknown;
	beforeCreate?(
		context: PluginBeforeHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			OperationArgs,
			'create' | 'createMany' | 'upsert'
		>,
	):
		| PluginBeforeHookContext<
				Schema,
				BetterTableKey<Schema>,
				Meta,
				State,
				OperationArgs,
				'create' | 'createMany' | 'upsert'
		  >['data']
		| undefined;
	beforeDelete?(
		context: PluginBeforeHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			OperationArgs,
			'delete' | 'deleteMany'
		>,
	):
		| PluginOperationResultMap<Schema, BetterTableKey<Schema>, Meta>[
				| 'delete'
				| 'deleteMany']
		| undefined;
	beforeQuery?(
		context: PluginBeforeHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			OperationArgs,
			| 'count'
			| 'exists'
			| 'findFirst'
			| 'findMany'
			| 'findOne'
			| 'findUnique'
			| 'paginate'
		>,
	):
		| PluginOperationResultMap<Schema, BetterTableKey<Schema>, Meta>[
				| 'count'
				| 'exists'
				| 'findFirst'
				| 'findMany'
				| 'findOne'
				| 'findUnique'
				| 'paginate']
		| undefined;
	beforeTransaction?(
		context: PluginTransactionHookContext<
			Schema,
			Meta,
			readonly AnyPlugin[]
		>,
	): unknown;
	beforeUpdate?(
		context: PluginBeforeHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			OperationArgs,
			'update' | 'updateMany'
		>,
	):
		| PluginBeforeHookContext<
				Schema,
				BetterTableKey<Schema>,
				Meta,
				State,
				OperationArgs,
				'update' | 'updateMany'
		  >['data']
		| undefined;
	onTransactionError?(
		context: PluginTransactionErrorHookContext<
			Schema,
			Meta,
			readonly AnyPlugin[]
		>,
	): unknown;
};

/**
 * Transform function that can modify an operation's input before it
 * reaches the database. Return `undefined` to skip the operation
 * entirely, or return a (possibly modified) {@link PluginOperationInput}.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam State  - Plugin state type. Defaults to {@link PluginState}.
 */
export type PluginTransform<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	State extends PluginState = PluginState,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap> = Record<
		never,
		never
	>,
> = (
	operation: PluginOperationInput<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		State,
		OperationArgs,
		PluginHookKind
	>,
) =>
	| PluginOperationInput<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			OperationArgs,
			PluginHookKind
	  >
	| undefined;

/**
 * Context object passed to a plugin's `setup()` method during client
 * initialization. Provides helpers to register hooks and transforms, and
 * read-only access to the schema, dialect, and model registry.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam State  - Plugin state type. Defaults to {@link PluginState}.
 */
export type PluginSetupContext<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	State extends PluginState = PluginState,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap> = Record<
		never,
		never
	>,
> = {
	addHook(hook: PluginHooks<Schema, Meta, State, OperationArgs>): void;
	addTransform(
		transform: PluginTransform<Schema, Meta, State, OperationArgs>,
	): void;
	dialect: PluginDialect;
	isColumnExists(model: string, column: string): boolean;
	models: ModelRegistry<Schema>;
	plugin: PluginMeta;
	schema: Schema;
};

/**
 * Context passed to a plugin's `extendModel()` callback. Provides access
 * to the delegate, database instance, dialect, model info, and schema.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type PluginModelExtensionContext<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
> = {
	client: BetterDrizzleModelDelegate<Schema, BetterTableKey<Schema>, Meta>;
	db: unknown;
	dialect: PluginDialect;
	model: PluginModelInfo<Schema, BetterTableKey<Schema>>;
	plugin: PluginMeta;
	schema: Schema;
};

/**
 * Context passed to a plugin's `extendClient()` callback. Provides access
 * to the full client, database instance, dialect, model registry, and schema.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam Meta    - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam Plugins - The plugin tuple. Defaults to `readonly Plugin[]`.
 */
export type PluginClientExtensionContext<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = {
	client: BetterDrizzleClient<Schema, Meta, Plugins>;
	db: unknown;
	dialect: PluginDialect;
	models: ModelRegistry<Schema>;
	plugin: PluginMeta;
	schema: Schema;
};

/**
 * A Better Drizzle plugin definition. Plugins extend the client with
 * additional properties, per-model methods, lifecycle hooks, and
 * operation transforms.
 *
 * @typeParam Options          - Plugin-specific options shape.
 * @typeParam ClientExtension  - Properties added to the client by `extendClient`.
 * @typeParam ModelExtension   - Properties added to each delegate by `extendModel`.
 * @typeParam State            - Plugin state type carried through hooks and transforms.
 */
export interface Plugin<
	Options = unknown,
	ClientExtension extends PluginExtension = Record<never, never>,
	ModelExtension extends PluginExtension = Record<never, never>,
	State extends PluginState = PluginState,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap> = Record<
		never,
		never
	>,
> extends PluginMeta<Options> {
	config?: PluginConfig;
	extendClient?<
		Schema extends AnySchema,
		Meta,
		Plugins extends readonly AnyPlugin[],
	>(
		context: PluginClientExtensionContext<Schema, Meta, Plugins>,
	): ClientExtension | undefined;
	extendModel?<Schema extends AnySchema, Meta>(
		context: PluginModelExtensionContext<Schema, Meta>,
	): ModelExtension | undefined;
	hooks?: PluginHooks<AnySchema, BetterMeta, State, NoInfer<OperationArgs>>;
	operationArgs?: OperationArgs;
	setup?<Schema extends AnySchema, Meta>(
		context: PluginSetupContext<
			Schema,
			Meta,
			State,
			NoInfer<OperationArgs>
		>,
	): void;
	transform?: PluginTransform<
		AnySchema,
		BetterMeta,
		State,
		NoInfer<OperationArgs>
	>;
}

/**
 * Erased plugin type used as a constraint in generic tuples. All plugin
 * generics are widened to `any` so that `readonly AnyPlugin[]` accepts
 * any combination of plugins.
 */
// biome-ignore lint/suspicious/noExplicitAny: intentionally erase plugin generics for constraints
export type AnyPlugin = Plugin<any, any, any, any, any>;

type PluginDefinition<
	Options,
	ClientExtension extends PluginExtension,
	ModelExtension extends PluginExtension,
	State extends PluginState,
	OperationArgs extends Partial<PluginOperationArgsExtensionMap>,
> = Omit<
	Plugin<Options, ClientExtension, ModelExtension, State, OperationArgs>,
	'hooks' | 'operationArgs' | 'setup' | 'transform'
> & {
	hooks?: PluginHooks<AnySchema, BetterMeta, State, NoInfer<OperationArgs>>;
	operationArgs?: OperationArgs;
	setup?<Schema extends AnySchema, Meta>(
		context: PluginSetupContext<
			Schema,
			Meta,
			State,
			NoInfer<OperationArgs>
		>,
	): void;
	transform?: PluginTransform<
		AnySchema,
		BetterMeta,
		State,
		NoInfer<OperationArgs>
	>;
};

/**
 * Extracts the client-level extension type from a plugin definition.
 *
 * @typeParam PluginDef - The plugin type to extract from.
 */
export type ClientExtensionOf<PluginDef> =
	PluginDef extends Plugin<
		unknown,
		infer Extension,
		PluginExtension,
		PluginState,
		Partial<PluginOperationArgsExtensionMap>
	>
		? Extension
		: Record<never, never>;

/**
 * Extracts the model-level extension type from a plugin definition.
 *
 * @typeParam PluginDef - The plugin type to extract from.
 */
export type ModelExtensionOf<PluginDef> =
	PluginDef extends Plugin<
		unknown,
		PluginExtension,
		infer Extension,
		PluginState,
		Partial<PluginOperationArgsExtensionMap>
	>
		? Extension
		: Record<never, never>;

/**
 * Extracts the operation-args extension map from a plugin definition.
 * Returns `Record<never, never>` when the plugin does not declare any
 * custom operation arguments.
 *
 * @typeParam PluginDef - The plugin type to extract from.
 */
export type OperationArgsOf<PluginDef> =
	PluginDef extends Plugin<
		unknown,
		PluginExtension,
		PluginExtension,
		PluginState,
		infer OperationArgs
	>
		? OperationArgs
		: Record<never, never>;

/**
 * Converts a union type `A | B` into an intersection type `A & B`.
 * Used internally to merge extension types from multiple plugins.
 *
 * @typeParam Value - The union type to convert.
 */
export type UnionToIntersection<Value> = (
	Value extends unknown
		? (input: Value) => void
		: never
) extends (input: infer Intersection) => void
	? Intersection
	: never;

/**
 * Merges the client-level extension types from all plugins in a tuple
 * into a single intersection type.
 *
 * @typeParam Plugins - The plugin tuple.
 */
export type ClientExtensionsOf<Plugins extends readonly AnyPlugin[]> =
	UnionToIntersection<
		ClientExtensionOf<Plugins[number]>
	> extends infer Extension
		? Extension extends Record<string, unknown>
			? Extension
			: Record<never, never>
		: Record<never, never>;

/**
 * Merges the operation-args extension types from all plugins in a tuple
 * for a specific operation kind into a single intersection type.
 *
 * @typeParam Plugins - The plugin tuple.
 * @typeParam Kind    - The operation kind to merge args for.
 */
export type PluginOperationArgsFor<
	Plugins extends readonly AnyPlugin[],
	Kind extends PluginHookKind,
> =
	UnionToIntersection<
		OperationArgsForKind<OperationArgsOf<Plugins[number]>, Kind>
	> extends infer Extension
		? Extension extends Record<string, unknown>
			? Extension
			: Record<never, never>
		: Record<never, never>;

/**
 * Builds the full operation-args extension map for all plugins in a
 * tuple, keyed by {@link PluginHookKind}. Used to type the extra fields
 * that plugins inject into delegate method arguments.
 *
 * @typeParam Plugins - The plugin tuple.
 */
export type OperationArgsExtensionsOf<Plugins extends readonly AnyPlugin[]> = {
	[K in PluginHookKind]: PluginOperationArgsFor<Plugins, K>;
};

/**
 * Intersects a base operation-args type with the plugin-declared
 * operation-args extensions for a given operation kind. The result is
 * the full args type that delegates expose for that operation.
 *
 * @typeParam Args    - The base operation arguments type.
 * @typeParam Plugins - The plugin tuple.
 * @typeParam Kind    - The operation kind.
 */
export type OperationArgsWithPlugins<
	Args,
	Plugins extends readonly AnyPlugin[],
	Kind extends PluginHookKind,
> = Args & PluginOperationArgsFor<Plugins, Kind>;

/**
 * Merges the model-level extension types from all plugins in a tuple
 * into a single intersection type.
 *
 * @typeParam Plugins - The plugin tuple.
 */
export type ModelExtensionsOf<Plugins extends readonly AnyPlugin[]> =
	UnionToIntersection<
		ModelExtensionOf<Plugins[number]>
	> extends infer Extension
		? Extension extends Record<string, unknown>
			? Extension
			: Record<never, never>
		: Record<never, never>;

/**
 * Helper that creates a well-typed plugin definition. Use this to get
 * full type inference for hooks, transforms, extensions, and state.
 *
 * @typeParam PluginDef - The concrete plugin definition.
 * @param plugin - The plugin definition object.
 * @returns The same plugin object, narrowed to its literal types.
 *
 * @example
 * ```ts
 * import { definePlugin } from 'better-drizzle';
 *
 * const myPlugin = definePlugin({
 *   id: 'soft-delete',
 *   name: 'Soft Delete',
 *   version: '1.0.0',
 *   setup(ctx) {
 *     ctx.addHook({ beforeDelete(c) { c.args; } });
 *   },
 * });
 * ```
 */
export const definePlugin = <
	const Options = unknown,
	const ClientExtension extends PluginExtension = Record<never, never>,
	const ModelExtension extends PluginExtension = Record<never, never>,
	const State extends PluginState = PluginState,
	const OperationArgs extends
		Partial<PluginOperationArgsExtensionMap> = Record<never, never>,
>(
	plugin: PluginDefinition<
		Options,
		ClientExtension,
		ModelExtension,
		State,
		OperationArgs
	>,
) =>
	plugin as Plugin<
		Options,
		ClientExtension,
		ModelExtension,
		State,
		OperationArgs
	>;
