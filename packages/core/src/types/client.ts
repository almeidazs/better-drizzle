import type {
	ExtractTablesWithRelations,
	FindTableByDBName,
	InferInsertModel,
	InferSelectModel,
	Many,
	One,
	SQL,
	SQLWrapper,
	Table,
	TableRelationalConfig,
} from 'drizzle-orm';

import type { Plugin } from '.';
import type { PaginationOptions, PaginationResult } from './database';

/**
 * Represents any Drizzle schema object – a record mapping table names to their
 * Drizzle `Table` definitions (or arbitrary values for non-table entries).
 */
export type AnySchema = Record<string, unknown>;

type TablesConfig<Schema extends AnySchema> =
	ExtractTablesWithRelations<Schema>;
type TableKey<Schema extends AnySchema> = Extract<
	keyof TablesConfig<Schema>,
	keyof Schema
>;
type Singularize<Key extends string> = Key extends `${infer Stem}ies`
	? `${Stem}y`
	: Key extends `${infer Stem}s`
		? Stem
		: Key;
type AliasKey<Schema extends AnySchema> = Singularize<
	Extract<TableKey<Schema>, string>
>;

type DbNameKey<Schema extends AnySchema> = Extract<
	{
		[K in TableKey<Schema>]: TableConfigFor<Schema, K>['dbName'];
	}[TableKey<Schema>],
	string
>;
type SourceKeyFromDbName<
	Schema extends AnySchema,
	DbName extends string,
> = Extract<
	TableKey<Schema>,
	{
		[K in TableKey<Schema>]: TableConfigFor<
			Schema,
			K
		>['dbName'] extends DbName
			? K
			: never;
	}[TableKey<Schema>]
>;
type TableConfigFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = TablesConfig<Schema>[Name];
type SafeKeys<T> = [T] extends [never] ? never : Extract<keyof T, string>;
type TableFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<Schema[Name], Table>;
type SelectModelFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = InferSelectModel<TableFor<Schema, Name>>;
type InsertModelFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = InferInsertModel<TableFor<Schema, Name>>;
type RelationKeysFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = SafeKeys<TableConfigFor<Schema, Name>['relations']>;
type ScalarKeysFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Exclude<keyof SelectModelFor<Schema, Name>, RelationKeysFor<Schema, Name>>;
type RelatedConfigFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = FindTableByDBName<
	TablesConfig<Schema>,
	TableConfigFor<
		Schema,
		Name
	>['relations'][RelationName]['referencedTableName']
>;
type RelatedNameFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = Extract<
	RelatedConfigFor<Schema, Name, RelationName>['tsName'],
	TableKey<Schema>
>;
type RelationFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = TableConfigFor<Schema, Name>['relations'][RelationName];

type NonNullish<T> = Exclude<T, null | undefined>;
type SortOrder = 'asc' | 'desc';
type QueryMode = 'default' | 'insensitive';

type StringFilter<T> = {
	equals?: T;
	in?: T[];
	notIn?: T[];
	contains?: string;
	startsWith?: string;
	endsWith?: string;
	mode?: QueryMode;
	not?: T | Omit<StringFilter<T>, 'not'>;
};

type ComparableFilter<T> = {
	equals?: T;
	in?: T[];
	notIn?: T[];
	lt?: T;
	lte?: T;
	gt?: T;
	gte?: T;
	not?: T | Omit<ComparableFilter<T>, 'not'>;
};

type BooleanFilter<T> = {
	equals?: T;
	not?: T | Omit<BooleanFilter<T>, 'not'>;
};

type ScalarFilter<T> =
	NonNullish<T> extends string
		? StringFilter<T>
		: NonNullish<T> extends number | bigint | Date
			? ComparableFilter<T>
			: NonNullish<T> extends boolean
				? BooleanFilter<T>
				: {
						equals?: T;
						not?: T | { equals?: T };
					};

type ScalarWhereField<T> =
	| T
	| ScalarFilter<T>
	| (null extends T ? null : never);

type RelationWhereInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> =
	RelationFor<Schema, Name, RelationName> extends Many<string>
		? {
				some?: WhereInput<
					Schema,
					RelatedNameFor<Schema, Name, RelationName>
				>;
				every?: WhereInput<
					Schema,
					RelatedNameFor<Schema, Name, RelationName>
				>;
				none?: WhereInput<
					Schema,
					RelatedNameFor<Schema, Name, RelationName>
				>;
			}
		: RelationFor<Schema, Name, RelationName> extends One<string, boolean>
			? {
					is?: WhereInput<
						Schema,
						RelatedNameFor<Schema, Name, RelationName>
					> | null;
					isNot?: WhereInput<
						Schema,
						RelatedNameFor<Schema, Name, RelationName>
					> | null;
				}
			: never;

/**
 * Comprehensive where-clause input for a specific table. Supports scalar
 * filters, logical combinators (`AND`, `OR`, `NOT`), and nested relation
 * filters (`some`, `every`, `none` for one-to-many; `is`, `isNot` for
 * many-to-one / one-to-one).
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type WhereInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	/** Logical AND – all sub-conditions must match. */
	AND?: WhereInput<Schema, Name>[];
	/** Logical OR – at least one sub-condition must match. */
	OR?: WhereInput<Schema, Name>[];
	/** Logical NOT – negates the sub-condition(s). */
	NOT?: WhereInput<Schema, Name> | WhereInput<Schema, Name>[];
} & {
	[K in ScalarKeysFor<Schema, Name>]?: ScalarWhereField<
		SelectModelFor<Schema, Name>[K]
	>;
} & {
	[K in RelationKeysFor<Schema, Name>]?: RelationWhereInput<Schema, Name, K>;
};

/**
 * Accepted where-clause value. May be a structured {@link WhereInput}, a raw
 * Drizzle `SQL` expression, or any `SQLWrapper`.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type WhereArg<Schema extends AnySchema, Name extends TableKey<Schema>> =
	| WhereInput<Schema, Name>
	| SQL
	| SQLWrapper;

type SelectRelationArg<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = true | QueryArgs<Schema, RelatedNameFor<Schema, Name, RelationName>>;

/**
 * Select projection for a query. Keys represent scalar columns (set to `true`
 * to include) or relations (set to `true` or a nested {@link QueryArgs}).
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type SelectInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	[K in ScalarKeysFor<Schema, Name>]?: boolean;
} & {
	[K in RelationKeysFor<Schema, Name>]?: SelectRelationArg<Schema, Name, K>;
};

/**
 * Include projection for a query. Only relations are selectable here; scalar
 * columns are always included in the result when `include` is used.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type IncludeInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	[K in RelationKeysFor<Schema, Name>]?: SelectRelationArg<Schema, Name, K>;
};

type OrderByField<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Partial<Record<ScalarKeysFor<Schema, Name>, SortOrder>>;

/**
 * Sort specification for a query result set. Can be a single field map or an
 * array of field maps for multi-column ordering.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type OrderByInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = OrderByField<Schema, Name> | OrderByField<Schema, Name>[];

/**
 * Custom metadata object attached to every operation. Extend this to carry
 * request-scoped context (e.g. user ID, trace ID) through hooks.
 */
export type BetterMeta = Record<string, unknown>;

/**
 * Cursor position used for cursor-based pagination. Contains the scalar
 * column values that identify a specific row.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 */
export type CursorInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Partial<Pick<SelectModelFor<Schema, Name>, ScalarKeysFor<Schema, Name>>>;

/**
 * Arguments accepted by read operations (`findMany`, `findFirst`, `findOne`,
 * `findUnique`). Controls filtering, projection, ordering, pagination, and
 * cursor position.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface QueryArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	/** Filter to restrict which rows are returned. */
	where?: WhereArg<Schema, Name>;
	/** Column and relation projection for the result set. */
	select?: SelectInput<Schema, Name>;
	/** Relation-only projection (all scalar columns are included). */
	include?: IncludeInput<Schema, Name>;
	/** Sort order for the result set. */
	orderBy?: OrderByInput<Schema, Name>;
	/** Maximum number of rows to return (use a negative value to reverse ordering). */
	take?: number;
	/** Number of rows to skip from the start of the result set. */
	skip?: number;
	/** Cursor position for cursor-based pagination. */
	cursor?: CursorInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the {@link BetterDrizzleModelDelegate.count} operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type CountArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> = Pick<QueryArgs<Schema, Name, Meta>, 'where' | 'cursor' | 'meta'>;

/**
 * Arguments for the {@link BetterDrizzleModelDelegate.exists} operation.
 * Identical in shape to {@link CountArgs}.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type ExistsArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> = CountArgs<Schema, Name, Meta>;

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
	throw(): Promise<NonNullish<T>>;
	throw(factory: ThrowFactory): Promise<NonNullish<T>>;
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

/**
 * Arguments for the {@link BetterDrizzleModelDelegate.paginate} operation.
 * Combines {@link QueryArgs} with pagination-specific options.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export type PaginationArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> = QueryArgs<Schema, Name, Meta> &
	PaginationOptions<SelectModelFor<Schema, Name>>;

/**
 * Arguments for the {@link BetterDrizzleModelDelegate.create} operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface CreateArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	/** The row data to insert. */
	data: InsertModelFor<Schema, Name>;
	/** Optional column / relation projection for the returned row. */
	select?: SelectInput<Schema, Name>;
	/** Optional relation-only projection for the returned row. */
	include?: IncludeInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the {@link BetterDrizzleModelDelegate.update} operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface UpdateArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
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
 * Arguments for the {@link BetterDrizzleModelDelegate.createMany} operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface CreateManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	/** Array of row data to insert. */
	data: InsertModelFor<Schema, Name>[];
	/** Optional column / relation projection for returned rows. */
	select?: SelectInput<Schema, Name>;
	/** Optional relation-only projection for returned rows. */
	include?: IncludeInput<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the {@link BetterDrizzleModelDelegate.updateMany} operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface UpdateManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	/** Optional filter. When omitted, all rows are updated. */
	where?: WhereArg<Schema, Name>;
	/** Partial column values to apply to every matched row. */
	data: Partial<InsertModelFor<Schema, Name>>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the {@link BetterDrizzleModelDelegate.deleteMany} operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface DeleteManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	/** Optional filter. When omitted, all rows are deleted. */
	where?: WhereArg<Schema, Name>;
	/** Custom metadata forwarded to hooks. */
	meta?: Meta;
}

/**
 * Arguments for the {@link BetterDrizzleModelDelegate.delete} operation.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 */
export interface DeleteArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
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
 * Arguments for the {@link BetterDrizzleModelDelegate.upsert} operation.
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
	Meta = BetterMeta,
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

type RelationPayloadFromArg<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
	Arg,
> = Arg extends true
	? DefaultPayload<Schema, RelatedNameFor<Schema, Name, RelationName>>
	: Arg extends QueryArgs<Schema, RelatedNameFor<Schema, Name, RelationName>>
		? PayloadForArgs<
				Schema,
				RelatedNameFor<Schema, Name, RelationName>,
				Arg
			>
		: never;

type SelectedScalarPayload<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Select extends SelectInput<Schema, Name>,
> = {
	[K in keyof SelectModelFor<Schema, Name> as K extends keyof Select
		? Select[K] extends true
			? K
			: never
		: never]: SelectModelFor<Schema, Name>[K];
};

type SelectedRelationPayload<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Select extends SelectInput<Schema, Name>,
> = {
	[K in RelationKeysFor<Schema, Name> as K extends keyof Select
		? Select[K] extends
				| true
				| QueryArgs<Schema, RelatedNameFor<Schema, Name, K>>
			? K
			: never
		: never]: RelationFor<Schema, Name, K> extends Many<string>
		? RelationPayloadFromArg<Schema, Name, K, Select[K]>[]
		: RelationPayloadFromArg<Schema, Name, K, Select[K]> | null;
};

type IncludedRelationPayload<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Include extends IncludeInput<Schema, Name>,
> = SelectModelFor<Schema, Name> & {
	[K in RelationKeysFor<Schema, Name> as K extends keyof Include
		? Include[K] extends
				| true
				| QueryArgs<Schema, RelatedNameFor<Schema, Name, K>>
			? K
			: never
		: never]: RelationFor<Schema, Name, K> extends Many<string>
		? RelationPayloadFromArg<Schema, Name, K, Include[K]>[]
		: RelationPayloadFromArg<Schema, Name, K, Include[K]> | null;
};

type DefaultPayload<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = SelectModelFor<Schema, Name>;

/**
 * Resolves the result type for a query operation based on the provided args.
 * When `select` or `include` is specified, the returned shape is narrowed
 * accordingly.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name - The table key within the schema.
 * @typeParam Args - The concrete query arguments object.
 */
export type PayloadForArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Args,
> = Args extends { select: infer Select extends SelectInput<Schema, Name> }
	? SelectedScalarPayload<Schema, Name, Select> &
			SelectedRelationPayload<Schema, Name, Select>
	: Args extends { include: infer Include extends IncludeInput<Schema, Name> }
		? IncludedRelationPayload<Schema, Name, Include>
		: DefaultPayload<Schema, Name>;

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
	repository: BetterDrizzleModelDelegate<Schema, Name, Meta>;
	schema: Schema;
	table: Name;
	tableConfig: BetterTableConfig<Schema, Name>;
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
	table: BetterTableKey<Schema>;
	/** The relational configuration for the table. */
	tableConfig: BetterRelationalConfig;
	/** The Drizzle table instance. */
	tableInstance: Table;
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
> {
	/** The Drizzle schema object containing all table definitions. */
	schema: Schema;
	/** Optional plugins to extend the client. */
	plugins?: Plugin[];
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

type BetterDrizzleClientByTable<Schema extends AnySchema, Meta> = {
	[K in TableKey<Schema>]: BetterDrizzleModelDelegate<Schema, K, Meta>;
};

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
	Meta = BetterMeta,
> = BetterDrizzleClientByTable<Schema, Meta> & {
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
		Meta
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
export interface BetterDrizzleModelDelegate<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	/** Counts matching rows. */
	count(args?: CountArgs<Schema, Name, Meta>): Promise<number>;
	/** Returns `true` when at least one matching row exists. */
	exists(args?: ExistsArgs<Schema, Name, Meta>): Promise<boolean>;
	/** Inserts a single row and returns the created record. */
	create<Args extends CreateArgs<Schema, Name, Meta>>(
		args: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>>;
	/** Inserts multiple rows in a single statement. */
	createMany<Args extends CreateManyArgs<Schema, Name, Meta>>(
		args: Args,
	): Promise<BatchResult<PayloadForArgs<Schema, Name, Args>>>;
	/** Inserts a row if no match is found, otherwise updates it. */
	upsert<Args extends UpsertArgs<Schema, Name, Meta>>(
		args: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>>;
	/** Returns all matching rows. */
	findMany<Args extends QueryArgs<Schema, Name, Meta>>(
		args?: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>[]>;
	/** Updates a single matching row and returns the updated record. */
	update<Args extends UpdateArgs<Schema, Name, Meta>>(
		args: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Updates all matching rows and returns the affected count. */
	updateMany(
		args: UpdateManyArgs<Schema, Name, Meta>,
	): Promise<BatchResult<never>>;
	/** Returns the first matching row (alias for `findFirst`). */
	findOne<Args extends QueryArgs<Schema, Name, Meta>>(
		args?: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Returns the first matching row. */
	findFirst<Args extends QueryArgs<Schema, Name, Meta>>(
		args?: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Returns exactly one matching row; throws if not found. */
	findUnique<Args extends QueryArgs<Schema, Name, Meta>>(
		args: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Returns a paginated result set. */
	paginate<Args extends PaginationArgs<Schema, Name, Meta>>(
		args: Args,
	): Promise<PaginationResult<PayloadForArgs<Schema, Name, Args>>>;
	/** Deletes a single matching row and returns the deleted record. */
	delete<Args extends DeleteArgs<Schema, Name, Meta>>(
		args: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	/** Deletes all matching rows and returns the affected count. */
	deleteMany(
		args: DeleteManyArgs<Schema, Name, Meta>,
	): Promise<BatchResult<never>>;
}

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
export type BetterAliasKey<Schema extends AnySchema> = AliasKey<Schema>;

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
> = SelectModelFor<Schema, Name>;
