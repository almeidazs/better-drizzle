import type { TableRelationalConfig } from 'drizzle-orm';

import type { PaginationResult } from './database';
import type {
	AnyPlugin,
	ClientExtensionsOf,
	ModelExtensionsOf,
	OperationArgsWithPlugins,
	PluginState,
} from './plugins';
import type {
	IncludeInput,
	PaginationArgs,
	PayloadForArgs,
	QueryArgs,
	SelectInput,
	WhereArg,
} from './query';
import type { RawExecutionResult, RawOptions, RawSql } from './raw';
import type {
	BetterDrizzleTransactionClient,
	TransactionOptions,
} from './transaction';
import type {
	AnySchema,
	DbNameKey,
	InsertModelFor,
	SourceKeyFromDbName,
	TableConfigFor,
	TableKey,
} from './utils';

/**
 * A factory function that creates the error thrown when `.throw()` is invoked
 * on a {@link ThrowingResult} and no record was found.
 */
export type ThrowFactory = () => unknown;

/**
 * A promise-like type that resolves to `T | null` and exposes a `.throw()`
 * helper. Calling `.throw()` converts a `null` result into a thrown error,
 * making it convenient for operations that must always return a record.
 *
 * @typeParam T - The non-null result type.
 */
export type ThrowingResult<T> = Promise<T | null> & {
	throw(): Promise<import('./utils').NonNullish<T>>;
	throw(factory: ThrowFactory): Promise<import('./utils').NonNullish<T>>;
};

/**
 * Result returned by batch operations (`createMany`, `updateMany`, `deleteMany`).
 *
 * @typeParam T - The row type returned by the operation (may be `never` when
 *   the database driver does not support `RETURNING`).
 */
export interface BatchResult<T> {
	/** Number of rows affected by the operation. */
	count: number;
	/** The affected rows, when the driver supports returning them. */
	data?: T[];
}

export type ConflictAction = 'ignore' | 'throw';

export type ConflictTargetColumn<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<keyof InsertModelFor<Schema, Name>, string>;

export type OnConflictOption<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> =
	| ConflictAction
	| {
			action: ConflictAction;
			targets?: readonly ConflictTargetColumn<Schema, Name>[];
	  };

/**
 * Arguments for the create operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface CreateArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** The row data to insert. */
	data: InsertModelFor<Schema, Name>;
	/** Optional conflict handling for unique / primary key violations. */
	onConflict?: OnConflictOption<Schema, Name>;
	/** Optional column / relation projection for the returned row. */
	select?: SelectInput<Schema, Name>;
	/** Optional relation-only projection for the returned row. */
	include?: IncludeInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the update operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface UpdateArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** Filter identifying which row to update. */
	where: WhereArg<Schema, Name>;
	/** Partial column values to apply. */
	data: Partial<InsertModelFor<Schema, Name>>;
	/** Optional column / relation projection for the returned row. */
	select?: SelectInput<Schema, Name>;
	/** Optional relation-only projection for the returned row. */
	include?: IncludeInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the createMany operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface CreateManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** Array of row data to insert. */
	data: InsertModelFor<Schema, Name>[];
	/** Optional conflict handling for unique / primary key violations. */
	onConflict?: OnConflictOption<Schema, Name>;
	/** Optional column / relation projection for returned rows. */
	select?: SelectInput<Schema, Name>;
	/** Optional relation-only projection for returned rows. */
	include?: IncludeInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the updateMany operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface UpdateManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** Optional filter. When omitted, all rows are updated. */
	where?: WhereArg<Schema, Name>;
	/** Partial column values to apply to every matched row. */
	data: Partial<InsertModelFor<Schema, Name>>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the deleteMany operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface DeleteManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** Optional filter. When omitted, all rows are deleted. */
	where?: WhereArg<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the delete operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface DeleteArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** Filter identifying which row to delete. */
	where: WhereArg<Schema, Name>;
	/** Optional column / relation projection for the returned row. */
	select?: SelectInput<Schema, Name>;
	/** Optional relation-only projection for the returned row. */
	include?: IncludeInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the upsert operation.
 * Provides both the create and update payloads alongside a where clause
 * that determines whether to insert or update.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface UpsertArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** Filter that determines whether to insert or update. */
	where: WhereArg<Schema, Name>;
	/** Row data used when no matching record exists. */
	create: InsertModelFor<Schema, Name>;
	/** Partial column values applied when a matching record exists. */
	update: Partial<InsertModelFor<Schema, Name>>;
	/** Optional column / relation projection for the returned row. */
	select?: SelectInput<Schema, Name>;
	/** Optional relation-only projection for the returned row. */
	include?: IncludeInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

type RepositoryKey<Schema extends AnySchema> =
	| TableKey<Schema>
	| DbNameKey<Schema>;

type RepositorySourceKey<
	Schema extends AnySchema,
	Name extends RepositoryKey<Schema>,
> =
	Name extends TableKey<Schema>
		? Name
		: SourceKeyFromDbName<Schema, Extract<Name, string>>;

/**
 * The fully-typed client returned by {@link better}. Provides a delegate for
 * every table in the schema plus a unified `repository()` accessor.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type BetterDrizzleClient<
	Schema extends AnySchema,
	Meta = import('./query').BetterMeta,
	Plugins extends readonly AnyPlugin[] = [],
> = BetterDrizzleClientByTableWithPlugins<Schema, Meta, Plugins> &
	ClientExtensionsOf<Plugins> & {
		/** Executes a safe raw SQL query and returns rows. */
		$raw<Row = unknown>(
			query: TemplateStringsArray,
			...params: unknown[]
		): Promise<Row[]>;
		/** Executes a safe raw SQL query and returns rows. */
		$raw<Row = unknown>(query: RawSql): Promise<Row[]>;
		/** Executes a safe raw SQL query and returns mapped rows. */
		$raw<Row = unknown, Mapped = Row>(
			query: RawSql,
			options: RawOptions<Row, Mapped>,
		): Promise<Mapped[]>;
		/** Executes a safe raw SQL statement and returns a normalized result. */
		$executeRaw(
			query: TemplateStringsArray,
			...params: unknown[]
		): Promise<RawExecutionResult>;
		/** Executes a safe raw SQL statement and returns a normalized result. */
		$executeRaw(
			query: RawSql,
			options?: RawOptions,
		): Promise<RawExecutionResult>;
		/** Executes a raw SQL string, optionally with parameter bindings. */
		$rawUnsafe<Row = unknown>(
			query: string,
			params?: unknown[],
		): Promise<Row[]>;
		/** Executes a raw SQL string, optionally with parameter bindings, and returns mapped rows. */
		$rawUnsafe<Row = unknown, Mapped = Row>(
			query: string,
			params: unknown[] | undefined,
			options: RawOptions<Row, Mapped>,
		): Promise<Mapped[]>;
		/**
		 * Runs the callback inside a database transaction and returns its result.
		 */
		transaction<T>(
			callback: (
				tx: BetterDrizzleTransactionClient<Schema, Meta, Plugins>,
			) => Promise<T> | T,
			options?: TransactionOptions,
		): Promise<T>;
		/**
		 * Retrieves the model delegate for the given repository name. The name can
		 * be either the TypeScript table key or the database table name.
		 *
		 * @param name - Table key or database name.
		 * @returns The model delegate for the specified table.
		 */
		repository<Name extends RepositoryKey<Schema>>(
			name: Name,
		): BetterDrizzleModelDelegate<
			Schema,
			RepositorySourceKey<Schema, Name>,
			Meta,
			Plugins
		>;
	};

type BetterDrizzleClientByTableWithPlugins<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
> = {
	[K in TableKey<Schema>]: BetterDrizzleModelDelegate<
		Schema,
		K,
		Meta,
		Plugins
	>;
};

/**
 * Model delegate providing all CRUD and query methods for a single table.
 * Each method is fully typed against the table's select/insert models and the
 * provided query arguments.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type BetterDrizzleModelDelegate<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
	Plugins extends readonly AnyPlugin[] = [],
	ModelExtension extends Record<string, unknown> = ModelExtensionsOf<Plugins>,
> = {
	/** Internal model metadata useful for plugins. */
	$model: {
		dbName: string;
		hasColumn(column: string): boolean;
		name: Name;
	};
	/** Ephemeral plugin state carried by cloned delegates. */
	$state: PluginState;
	/** Returns a cloned delegate with merged plugin state. */
	$withState(
		state: PluginState,
	): BetterDrizzleModelDelegate<Schema, Name, Meta, Plugins, ModelExtension>;
	/** Returns a cloned delegate that bypasses plugin hooks and transforms. */
	$withoutPlugins(): BetterDrizzleModelDelegate<
		Schema,
		Name,
		Meta,
		Plugins,
		ModelExtension
	>;
	/** Counts matching rows. */
	count(
		args?: OperationArgsWithPlugins<
			import('./query').CountArgs<Schema, Name, Meta>,
			Plugins,
			'count'
		>,
	): Promise<number>;
	/** Returns `true` when at least one matching row exists. */
	exists(
		args?: OperationArgsWithPlugins<
			import('./query').ExistsArgs<Schema, Name, Meta>,
			Plugins,
			'exists'
		>,
	): Promise<boolean>;
	/** Inserts a single row and returns the created record. */
	create<
		Args extends OperationArgsWithPlugins<
			CreateArgs<Schema, Name, Meta>,
			Plugins,
			'create'
		>,
	>(args: Args): Promise<PayloadForArgs<Schema, Name, Args>>;
	/** Inserts multiple rows in a single statement. */
	createMany<
		Args extends OperationArgsWithPlugins<
			CreateManyArgs<Schema, Name, Meta>,
			Plugins,
			'createMany'
		>,
	>(args: Args): Promise<BatchResult<PayloadForArgs<Schema, Name, Args>>>;
	/** Inserts a row if no match is found, otherwise updates it. */
	upsert<
		Args extends OperationArgsWithPlugins<
			UpsertArgs<Schema, Name, Meta>,
			Plugins,
			'upsert'
		>,
	>(args: Args): Promise<PayloadForArgs<Schema, Name, Args>>;
	/** Returns all matching rows. */
	findMany<
		Args extends OperationArgsWithPlugins<
			QueryArgs<Schema, Name, Meta>,
			Plugins,
			'findMany'
		>,
	>(args?: Args): Promise<PayloadForArgs<Schema, Name, Args>[]>;
	/** Updates a single matching row and returns the updated record. */
	update<
		Args extends OperationArgsWithPlugins<
			UpdateArgs<Schema, Name, Meta>,
			Plugins,
			'update'
		>,
	>(args: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Updates all matching rows and returns the affected count. */
	updateMany(
		args: OperationArgsWithPlugins<
			UpdateManyArgs<Schema, Name, Meta>,
			Plugins,
			'updateMany'
		>,
	): Promise<BatchResult<never>>;
	/** Returns the first matching row (alias for `findFirst`). */
	findOne<
		Args extends OperationArgsWithPlugins<
			QueryArgs<Schema, Name, Meta>,
			Plugins,
			'findOne'
		>,
	>(args?: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Returns the first matching row. */
	findFirst<
		Args extends OperationArgsWithPlugins<
			QueryArgs<Schema, Name, Meta>,
			Plugins,
			'findFirst'
		>,
	>(args?: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Returns exactly one matching row; throws if not found. */
	findUnique<
		Args extends OperationArgsWithPlugins<
			QueryArgs<Schema, Name, Meta>,
			Plugins,
			'findUnique'
		>,
	>(args: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Returns a paginated result set. */
	paginate<
		Args extends OperationArgsWithPlugins<
			PaginationArgs<Schema, Name, Meta>,
			Plugins,
			'paginate'
		>,
	>(
		args: Args,
	): Promise<PaginationResult<PayloadForArgs<Schema, Name, Args>>>;
	/** Deletes a single matching row and returns the deleted record. */
	delete<
		Args extends OperationArgsWithPlugins<
			DeleteArgs<Schema, Name, Meta>,
			Plugins,
			'delete'
		>,
	>(args: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Deletes all matching rows and returns the affected count. */
	deleteMany(
		args: OperationArgsWithPlugins<
			DeleteManyArgs<Schema, Name, Meta>,
			Plugins,
			'deleteMany'
		>,
	): Promise<BatchResult<never>>;
} & ModelExtension;

/**
 * Extracts the relational configuration for a specific table from the schema.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type BetterTableConfig<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = TableConfigFor<Schema, Name>;

/**
 * Union of all valid table keys in the schema.
 *
 * @typeParam Schema - The Drizzle schema type.
 */
export type BetterTableKey<Schema extends AnySchema> = TableKey<Schema>;

/**
 * Singularised alias of each table key (e.g. `"users"` -> `"user"`).
 *
 * @typeParam Schema - The Drizzle schema type.
 */
export type BetterAliasKey<Schema extends AnySchema> =
	import('./utils').AliasKey<Schema>;

/**
 * Valid repository keys: either the TypeScript table key or the database name.
 *
 * @typeParam Schema - The Drizzle schema type.
 */
export type BetterRepositoryKey<Schema extends AnySchema> =
	RepositoryKey<Schema>;

/**
 * Extracts the relations map for a specific table.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type BetterTableRelations<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = TableConfigFor<Schema, Name>['relations'];

/**
 * Alias for the underlying Drizzle `TableRelationalConfig` type.
 */
export type BetterRelationalConfig = TableRelationalConfig;

/**
 * The select model (row type) for a specific table.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type BetterRecord<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = import('./utils').SelectModelFor<Schema, Name>;
