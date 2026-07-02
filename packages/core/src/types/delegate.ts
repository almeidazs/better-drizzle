import type { AnyColumn, SQL, TableRelationalConfig } from 'drizzle-orm';

import type {
	CursorPaginationResult,
	OffsetPaginationResult,
} from './database';
import type {
	ExplainableResult,
	ExplainOptions,
	ExplainResult,
} from './explain';
import type {
	AnyPlugin,
	ClientExtensionsOf,
	ModelExtensionsOf,
	OperationArgsWithPlugins,
	PluginState,
} from './plugins';
import type {
	CursorArgs,
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
	ScalarKeysFor,
	SelectModelFor,
	SourceKeyFromDbName,
	TableConfigFor,
	TableFor,
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
 *
 * @example
 * ```ts
 * // Resolve to null when not found
 * const user = await db.user.findFirst({ where: { id: 1 } });
 * if (user) { /* handle found user *\/ }
 *
 * // Throw when not found
 * const user = await db.user.findFirst({ where: { id: 1 } }).throw();
 *
 * // Custom error factory
 * const user = await db.user.findFirst({ where: { id: 1 } }).throw(
 *   () => new Error('User not found')
 * );
 * ```
 */
export type ThrowingResult<T> = ExplainableResult<T | null> & {
	/** Throws a `BetterDrizzleError` with code `RESULT_NOT_FOUND` when the result is `null`. */
	throw(): Promise<import('./utils').NonNullish<T>>;
	/**
	 * Throws the error returned by the factory function when the result is `null`.
	 *
	 * @param factory - A function that returns the error to throw.
	 */
	throw(factory: ThrowFactory): Promise<import('./utils').NonNullish<T>>;
};

export type { ExplainableResult, ExplainOptions, ExplainResult };

/**
 * Result returned by batch operations (`createMany`, `updateMany`, `deleteMany`).
 *
 * @typeParam T - The row type returned by the operation (may be `never` when
 *   the database driver does not support `RETURNING`).
 *
 * @example
 * ```ts
 * const result = await db.user.createMany({
 *   data: [{ name: 'A' }, { name: 'B' }],
 * });
 * console.log(result.count); // 2
 * ```
 */
export interface BatchResult<T> {
	/** Number of rows affected by the operation. */
	count: number;
	/** The affected rows, when the driver supports returning them. */
	data?: T[];
}

/**
 * Column name that can be used as a duplicate-skip target for a specific table.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type SkipDuplicatesColumn<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<keyof InsertModelFor<Schema, Name>, string>;

/**
 * Duplicate-skip option for `create` and `createMany` operations.
 *
 * - `true` ignores duplicate conflicts for any supported unique target.
 * - `readonly ColumnName[]` ignores duplicates only for the specified columns
 *   when the dialect supports explicit conflict targets.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 *
 * @example
 * ```ts
 * await db.user.create({
 *   data: { email: 'alice@example.com', name: 'Alice' },
 *   skipDuplicates: true,
 * });
 *
 * await db.user.create({
 *   data: { email: 'alice@example.com', name: 'Alice' },
 *   skipDuplicates: ['email'],
 * });
 * ```
 */
export type SkipDuplicatesOption<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = boolean | readonly SkipDuplicatesColumn<Schema, Name>[];

/**
 * Arguments for the `create` operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 *
 * @example
 * ```ts
 * const args: CreateArgs<typeof schema, 'user'> = {
 *   data: { name: 'Alice', email: 'alice@example.com' },
 *   skipDuplicates: true,
 *   select: { id: true, name: true },
 *   meta: { requestId: 'abc-123' },
 * };
 * ```
 */
export interface CreateArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** The row data to insert. */
	data: InsertModelFor<Schema, Name>;
	/** Optional duplicate-skip handling for unique / primary key violations. */
	skipDuplicates?: SkipDuplicatesOption<Schema, Name>;
	/** Optional column / relation projection for the returned row. */
	select?: SelectInput<Schema, Name>;
	/** Optional relation-only projection for the returned row. */
	include?: IncludeInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the `update` operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 *
 * @example
 * ```ts
 * const args: UpdateArgs<typeof schema, 'user'> = {
 *   where: { id: 1 },
 *   data: { name: 'Bob' },
 *   select: { id: true, name: true },
 * };
 * ```
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
 * Arguments for the `createMany` operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 *
 * @example
 * ```ts
 * const result = await db.user.createMany({
 *   data: [
 *     { name: 'Alice', email: 'alice@example.com' },
 *     { name: 'Bob', email: 'bob@example.com' },
 *   ],
 *   skipDuplicates: true,
 * });
 * ```
 */
export interface CreateManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** Array of row data to insert. */
	data: InsertModelFor<Schema, Name>[];
	/** Optional duplicate-skip handling for unique / primary key violations. */
	skipDuplicates?: SkipDuplicatesOption<Schema, Name>;
	/** Optional column / relation projection for returned rows. */
	select?: SelectInput<Schema, Name>;
	/** Optional relation-only projection for returned rows. */
	include?: IncludeInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the `updateMany` operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 *
 * @example
 * ```ts
 * const result = await db.user.updateMany({
 *   where: { role: 'guest' },
 *   data: { active: false },
 * });
 * ```
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
 * Extracts a Drizzle column instance for a given table and key.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name   - The table key within the schema.
 * @typeParam Key    - The column key. Defaults to all scalar keys.
 */
export type TableColumnFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Key extends ScalarKeysFor<Schema, Name> = ScalarKeysFor<Schema, Name>,
> = Extract<TableFor<Schema, Name>['_']['columns'][Key], AnyColumn>;

/**
 * Row shape for the `updateEach` operation. Extends the select model
 * with an index signature for arbitrary additional properties.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name   - The table key within the schema.
 */
export type UpdateEachRow<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Partial<SelectModelFor<Schema, Name>> & Record<string, unknown>;

/**
 * Per-column update callback map for `updateEach`. Each key maps to a
 * function that receives the current row and returns the new value or
 * a SQL expression for that column.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name   - The table key within the schema.
 * @typeParam Row    - The row type passed to update callbacks.
 */
export type UpdateEachUpdateMap<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Row extends UpdateEachRow<Schema, Name>,
> = Partial<{
	[K in ScalarKeysFor<Schema, Name>]: (
		row: Row,
	) => SelectModelFor<Schema, Name>[K] | SQL;
}>;

/**
 * Arguments for the `updateEach` operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam Row - Source row type inferred from `data`.
 *
 * @example
 * ```ts
 * const result = await db.user.updateEach({
 *   by: schema.user.id,
 *   data: [
 *     { id: 1, name: 'Alice Updated' },
 *     { id: 2, name: 'Bob Updated' },
 *   ],
 *   update: {
 *     name: (row) => row.name,
 *   },
 *   select: { id: true, name: true },
 * });
 * ```
 */
export interface UpdateEachArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
	Row extends UpdateEachRow<Schema, Name> = UpdateEachRow<Schema, Name>,
> {
	/** Column used to match each source row against existing records. */
	by: TableColumnFor<Schema, Name>;
	/** Source rows that drive the per-row updates. */
	data: Row[];
	/** Per-column callbacks that resolve the new value for each source row. */
	update: UpdateEachUpdateMap<Schema, Name, Row>;
	/** Optional extra filter combined with the generated `by in (...)` predicate. */
	where?: WhereArg<Schema, Name>;
	/** Optional scalar projection for returned rows. */
	select?: SelectInput<Schema, Name>;
	/** Empty-input handling. Defaults to `'return'`. */
	onEmpty?: 'return' | 'throw';
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the `deleteMany` operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 *
 * @example
 * ```ts
 * const result = await db.user.deleteMany({
 *   where: { role: 'guest' },
 * });
 * ```
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
 * Arguments for the `delete` operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 *
 * @example
 * ```ts
 * const deleted = await db.user.delete({
 *   where: { id: 1 },
 *   select: { id: true, name: true },
 * });
 * ```
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
 * Arguments for the `upsert` operation.
 * Provides both the create and update payloads alongside a where clause
 * that determines whether to insert or update.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 *
 * @example
 * ```ts
 * const user = await db.user.upsert({
 *   where: { email: 'alice@example.com' },
 *   create: { name: 'Alice', email: 'alice@example.com' },
 *   update: { name: 'Alice Updated' },
 *   select: { id: true, name: true },
 * });
 * ```
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

/**
 * Extracts the column names from the insert model that can be used as conflict targets.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type UpsertManyTargetColumn<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<keyof InsertModelFor<Schema, Name>, string>;

/**
 * Defines the conflict target columns for `upsertMany`.
 * Can be a single column name or an array of column names.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type UpsertManyTarget<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> =
	| UpsertManyTargetColumn<Schema, Name>
	| readonly UpsertManyTargetColumn<Schema, Name>[];

/**
 * Defines the update values for columns when a conflict is detected.
 * Each key maps to either a direct value or a SQL expression.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type UpsertManyUpdateValue<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Partial<{
	[K in UpsertManyTargetColumn<Schema, Name>]:
		| InsertModelFor<Schema, Name>[K]
		| SQL;
}>;

/**
 * Represents the `EXCLUDED` table columns for PostgreSQL/SQLite conflict resolution.
 * Each key maps to a SQL reference to the excluded (proposed) value.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type UpsertManyExcluded<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	[K in UpsertManyTargetColumn<Schema, Name>]: SQL;
};

/**
 * Maps conflict target column names to their Drizzle column objects.
 * Used internally to build update expressions with proper column references.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type UpsertManyTableColumns<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	[K in UpsertManyTargetColumn<Schema, Name>]: AnyColumn;
};

/**
 * Context object passed to custom update strategy callbacks in `upsertMany`.
 * Provides access to the excluded (conflicting) row values, SQL builder, and column references.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type UpsertManyUpdateContext<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	/** Reference to the proposed values that would have been inserted. */
	excluded: UpsertManyExcluded<Schema, Name>;
	/** Drizzle SQL template tag for building expressions. */
	sql: typeof import('drizzle-orm').sql;
	/** Column references for the target table. */
	table: UpsertManyTableColumns<Schema, Name>;
};

/**
 * Defines the update strategy for `upsertMany` when a conflict is detected.
 *
 * - `'all'`: Update all columns with the proposed values.
 * - `string[]`: Update only the specified columns.
 * - `object`: Static update values mapping column names to values or SQL expressions.
 * - `function`: Callback that receives the update context and returns dynamic update values.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type UpsertManyUpdateStrategy<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> =
	| 'all'
	| readonly UpsertManyTargetColumn<Schema, Name>[]
	| UpsertManyUpdateValue<Schema, Name>
	| ((
			context: UpsertManyUpdateContext<Schema, Name>,
	  ) => UpsertManyUpdateValue<Schema, Name>);

/**
 * Arguments for the `upsertMany` operation.
 *
 * Performs a native batch upsert using an explicit conflict target.
 * Designed for high-throughput write paths where a single statement is
 * preferred over repeated `upsert()` calls.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 *
 * @example
 * ```ts
 * const result = await db.user.upsertMany({
 *   data: [
 *     { id: 1, email: 'alice@example.com', name: 'Alice' },
 *     { id: 2, email: 'bob@example.com', name: 'Bob' },
 *   ],
 *   target: 'id',
 *   update: 'all',
 * });
 *
 * const projected = await db.user.upsertMany({
 *   data: [{ id: 1, email: 'alice@example.com', name: 'Alice Updated' }],
 *   target: ['email'],
 *   update: ['name'],
 *   select: { id: true, name: true },
 * });
 * ```
 */
export interface UpsertManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
> {
	/** Rows to insert or update. */
	data: InsertModelFor<Schema, Name>[];
	/** Column or columns that define the conflict target. */
	target: UpsertManyTarget<Schema, Name>;
	/** Strategy used to build the update payload on conflict. */
	update: UpsertManyUpdateStrategy<Schema, Name>;
	/** Optional scalar projection for returned rows. */
	select?: SelectInput<Schema, Name>;
	/** Optional batch size for chunked native execution. */
	batchSize?: number;
	/** Optional SQL condition applied to the update side of the conflict path. */
	where?: SQL;
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

type BetterDrizzleClientExtensionShape = Record<string, unknown>;

type BetterDrizzleExtendsMethod<Client> = <
	Extension extends BetterDrizzleClientExtensionShape,
>(
	extension: Extension | ((client: Client) => Extension | undefined),
) => Client & Extension;

/**
 * The fully-typed client returned by {@link better}. Provides a delegate for
 * every table in the schema plus a unified `repository()` accessor.
 *
 * Each table key (e.g. `db.user`) exposes a {@link BetterDrizzleModelDelegate}
 * with all CRUD and query methods. The client also provides raw SQL helpers
 * (`$raw`, `$executeRaw`, `$rawUnsafe`), a `transaction()` method, and a
 * `repository()` accessor for dynamic table lookups.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam Plugins - The plugin tuple provided via `options.plugins`.
 *
 * @example
 * ```ts
 * import { better } from 'better-drizzle';
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 * import * as schema from './schema';
 *
 * const raw = drizzle('file:local.db');
 * const db = better(raw, { schema });
 *
 * // Direct table access
 * const users = await db.user.findMany({ where: { active: true } });
 *
 * // Dynamic repository lookup
 * const repo = db.repository('user');
 * const user = await repo.findFirst({ where: { id: 1 } });
 * ```
 */
export type BetterDrizzleClient<
	Schema extends AnySchema,
	Meta = import('./query').BetterMeta,
	Plugins extends readonly AnyPlugin[] = [],
> = BetterDrizzleClientByTableWithPlugins<Schema, Meta, Plugins> &
	ClientExtensionsOf<Plugins> & {
		/**
		 * Extends the current client with custom properties and helper methods.
		 *
		 * The same extension is reapplied to future `$withContext()` and
		 * `transaction()` clients derived from this instance.
		 *
		 * Pass a plain object for static values, or a callback when the extension
		 * needs to close over the bound client instance.
		 */
		extends: BetterDrizzleExtendsMethod<
			BetterDrizzleClient<Schema, Meta, Plugins>
		>;
		/**
		 * Returns a cloned client with default metadata merged into every
		 * operation, raw query, and transaction created from it.
		 *
		 * Per-call `meta` values override matching keys from this scoped context.
		 *
		 * @param meta - Default metadata to merge into subsequent calls.
		 * @returns A new client bound to the merged scoped metadata.
		 */
		$withContext(
			meta: Partial<Meta>,
		): BetterDrizzleClient<Schema, Meta, Plugins>;
		/**
		 * Executes a safe raw SQL query and returns rows.
		 *
		 * Accepts a tagged template literal or a Drizzle `sql` object.
		 * Raw queries bypass model transforms and CRUD hooks.
		 *
		 * @typeParam Row - The expected row shape.
		 * @param query - A tagged template or Drizzle SQL object.
		 * @param params - Interpolated values when using a tagged template.
		 * @returns A promise resolving to an array of rows.
		 *
		 * @example
		 * ```ts
		 * // Tagged template
		 * const rows = await db.$raw`SELECT * FROM users WHERE id = ${1}`;
		 *
		 * // Drizzle sql object
		 * import { sql } from 'drizzle-orm';
		 * const rows = await db.$raw(sql`SELECT * FROM users WHERE id = ${1}`);
		 * ```
		 */
		$raw<Row = unknown>(
			query: TemplateStringsArray,
			...params: unknown[]
		): Promise<Row[]>;
		/**
		 * Executes a safe raw SQL query and returns rows.
		 *
		 * @typeParam Row - The expected row shape.
		 * @param query - A Drizzle SQL object or SQLWrapper.
		 * @returns A promise resolving to an array of rows.
		 *
		 * @example
		 * ```ts
		 * import { sql } from 'drizzle-orm';
		 * const rows = await db.$raw<{ id: number }>(sql`SELECT id FROM users`);
		 * ```
		 */
		$raw<Row = unknown>(query: RawSql): Promise<Row[]>;
		/**
		 * Executes a safe raw SQL query and returns mapped rows.
		 *
		 * @typeParam Row - The raw row shape from the driver.
		 * @typeParam Mapped - The output row shape after mapping.
		 * @param query - A Drizzle SQL object or SQLWrapper.
		 * @param options - Raw options including a `map` function.
		 * @returns A promise resolving to an array of mapped rows.
		 *
		 * @example
		 * ```ts
		 * import { sql } from 'drizzle-orm';
		 * const users = await db.$raw(
		 *   sql`SELECT * FROM users`,
		 *   { map: (row) => ({ ...row, name: row.name.toUpperCase() }) },
		 * );
		 * ```
		 */
		$raw<Row = unknown, Mapped = Row>(
			query: RawSql,
			options: RawOptions<Row, Mapped, Meta>,
		): Promise<Mapped[]>;
		/**
		 * Executes a safe raw SQL statement (INSERT, UPDATE, DELETE) and
		 * returns a normalized result with `rowsAffected`.
		 *
		 * @param query - A tagged template or Drizzle SQL object.
		 * @param params - Interpolated values when using a tagged template.
		 * @returns A promise resolving to `{ rowsAffected: number }`.
		 *
		 * @example
		 * ```ts
		 * const result = await db.$executeRaw`UPDATE users SET active = ${true}`;
		 * console.log(result.rowsAffected);
		 * ```
		 */
		$executeRaw(
			query: TemplateStringsArray,
			...params: unknown[]
		): Promise<RawExecutionResult>;
		/**
		 * Executes a safe raw SQL statement and returns a normalized result.
		 *
		 * @param query - A Drizzle SQL object or SQLWrapper.
		 * @param options - Optional raw options.
		 * @returns A promise resolving to `{ rowsAffected: number }`.
		 *
		 * @example
		 * ```ts
		 * import { sql } from 'drizzle-orm';
		 * const result = await db.$executeRaw(sql`DELETE FROM users WHERE active = false`);
		 * ```
		 */
		$executeRaw(
			query: RawSql,
			options?: RawOptions<unknown, unknown, Meta>,
		): Promise<RawExecutionResult>;
		/**
		 * Executes a raw SQL string with optional parameter bindings.
		 *
		 * **Requires** `raw.allowUnsafe: true` in the client options.
		 * Use `?` placeholders for parameters.
		 *
		 * @typeParam Row - The expected row shape.
		 * @param query - A raw SQL string with `?` placeholders.
		 * @param params - Parameter values to bind.
		 * @returns A promise resolving to an array of rows.
		 *
		 * @example
		 * ```ts
		 * const users = await db.$rawUnsafe('SELECT * FROM users WHERE id = ?', [1]);
		 * ```
		 */
		$rawUnsafe<Row = unknown>(
			query: string,
			params?: unknown[],
		): Promise<Row[]>;
		/**
		 * Executes a raw SQL string and returns mapped rows.
		 *
		 * @typeParam Row - The raw row shape from the driver.
		 * @typeParam Mapped - The output row shape after mapping.
		 * @param query - A raw SQL string with `?` placeholders.
		 * @param params - Parameter values to bind.
		 * @param options - Raw options including a `map` function.
		 * @returns A promise resolving to an array of mapped rows.
		 *
		 * @example
		 * ```ts
		 * const users = await db.$rawUnsafe(
		 *   'SELECT * FROM users WHERE id = ?',
		 *   [1],
		 *   { map: (row) => ({ ...row, name: row.name.toUpperCase() }) },
		 * );
		 * ```
		 */
		$rawUnsafe<Row = unknown, Mapped = Row>(
			query: string,
			params: unknown[] | undefined,
			options: RawOptions<Row, Mapped, Meta>,
		): Promise<Mapped[]>;
		/**
		 * Runs the callback inside a database transaction and returns its result.
		 *
		 * The transaction client passed to the callback is a full
		 * {@link BetterDrizzleTransactionClient} with `transaction()`, `rollback()`,
		 * `afterCommit()`, and `afterRollback()` methods.
		 *
		 * Nested calls create savepoints automatically.
		 *
		 * @typeParam T - The return type of the callback.
		 * @param callback - A function receiving the transaction client.
		 * @param options - Optional transaction options (isolation, retries, timeout, etc.).
		 * @returns A promise resolving to the callback's return value.
		 *
		 * @example
		 * ```ts
		 * const result = await db.transaction(async (tx) => {
		 *   const user = await tx.user.findFirst({ where: { id: 1 } });
		 *   await tx.user.update({ where: { id: 1 }, data: { active: false } });
		 *   return user;
		 * });
		 *
		 * // With options
		 * await db.transaction(async (tx) => {
		 *   // ...
		 * }, { isolationLevel: 'serializable', timeoutMs: 5000 });
		 * ```
		 */
		transaction<T>(
			callback: (
				tx: BetterDrizzleTransactionClient<Schema, Meta, Plugins>,
			) => Promise<T> | T,
			options?: TransactionOptions & { meta?: Meta },
		): Promise<T>;
		/**
		 * Retrieves the model delegate for the given repository name.
		 *
		 * The name can be either the TypeScript table key (e.g. `"user"`)
		 * or the database table name (e.g. `"users"`). Throws if no
		 * matching repository is found.
		 *
		 * @typeParam Name - The table key or database name to resolve.
		 * @param name - Table key or database name.
		 * @returns The model delegate for the specified table.
		 *
		 * @example
		 * ```ts
		 * // By TypeScript key
		 * const userRepo = db.repository('user');
		 * await userRepo.create({ data: { name: 'Alice' } });
		 *
		 * // By database name
		 * const userRepo = db.repository('users');
		 * await userRepo.findMany();
		 * ```
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
 * Access delegates via direct table keys (e.g. `db.user`) or through
 * {@link BetterDrizzleClient.repository}.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 * @typeParam Plugins - The plugin tuple.
 * @typeParam ModelExtension - Extra properties added by plugins via `extendModel`.
 *
 * @example
 * ```ts
 * const user = db.user;
 *
 * // CRUD
 * await user.create({ data: { name: 'Alice', email: 'alice@example.com' } });
 * await user.findMany({ where: { active: true } });
 * await user.update({ where: { id: 1 }, data: { name: 'Bob' } });
 * await user.delete({ where: { id: 1 } });
 *
 * // Batch operations
 * await user.createMany({ data: [{ name: 'A' }, { name: 'B' }] });
 * await user.updateEach({
 *   by: schema.users.id,
 *   data: [{ id: 1, active: false }],
 *   update: { active: (row) => row.active },
 * });
 * await user.updateMany({ data: { active: false } });
 * await user.deleteMany({ where: { role: 'guest' } });
 *
 * // Queries
 * await user.findFirst({ where: { email: 'alice@example.com' } });
 * await user.findUnique({ where: { id: 1 } });
 * await user.findOne({ where: { id: 1 } });
 * await user.count({ where: { active: true } });
 * await user.exists({ where: { email: 'test@example.com' } });
 * await user.paginate({ limit: 10, orderBy: { name: 'asc' } });
 *
 * // Upsert
 * await user.upsert({
 *   where: { id: 1 },
 *   create: { name: 'Alice', email: 'alice@example.com' },
 *   update: { name: 'Alice Updated' },
 * });
 * ```
 */
export type BetterDrizzleModelDelegate<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = import('./query').BetterMeta,
	Plugins extends readonly AnyPlugin[] = [],
	ModelExtension extends Record<string, unknown> = ModelExtensionsOf<
		Plugins,
		Schema,
		Name,
		Meta
	>,
> = {
	/**
	 * Internal model metadata useful for plugins.
	 *
	 * @property dbName - The database table name.
	 * @property name - The TypeScript table key.
	 * @method hasColumn - Checks whether a column exists on this table.
	 */
	$model: {
		dbName: string;
		/** Checks whether a column with the given name exists on this table. */
		hasColumn(column: string): boolean;
		name: Name;
	};
	/**
	 * Ephemeral plugin state carried by cloned delegates.
	 *
	 * Use `$withState()` to create a delegate with merged plugin state,
	 * and `$withoutPlugins()` to bypass plugin hooks and transforms.
	 */
	$state: PluginState;
	/**
	 * Returns a cloned delegate with merged plugin state.
	 *
	 * Useful when plugins need to carry per-request or per-operation state
	 * through the delegate without mutating the original.
	 *
	 * @param state - Plugin state to merge into the cloned delegate.
	 * @returns A new delegate with the merged state.
	 *
	 * @example
	 * ```ts
	 * const traced = db.user.$withState({ traceId: 'abc-123' });
	 * await traced.findMany(); // plugins can read traceId from state
	 * ```
	 */
	$withState(
		state: PluginState,
	): BetterDrizzleModelDelegate<Schema, Name, Meta, Plugins, ModelExtension>;
	/**
	 * Returns a cloned delegate that bypasses plugin hooks and transforms.
	 *
	 * Useful when you need to perform a raw operation without triggering
	 * plugin logic (e.g. soft-delete filters).
	 *
	 * @returns A new delegate with all plugin hooks and transforms disabled.
	 *
	 * @example
	 * ```ts
	 * // Find all users, including soft-deleted ones
	 * const allUsers = await db.user.$withoutPlugins().findMany();
	 * ```
	 */
	$withoutPlugins(): BetterDrizzleModelDelegate<
		Schema,
		Name,
		Meta,
		Plugins,
		ModelExtension
	>;
	/**
	 * Counts the number of matching rows.
	 *
	 * @param args - Optional filter and cursor arguments.
	 * @returns A promise resolving to the count of matching rows.
	 *
	 * @example
	 * ```ts
	 * // Count all rows
	 * const total = await db.user.count();
	 *
	 * // Count with filter
	 * const activeCount = await db.user.count({
	 *   where: { active: true },
	 * });
	 * ```
	 */
	count(
		args?: OperationArgsWithPlugins<
			import('./query').CountArgs<Schema, Name, Meta>,
			Plugins,
			'count'
		>,
	): ExplainableResult<number>;
	/**
	 * Returns `true` when at least one matching row exists.
	 *
	 * More efficient than `count` when you only need to check existence.
	 *
	 * @param args - Optional filter and cursor arguments.
	 * @returns A promise resolving to `true` if a match exists, `false` otherwise.
	 *
	 * @example
	 * ```ts
	 * const hasAdmin = await db.user.exists({
	 *   where: { role: 'admin' },
	 * });
	 * ```
	 */
	exists(
		args?: OperationArgsWithPlugins<
			import('./query').ExistsArgs<Schema, Name, Meta>,
			Plugins,
			'exists'
		>,
	): ExplainableResult<boolean>;
	/**
	 * Inserts a single row and returns the created record.
	 *
	 * When `skipDuplicates` is enabled, returns `null` if the insert was
	 * skipped due to a duplicate conflict. By default, duplicate conflicts
	 * throw.
	 *
	 * @param args - The row data and optional duplicate-skip/select/include options.
	 * @returns A promise resolving to the created row, or `null` when
	 *   `skipDuplicates` skips the insert.
	 *
	 * @example
	 * ```ts
	 * // Basic create
	 * const user = await db.user.create({
	 *   data: { name: 'Alice', email: 'alice@example.com' },
	 * });
	 *
	 * // Create with conflict handling
	 * const user = await db.user.create({
	 *   data: { id: 1, name: 'Alice' },
	 *   skipDuplicates: true,
	 * });
	 *
	 * // Create with specific duplicate targets
	 * const user = await db.user.create({
	 *   data: { email: 'alice@example.com', name: 'Alice' },
	 *   skipDuplicates: ['email'],
	 * });
	 *
	 * // Create with relation inclusion
	 * const user = await db.user.create({
	 *   data: { name: 'Alice', email: 'alice@example.com' },
	 *   include: { posts: true },
	 * });
	 * ```
	 */
	create<
		Args extends OperationArgsWithPlugins<
			CreateArgs<Schema, Name, Meta>,
			Plugins,
			'create'
		>,
	>(args: Args): Promise<PayloadForArgs<Schema, Name, Args>>;
	/**
	 * Inserts multiple rows in a single statement.
	 *
	 * Returns a `BatchResult` with `count` reflecting the number of rows
	 * actually inserted. When `skipDuplicates` is enabled, skipped rows are not
	 * counted.
	 *
	 * @param args - The array of row data and optional duplicate-skip/select options.
	 * @returns A promise resolving to `{ count, data? }`.
	 *
	 * @example
	 * ```ts
	 * const result = await db.user.createMany({
	 *   data: [
	 *     { name: 'Alice', email: 'alice@example.com' },
	 *     { name: 'Bob', email: 'bob@example.com' },
	 *   ],
	 * });
	 * console.log(result.count); // 2
	 *
	 * // With conflict handling
	 * const result = await db.user.createMany({
	 *   data: [{ name: 'Alice', email: 'alice@example.com' }],
	 *   skipDuplicates: true,
	 * });
	 * ```
	 */
	createMany<
		Args extends OperationArgsWithPlugins<
			CreateManyArgs<Schema, Name, Meta>,
			Plugins,
			'createMany'
		>,
	>(args: Args): Promise<BatchResult<PayloadForArgs<Schema, Name, Args>>>;
	/**
	 * Inserts a row if no match is found, otherwise updates it.
	 *
	 * Uses native conflict resolution when possible (PostgreSQL, SQLite),
	 * falling back to a read-then-write strategy on other dialects.
	 *
	 * @param args - The where filter, create data, update data, and optional
	 *   select/include options.
	 * @returns A promise resolving to the inserted or updated row.
	 *
	 * @example
	 * ```ts
	 * const user = await db.user.upsert({
	 *   where: { email: 'alice@example.com' },
	 *   create: { name: 'Alice', email: 'alice@example.com', role: 'user' },
	 *   update: { name: 'Alice Updated' },
	 * });
	 *
	 * // With select
	 * const user = await db.user.upsert({
	 *   where: { email: 'alice@example.com' },
	 *   create: { name: 'Alice', email: 'alice@example.com' },
	 *   update: { name: 'Alice Updated' },
	 *   select: { id: true, name: true },
	 * });
	 * ```
	 */
	upsert<
		Args extends OperationArgsWithPlugins<
			UpsertArgs<Schema, Name, Meta>,
			Plugins,
			'upsert'
		>,
	>(args: Args): Promise<PayloadForArgs<Schema, Name, Args>>;
	/**
	 * Performs a native batch upsert against an explicit conflict target.
	 *
	 * Returns a `BatchResult` with `count` reflecting the number of rows
	 * inserted or updated by the statement. Supports `select`, but not
	 * relation `include`, to keep the hot path as direct as possible.
	 *
	 * @param args - Batch upsert rows, conflict target, update strategy, and
	 *   optional `select` / `batchSize` / `where` options.
	 * @returns A promise resolving to `{ count, data? }`.
	 *
	 * @example
	 * ```ts
	 * const result = await db.user.upsertMany({
	 *   data: [
	 *     { id: 1, email: 'alice@example.com', name: 'Alice' },
	 *     { id: 2, email: 'bob@example.com', name: 'Bob' },
	 *   ],
	 *   target: 'id',
	 *   update: 'all',
	 * });
	 *
	 * const projected = await db.user.upsertMany({
	 *   data: [{ id: 1, email: 'alice@example.com', name: 'Alice Updated' }],
	 *   target: ['email'],
	 *   update: ['name'],
	 *   select: { id: true, name: true },
	 * });
	 * ```
	 */
	upsertMany<
		Args extends OperationArgsWithPlugins<
			UpsertManyArgs<Schema, Name, Meta>,
			Plugins,
			'upsertMany'
		>,
	>(args: Args): Promise<BatchResult<PayloadForArgs<Schema, Name, Args>>>;
	/**
	 * Returns all matching rows.
	 *
	 * @param args - Optional filter, projection, ordering, and pagination arguments.
	 * @returns A promise resolving to an array of matching rows.
	 *
	 * @example
	 * ```ts
	 * // All users
	 * const users = await db.user.findMany();
	 *
	 * // With filter
	 * const activeUsers = await db.user.findMany({
	 *   where: { active: true },
	 * });
	 *
	 * // With select (column projection)
	 * const users = await db.user.findMany({
	 *   select: { id: true, name: true },
	 * });
	 *
	 * // With relations
	 * const usersWithPosts = await db.user.findMany({
	 *   include: { posts: true },
	 * });
	 *
	 * // With ordering and pagination
	 * const users = await db.user.findMany({
	 *   where: { role: 'user' },
	 *   orderBy: { name: 'asc' },
	 *   take: 10,
	 *   skip: 0,
	 * });
	 * ```
	 */
	findMany<
		Args extends OperationArgsWithPlugins<
			QueryArgs<Schema, Name, Meta>,
			Plugins,
			'findMany'
		>,
	>(args?: Args): ExplainableResult<PayloadForArgs<Schema, Name, Args>[]>;
	/**
	 * Updates a single matching row and returns the updated record.
	 *
	 * Returns a `ThrowingResult` – if no row matches, calling `.throw()`
	 * on the result will throw a `BetterDrizzleError`. Without `.throw()`,
	 * the result resolves to `null` when no row is found.
	 *
	 * @param args - The where filter, partial data, and optional select/include.
	 * @returns A throwing-aware promise resolving to the updated row or `null`.
	 *
	 * @example
	 * ```ts
	 * // Update and get result (null if not found)
	 * const updated = await db.user.update({
	 *   where: { id: 1 },
	 *   data: { name: 'Bob' },
	 * });
	 *
	 * // Update or throw if not found
	 * const updated = await db.user.update({
	 *   where: { id: 1 },
	 *   data: { name: 'Bob' },
	 * }).throw();
	 *
	 * // Update with select
	 * const updated = await db.user.update({
	 *   where: { id: 1 },
	 *   data: { name: 'Bob' },
	 *   select: { id: true, name: true },
	 * });
	 * ```
	 */
	update<
		Args extends OperationArgsWithPlugins<
			UpdateArgs<Schema, Name, Meta>,
			Plugins,
			'update'
		>,
	>(args: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/**
	 * Updates all matching rows and returns the affected count.
	 *
	 * @param args - Optional filter and partial data. When `where` is omitted,
	 *   all rows are updated.
	 * @returns A promise resolving to `{ count }` with the number of affected rows.
	 *
	 * @example
	 * ```ts
	 * // Deactivate all users
	 * const result = await db.user.updateMany({
	 *   data: { active: false },
	 * });
	 * console.log(result.count);
	 *
	 * // Deactivate only guests
	 * const result = await db.user.updateMany({
	 *   where: { role: 'guest' },
	 *   data: { active: false },
	 * });
	 * ```
	 */
	updateMany(
		args: OperationArgsWithPlugins<
			UpdateManyArgs<Schema, Name, Meta>,
			Plugins,
			'updateMany'
		>,
	): Promise<BatchResult<never>>;
	/**
	 * Updates multiple rows with different values in one statement.
	 *
	 * Uses the provided `by` column to build `CASE` expressions per updated
	 * column. Supports scalar `select`, but not relation `include`.
	 *
	 * @param args - Match column, source rows, update callbacks, and optional
	 *   `where` / `select` / `onEmpty` options.
	 * @returns A promise resolving to `{ count, data? }`.
	 */
	updateEach<
		Row extends UpdateEachRow<Schema, Name>,
		Args extends OperationArgsWithPlugins<
			UpdateEachArgs<Schema, Name, Meta, Row>,
			Plugins,
			'updateEach'
		>,
	>(args: Args): Promise<BatchResult<PayloadForArgs<Schema, Name, Args>>>;
	/**
	 * Returns the first matching row (alias for {@link findFirst}).
	 *
	 * Returns a `ThrowingResult` – call `.throw()` to throw when no row is found.
	 *
	 * @param args - Optional filter, projection, ordering, and cursor arguments.
	 * @returns A throwing-aware promise resolving to the first matching row or `null`.
	 *
	 * @example
	 * ```ts
	 * const user = await db.user.findOne({
	 *   where: { email: 'alice@example.com' },
	 * });
	 *
	 * // Or throw if not found
	 * const user = await db.user.findOne({
	 *   where: { email: 'alice@example.com' },
	 * }).throw();
	 * ```
	 */
	findOne<
		Args extends OperationArgsWithPlugins<
			QueryArgs<Schema, Name, Meta>,
			Plugins,
			'findOne'
		>,
	>(args?: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/**
	 * Returns the first matching row.
	 *
	 * Returns a `ThrowingResult` – call `.throw()` to throw when no row is found.
	 *
	 * @param args - Optional filter, projection, ordering, and cursor arguments.
	 * @returns A throwing-aware promise resolving to the first matching row or `null`.
	 *
	 * @example
	 * ```ts
	 * const user = await db.user.findFirst({
	 *   where: { role: 'admin' },
	 *   orderBy: { createdAt: 'desc' },
	 * });
	 *
	 * // Throw if not found
	 * const user = await db.user.findFirst({
	 *   where: { role: 'admin' },
	 * }).throw();
	 * ```
	 */
	findFirst<
		Args extends OperationArgsWithPlugins<
			QueryArgs<Schema, Name, Meta>,
			Plugins,
			'findFirst'
		>,
	>(args?: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/**
	 * Returns exactly one matching row; throws if not found.
	 *
	 * Unlike `findFirst`, this method always expects exactly one result.
	 * Returns a `ThrowingResult` – call `.throw()` to throw when no row
	 * is found, or use it directly for a promise that resolves to the row.
	 *
	 * @param args - Filter, projection, ordering, and cursor arguments.
	 * @returns A throwing-aware promise resolving to the matching row.
	 *
	 * @example
	 * ```ts
	 * const user = await db.user.findUnique({
	 *   where: { id: 1 },
	 * });
	 *
	 * // Throw if not found
	 * const user = await db.user.findUnique({
	 *   where: { id: 1 },
	 * }).throw();
	 *
	 * // With relations
	 * const user = await db.user.findUnique({
	 *   where: { id: 1 },
	 *   include: { posts: true },
	 * });
	 * ```
	 */
	findUnique<
		Args extends OperationArgsWithPlugins<
			QueryArgs<Schema, Name, Meta>,
			Plugins,
			'findUnique'
		>,
	>(args: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/**
	 * Returns an offset-based paginated result set with page metadata.
	 *
	 * @param args - Offset pagination options including `limit`, `skip`, and `orderBy`.
	 * @returns A promise resolving to `{ data, pagination }`.
	 *
	 * @example
	 * ```ts
	 * // Offset pagination
	 * const page = await db.user.paginate({
	 *   limit: 10,
	 *   orderBy: { name: 'asc' },
	 * });
	 * console.log(page.data);        // rows
	 * console.log(page.pagination);  // { type, page, perPage, total, pageCount, hasNext, hasPrevious }
	 * ```
	 */
	paginate<
		Args extends OperationArgsWithPlugins<
			PaginationArgs<Schema, Name, Meta>,
			Plugins,
			'paginate'
		>,
	>(
		args: Args,
	): ExplainableResult<
		OffsetPaginationResult<PayloadForArgs<Schema, Name, Args>>
	>;
	/**
	 * Returns a cursor-based result set with navigation cursors.
	 *
	 * Accepts either `after` or `before`, but never both.
	 */
	cursor<
		Args extends OperationArgsWithPlugins<
			CursorArgs<Schema, Name, Meta>,
			Plugins,
			'cursor'
		>,
	>(
		args: Args,
	): ExplainableResult<
		CursorPaginationResult<PayloadForArgs<Schema, Name, Args>>
	>;
	/**
	 * Deletes a single matching row and returns the deleted record.
	 *
	 * Returns a `ThrowingResult` – call `.throw()` to throw when no row is found.
	 *
	 * @param args - The where filter and optional select/include options.
	 * @returns A throwing-aware promise resolving to the deleted row or `null`.
	 *
	 * @example
	 * ```ts
	 * // Delete and get result
	 * const deleted = await db.user.delete({
	 *   where: { id: 1 },
	 * });
	 *
	 * // Delete or throw if not found
	 * const deleted = await db.user.delete({
	 *   where: { id: 1 },
	 * }).throw();
	 *
	 * // Delete with select
	 * const deleted = await db.user.delete({
	 *   where: { id: 1 },
	 *   select: { id: true, name: true },
	 * });
	 * ```
	 */
	delete<
		Args extends OperationArgsWithPlugins<
			DeleteArgs<Schema, Name, Meta>,
			Plugins,
			'delete'
		>,
	>(args: Args): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/**
	 * Deletes all matching rows and returns the affected count.
	 *
	 * @param args - Optional filter. When `where` is omitted, all rows are deleted.
	 * @returns A promise resolving to `{ count }` with the number of deleted rows.
	 *
	 * @example
	 * ```ts
	 * // Delete all guests
	 * const result = await db.user.deleteMany({
	 *   where: { role: 'guest' },
	 * });
	 * console.log(result.count);
	 *
	 * // Delete all rows (use with caution!)
	 * const result = await db.user.deleteMany({});
	 * ```
	 */
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
 * Use this to constrain generic parameters that accept a table name.
 *
 * @typeParam Schema - The Drizzle schema type.
 *
 * @example
 * ```ts
 * type TableName = BetterTableKey<typeof schema>; // 'user' | 'post' | ...
 * ```
 */
export type BetterTableKey<Schema extends AnySchema> = TableKey<Schema>;

/**
 * Singularised alias of each table key in the schema. For example,
 * `"users"` becomes `"user"`.
 *
 * @typeParam Schema - The Drizzle schema type.
 */
export type BetterAliasKey<Schema extends AnySchema> =
	import('./utils').AliasKey<Schema>;

/**
 * Valid repository keys: either the TypeScript table key or the database name.
 *
 * @typeParam Schema - The Drizzle schema type.
 *
 * @example
 * ```ts
 * type Keys = BetterRepositoryKey<typeof schema>; // 'user' | 'users' | ...
 * ```
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
 * The select model (row type) for a specific table. This is the shape
 * of a row returned from queries on the given table.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 *
 * @example
 * ```ts
 * type UserRow = BetterRecord<typeof schema, 'user'>;
 * // { id: number; name: string; email: string; ... }
 * ```
 */
export type BetterRecord<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = import('./utils').SelectModelFor<Schema, Name>;
