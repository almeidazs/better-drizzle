import type { Many, One, SQL, SQLWrapper } from 'drizzle-orm';

import type { PaginationOptions } from './database';
import type {
	AnySchema,
	RelatedNameFor,
	RelationFor,
	RelationKeysFor,
	ScalarKeysFor,
	SelectModelFor,
	TableKey,
} from './utils';

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
	[K in ScalarKeysFor<Schema, Name>]?: import('./utils').ScalarWhereField<
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
> = Partial<Record<ScalarKeysFor<Schema, Name>, import('./utils').SortOrder>>;

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
 * Arguments for the count operation.
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
 * Arguments for the exists operation.
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
 * Arguments for the paginate operation.
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
