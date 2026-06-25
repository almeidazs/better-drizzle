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
	findMany(config?: unknown): Promise<unknown[]>;
	findFirst?(config?: unknown): Promise<unknown | undefined>;
};

/**
 * Minimal shape of a Drizzle insert builder. Matches the fluent API
 * returned by `db.insert(table).values(data)` without depending on
 * Drizzle's internal types.
 */
export type InsertBuilderLike = {
	returning?: () => Promise<Record<string, unknown>[]>;
	onConflictDoNothing?: (config?: {
		target?: AnyColumn | AnyColumn[];
	}) => InsertBuilderLike & Promise<unknown>;
	onConflictDoUpdate?: (config: {
		set: Record<string, unknown>;
		target: AnyColumn | AnyColumn[];
	}) => InsertBuilderLike & Promise<unknown>;
};

/**
 * Minimal shape of a Drizzle update builder. The `set().where()` chain
 * resolves to a Promise-like that also exposes an optional `returning()`.
 */
export type UpdateBuilderLike = Promise<unknown> & {
	returning?: () => Promise<Record<string, unknown>[]>;
};

/**
 * Minimal shape of a Drizzle delete builder. The `where()` chain resolves
 * to a Promise-like that also exposes an optional `returning()`.
 */
export type DeleteBuilderLike = Promise<unknown> & {
	returning?: () => Promise<Record<string, unknown>[]>;
};

/**
 * Minimal shape of a Drizzle select query. Represents the fluent chain
 * returned by `db.select().from(table)` with join, filter, and ordering
 * methods, resolving to a Promise of rows.
 */
export type SelectQueryLike = SQL &
	Promise<Record<string, unknown>[]> & {
		innerJoin(table: Table, on: unknown): SelectQueryLike;
		leftJoin(table: Table, on: unknown): SelectQueryLike;
		limit(limit: number): SelectQueryLike;
		offset(offset: number): SelectQueryLike;
		orderBy(...values: unknown[]): SelectQueryLike;
		where(where?: unknown): SelectQueryLike;
	};

/**
 * Minimal shape of a Drizzle database instance. Matches the public API
 * surface used by Better Drizzle (`insert`, `update`, `delete`, `select`,
 * `query`, and optional `$count`) without importing Drizzle's internal types.
 */
export type DrizzleLikeDatabase = {
	dialect?: {
		constructor?: {
			name?: string;
		};
	};
	query: Record<string, DrizzleQueryDelegate>;
	all?(query: SQL | SQLWrapper | string): Promise<unknown[]> | unknown[];
	execute?(query: SQL | SQLWrapper | string): Promise<unknown> | unknown;
	insert(table: Table): {
		ignore?(): {
			values(data: unknown): InsertBuilderLike & Promise<unknown>;
		};
		values(data: unknown): InsertBuilderLike & Promise<unknown>;
	};
	update(table: Table): {
		set(data: unknown): {
			where(where: unknown): UpdateBuilderLike;
		};
	};
	delete(table: Table): {
		where(where: unknown): DeleteBuilderLike;
	};
	select(selection?: Record<string, unknown>): {
		from(table: Table): SelectQueryLike;
	};
	$count?(table: Table, filters?: unknown): Promise<number>;
	run?(query: SQL): unknown;
	transaction?<T>(
		callback: (tx: DrizzleLikeDatabase) => Promise<T> | T,
		config?: unknown,
	): Promise<T>;
	rollback?(): never;
};

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
	rootArgs?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>;
	runtime: TableRuntime;
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
