import type { AnyColumn, SQL, SQLWrapper, Table } from 'drizzle-orm';
import type { extractTablesRelationalConfig } from 'drizzle-orm/relations';

import type {
	AnyPlugin,
	AnySchema,
	BetterClientOptions,
	BetterMeta,
	BetterRelationalConfig,
	BetterTableKey,
	PluginDialect,
	PluginHookKind,
	PluginMeta,
	PluginModelInfo,
	QueryArgs,
} from '.';
import type { TransactionOptions } from './transaction';

/**
 * Minimal shape of a Drizzle query delegate used for relational queries.
 * Matches the `db.query.TableName` interface exposed by Drizzle ORM.
 */
export type DrizzleQueryDelegate = {
	/** Execute a relational query returning multiple rows. */
	findMany(config?: unknown): Promise<unknown[]> & {
		getSQL?(): SQL;
	};
	/** Execute a relational query returning a single row. */
	findFirst?(config?: unknown): Promise<unknown | undefined> & {
		getSQL?(): SQL;
	};
};

/**
 * Minimal shape of a Drizzle insert builder. Matches the fluent API
 * returned by `db.insert(table).values(data)` without depending on
 * Drizzle's internal types.
 */
export type InsertBuilderLike = {
	/** Append a RETURNING clause to the insert statement. */
	returning?: (
		fields?: Record<string, unknown>,
	) => Promise<Record<string, unknown>[]>;
	/** Append an ON CONFLICT DO NOTHING clause. */
	onConflictDoNothing?: (config?: {
		target?: AnyColumn | AnyColumn[];
	}) => InsertBuilderLike & Promise<unknown>;
	/** Append an ON CONFLICT DO UPDATE clause (PostgreSQL/SQLite). */
	onConflictDoUpdate?: (config: {
		set: Record<string, unknown>;
		target: AnyColumn | AnyColumn[];
		setWhere?: SQL;
		targetWhere?: SQL;
		where?: SQL;
	}) => InsertBuilderLike & Promise<unknown>;
	/** Append an ON DUPLICATE KEY UPDATE clause (MySQL). */
	onDuplicateKeyUpdate?: (config: {
		set: Record<string, unknown>;
	}) => InsertBuilderLike & Promise<unknown>;
};

/**
 * Minimal shape of a Drizzle update builder. The `set().where()` chain
 * resolves to a Promise-like that also exposes an optional `returning()`.
 */
export type UpdateBuilderLike = Promise<unknown> & {
	/** Append a RETURNING clause to the update statement. */
	returning?: (
		fields?: Record<string, unknown>,
	) => Promise<Record<string, unknown>[]>;
};

/**
 * Minimal shape of a Drizzle delete builder. The `where()` chain resolves
 * to a Promise-like that also exposes an optional `returning()`.
 */
export type DeleteBuilderLike = Promise<unknown> & {
	/** Append a RETURNING clause to the delete statement. */
	returning?: () => Promise<Record<string, unknown>[]>;
};

/**
 * Minimal shape of a Drizzle select query. Represents the fluent chain
 * returned by `db.select().from(table)` with join, filter, and ordering
 * methods, resolving to a Promise of rows.
 */
export type SelectQueryLike = SQL &
	Promise<Record<string, unknown>[]> & {
		/** Acquire a row-level lock on the result set (PostgreSQL/MySQL). */
		for?(strength: string, config?: unknown): SelectQueryLike;
		/** Perform an inner join with another table. */
		innerJoin(table: Table, on: unknown): SelectQueryLike;
		/** Perform a left join with another table. */
		leftJoin(table: Table, on: unknown): SelectQueryLike;
		/** Limit the number of returned rows. */
		limit(limit: number): SelectQueryLike;
		/** Skip a number of rows from the start. */
		offset(offset: number): SelectQueryLike;
		/** Sort the result set by one or more columns. */
		orderBy(...values: unknown[]): SelectQueryLike;
		/** Filter the result set with a WHERE clause. */
		where(where?: unknown): SelectQueryLike;
	};

/**
 * Minimal shape of a Drizzle database instance. Matches the public API
 * surface used by Better Drizzle (`insert`, `update`, `delete`, `select`,
 * `query`, and optional `$count`) without importing Drizzle's internal types.
 */
export type DrizzleLikeDatabase = {
	/** Dialect constructor info used for auto-detection. */
	dialect?: {
		constructor?: {
			name?: string;
		};
	};
	/** Relational query delegates keyed by table name. */
	query: Record<string, DrizzleQueryDelegate>;
	/** Execute a raw query and return all matching rows. */
	all?(query: SQL | SQLWrapper | string): Promise<unknown[]> | unknown[];
	/** Execute a raw query and return the result. */
	execute?(query: SQL | SQLWrapper | string): Promise<unknown> | unknown;
	/** Start an insert statement on the given table. */
	insert(table: Table): {
		/** MySQL-specific ignore variant. */
		ignore?(): {
			values(data: unknown): InsertBuilderLike & Promise<unknown>;
		};
		values(data: unknown): InsertBuilderLike & Promise<unknown>;
	};
	/** Start an update statement on the given table. */
	update(table: Table): {
		set(data: unknown): {
			where(where: unknown): UpdateBuilderLike;
		};
	};
	/** Start a delete statement on the given table. */
	delete(table: Table): {
		where(where: unknown): DeleteBuilderLike;
	};
	/** Start a select statement, optionally with specific fields. */
	select(selection?: Record<string, unknown>): {
		from(table: Table): SelectQueryLike;
	};
	/** Count rows in the given table (Drizzle optional method). */
	$count?(table: Table, filters?: unknown): Promise<number>;
	/** Execute a raw SQL statement (SQLite-specific). */
	run?(query: SQL): unknown;
	/** Open a database transaction. */
	transaction?<T>(
		callback: (tx: DrizzleLikeDatabase) => Promise<T> | T,
		config?: unknown,
	): Promise<T>;
	/** Rollback the current transaction (SQLite-specific). */
	rollback?(): never;
};

/**
 * Runtime callback used to build user-defined client extensions for a bound
 * Better Drizzle client instance.
 */
export type RuntimeClientExtensionFactory = (
	client: Record<string, unknown>,
) => Record<string, unknown> | undefined;

/**
 * Resolved relational schema configuration returned by Drizzle's
 * `extractTablesRelationalConfig`. Used internally to build the runtime
 * table metadata map.
 */
export type RuntimeSchema = ReturnType<
	typeof extractTablesRelationalConfig<Record<string, BetterRelationalConfig>>
>;

/**
 * Precomputed per-table metadata used at runtime for query compilation,
 * relation resolution, and plugin operations.
 */
export type TableRuntime = {
	/** Map of column name to Drizzle column instance. */
	columns: Record<string, AnyColumn>;
	/** The database table name. */
	dbName: string;
	/** Checks whether a column with the given name exists on this table. */
	hasColumn(column: string): boolean;
	/** Plugin model info descriptor for this table. */
	model: PluginModelInfo;
	/** Primary key column names. */
	primaryKeyFields: string[];
	/** Map of relation name to resolved relation metadata. */
	relations: Record<
		string,
		{
			fields: AnyColumn[];
			references: AnyColumn[];
			relation: BetterRelationalConfig['relations'][string];
			tableName: string;
		}
	>;
	/** Set of relation names defined on this table. */
	relationNames: Set<string>;
	/** The Drizzle table instance. */
	table: Table;
	/** The full relational config for this table. */
	tableConfig: BetterRelationalConfig;
};

/**
 * Runtime signature for a plugin before-hook function. Receives the raw
 * hook context object and may return modified data or `undefined`.
 */
export type PluginRuntimeBeforeHook = (
	context: Record<string, unknown>,
) => unknown;

/**
 * Runtime signature for a plugin after-hook function. Receives the raw
 * hook context including the operation result.
 */
export type PluginRuntimeAfterHook = (
	context: Record<string, unknown>,
) => unknown;

/**
 * Runtime signature for a plugin transaction hook function. Receives the
 * raw transaction hook context object.
 */
export type PluginRuntimeTransactionHook = (
	context: Record<string, unknown>,
) => unknown;

/**
 * Runtime signature for a plugin transform function. Receives the raw
 * operation input and may return a modified version or `undefined` to
 * skip the operation.
 */
export type PluginRuntimeTransform = (
	operation: Record<string, unknown>,
) => Record<string, unknown> | undefined;

/**
 * Bucket holding all plugin hooks and transforms for a specific operation
 * kind. Precomputed during initialization to avoid per-call iteration.
 */
export type PluginRuntimeBucket = {
	/** Registered after-hook functions. */
	afterHooks: PluginRuntimeAfterHook[];
	/** Registered before-hook functions. */
	beforeHooks: PluginRuntimeBeforeHook[];
	/** `true` when at least one after-hook is registered. */
	hasAfterHooks: boolean;
	/** `true` when at least one before-hook is registered. */
	hasBeforeHooks: boolean;
	/** `true` when at least one transform is registered. */
	hasTransforms: boolean;
	/** Registered transform functions. */
	transforms: PluginRuntimeTransform[];
};

/**
 * Bucket holding all plugin transaction hooks. Precomputed during
 * initialization to avoid per-call iteration.
 */
export type PluginRuntimeTransactionBucket = {
	/** Registered after-commit hook functions. */
	afterCommitHooks: PluginRuntimeTransactionHook[];
	/** Registered after-rollback hook functions. */
	afterRollbackHooks: PluginRuntimeTransactionHook[];
	/** Registered before-transaction hook functions. */
	beforeHooks: PluginRuntimeTransactionHook[];
	/** Registered on-transaction-error hook functions. */
	errorHooks: PluginRuntimeTransactionHook[];
};

/**
 * Bucket holding all plugin raw-query hooks. Precomputed during
 * initialization to avoid per-call iteration.
 */
export type PluginRuntimeRawBucket = {
	/** Registered after-raw hook functions. */
	afterHooks: PluginRuntimeAfterHook[];
	/** Registered before-raw hook functions. */
	beforeHooks: PluginRuntimeBeforeHook[];
	/** Registered raw error hook functions. */
	errorHooks: PluginRuntimeAfterHook[];
};

/**
 * A callback function used in transaction lifecycle hooks (after-commit,
 * after-rollback). May return a value or a promise.
 */
export type TransactionCallback = () => unknown | Promise<unknown>;

/**
 * Internal state for an active transaction. Tracks the nesting depth,
 * retry attempt number, abort signals, and queued lifecycle callbacks.
 */
export type TransactionRuntime = {
	/** Error set by an abort signal, if the transaction was aborted. */
	abortError?: unknown;
	/** Callbacks queued to run after the transaction commits. */
	afterCommit: TransactionCallback[];
	/** Callbacks queued to run after the transaction rolls back. */
	afterRollback: TransactionCallback[];
	/** The current retry attempt number (1-indexed). */
	attempt: number;
	/** Optional comment attached to the transaction (PostgreSQL only). */
	comment?: string;
	/** Custom context object scoped to this transaction. */
	context?: Record<string, unknown>;
	/** Nesting depth (0 for root transactions, incremented for savepoints). */
	depth: number;
	/** Optional name for named savepoints. */
	name?: string;
	/** The original transaction options. */
	options: TransactionOptions;
	/** Reference to the parent transaction state, when nested. */
	parent?: TransactionRuntime;
};

/**
 * Internal runtime context built once during client initialization.
 * Carries the database handle, schema, precomputed table metadata,
 * plugin buckets, and configuration. Passed through all operations.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type RuntimeContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
> = {
	/** The bound client or transaction client, set after initialization. */
	client:
		| import('./delegate').BetterDrizzleClient<Schema, Meta, Plugins>
		| import('./transaction').BetterDrizzleTransactionClient<
				Schema,
				Meta,
				Plugins
		  >
		| null;
	/** The raw Drizzle database instance. */
	db: DrizzleLikeDatabase;
	/** The detected SQL dialect (`'pg'`, `'sqlite'`, or `'mysql'`). */
	dialect: PluginDialect;
	/** `true` when at least one client-level hook is registered. */
	hasHooks: boolean;
	/** `true` when the `onError` client hook is registered. */
	hasOnError: boolean;
	/** `true` when at least one plugin is loaded. */
	hasPlugins: boolean;
	/** Per-model info descriptors keyed by table name. */
	models: Record<string, PluginModelInfo>;
	/** The client configuration provided to `better()`. */
	options: BetterClientOptions<Schema, Meta, Plugins>;
	/** Default metadata merged into every scoped operation. */
	scopedMeta: Meta | undefined;
	/** Precomputed plugin buckets and metadata. */
	plugins: {
		byKind: Record<PluginHookKind, PluginRuntimeBucket>;
		meta: PluginMeta[];
		raw: PluginRuntimeRawBucket;
		transaction: PluginRuntimeTransactionBucket;
	};
	/** The full Drizzle schema object. */
	fullSchema: Schema;
	/** The resolved relational schema from Drizzle. */
	relational: RuntimeSchema;
	/** Repository lookup map (TypeScript key and DB name -> delegate). */
	repositories: Record<string, unknown>;
	/** User-defined client extensions to reapply on derived clients. */
	clientExtensions: RuntimeClientExtensionFactory[];
	/** Precomputed per-table runtime metadata. */
	tables: Record<string, TableRuntime>;
	/** Active transaction state, or `null` outside a transaction. */
	transaction: TransactionRuntime | null;
};

/**
 * Extended runtime context used by the where-clause compiler. Includes
 * the base {@link RuntimeContext} plus per-query information such as
 * the current table's runtime metadata and root query arguments.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type WhereCompilerContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> = RuntimeContext<Schema, Meta> & {
	/** The root query arguments passed by the caller (if any). */
	rootArgs?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>;
	/** Runtime metadata for the table being queried. */
	runtime: TableRuntime;
	/** The database table name. */
	tableName: string;
};

/**
 * A where-clause value that can be compiled into a Drizzle SQL expression.
 * Either a plain object (structured where input) or a raw Drizzle `SQL`
 * expression.
 */
export type CompilableWhere = Record<string, unknown> | SQL;

/**
 * Promise that resolves to `T | null`. Used for single-row operations
 * that may not find a matching record.
 *
 * @typeParam T - The result type when a record is found.
 */
export type NullableResult<T> = Promise<T | null>;

/**
 * Describes a foreign-key join between two columns. Used internally by
 * the query compiler to build join conditions.
 */
export type JoinColumns = {
	/** Local columns that hold the foreign key values. */
	fields: AnyColumn[];
	/** Remote columns referenced by the foreign key. */
	references: AnyColumn[];
	/** The Drizzle table instance that owns the referenced columns. */
	referencedTable: Table;
};
