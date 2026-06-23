import type { AnyColumn, SQL, Table } from 'drizzle-orm';
import type { extractTablesRelationalConfig } from 'drizzle-orm/relations';

import type {
	AnySchema,
	BetterClientOptions,
	BetterMeta,
	BetterRelationalConfig,
	BetterTableKey,
	Plugin,
	PluginDialect,
	PluginHookKind,
	PluginMeta,
	PluginModelInfo,
	QueryArgs,
} from '.';

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
	insert(table: Table): {
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
 * Internal runtime context built once during client initialization.
 * Carries the database handle, schema, precomputed table metadata,
 * plugin buckets, and configuration. Passed through all operations.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type RuntimeContext<Schema extends AnySchema, Meta = BetterMeta> = {
	db: DrizzleLikeDatabase;
	dialect: PluginDialect;
	hasHooks: boolean;
	hasOnError: boolean;
	hasPlugins: boolean;
	models: Record<string, PluginModelInfo>;
	options: BetterClientOptions<Schema, Meta, readonly Plugin[]>;
	plugins: {
		byKind: Record<PluginHookKind, PluginRuntimeBucket>;
		meta: PluginMeta[];
	};
	fullSchema: Schema;
	relational: RuntimeSchema;
	repositories: Record<string, unknown>;
	tables: Record<string, TableRuntime>;
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
