import type {
	InferInsertModel,
	InferSelectModel,
	Many,
	Table,
	TableRelationalConfig,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Represents any Better Drizzle schema: the relational config produced by
 * Drizzle's `defineRelations(...)` and exposed as `db._.relations`.
 */
export type AnySchema = Record<string, unknown>;

/**
 * The relational table configuration map of a schema.
 *
 * @typeParam Schema - The relational config (`typeof relations`).
 */
export type TablesConfig<Schema extends AnySchema> = Extract<
	Schema,
	Record<string, TableRelationalConfig>
>;

/**
 * Union of all valid TypeScript table keys in a schema. Views are excluded.
 *
 * @typeParam Schema - The relational config.
 */
export type TableKey<Schema extends AnySchema> = Extract<
	{
		[K in keyof Schema]: Schema[K] extends { table: Table } ? K : never;
	}[keyof Schema],
	string
>;

/**
 * Singularises a pluralised key name. Converts trailing `"ies"` to `"y"`
 * and trailing `"s"` to an empty string.
 *
 * @typeParam Key - The plural key to singularise.
 */
export type Singularize<Key extends string> = Key extends `${infer Stem}ies`
	? `${Stem}y`
	: Key extends `${infer Stem}s`
		? Stem
		: Key;

/**
 * Singularised alias of each table key in the schema. For example,
 * `"users"` becomes `"user"`.
 *
 * @typeParam Schema - The relational config.
 */
export type AliasKey<Schema extends AnySchema> = Singularize<
	Extract<TableKey<Schema>, string>
>;

/**
 * Union of all database table names in the schema.
 *
 * @typeParam Schema - The relational config.
 */
export type DbNameKey<Schema extends AnySchema> = Extract<
	{
		[K in TableKey<Schema>]: TableFor<Schema, K>['_']['name'];
	}[TableKey<Schema>],
	string
>;
/**
 * Given a database table name, extracts the corresponding TypeScript
 * table key from the schema.
 *
 * @typeParam Schema  - The relational config.
 * @typeParam DbName - The database table name to resolve.
 */
export type SourceKeyFromDbName<
	Schema extends AnySchema,
	DbName extends string,
> = Extract<
	TableKey<Schema>,
	{
		[K in TableKey<Schema>]: TableFor<Schema, K>['_']['name'] extends DbName
			? K
			: never;
	}[TableKey<Schema>]
>;
/**
 * Extracts the relational configuration for a specific table from the schema.
 *
 * @typeParam Schema - The relational config.
 * @typeParam Name   - The table key within the schema.
 */
export type TableConfigFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<Schema[Name], TableRelationalConfig>;
/**
 * Extracts string keys from `T`, but returns `never` when `T` is `never`.
 * Prevents `keyof never` from widening to `string | number | symbol`.
 *
 * @typeParam T - The type to extract keys from.
 */
export type SafeKeys<T> = [T] extends [never]
	? never
	: Extract<keyof T, string>;
/**
 * Extracts the Drizzle `Table` instance for a specific table from the schema.
 *
 * @typeParam Schema - The relational config.
 * @typeParam Name   - The table key within the schema.
 */
export type TableFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<TableConfigFor<Schema, Name>['table'], Table>;
/**
 * Infers the select (read) model for a specific table. This is the shape
 * of a row returned from queries.
 *
 * @typeParam Schema - The relational config.
 * @typeParam Name   - The table key within the schema.
 */
export type SelectModelFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = [Name] extends [never]
	? Record<string, unknown>
	: InferSelectModel<TableFor<Schema, Name>>;
/**
 * Infers the insert model for a specific table. This is the shape
 * accepted by create operations. Optional columns become optional here.
 *
 * @typeParam Schema - The relational config.
 * @typeParam Name   - The table key within the schema.
 */
export type InsertModelFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = [Name] extends [never]
	? Record<string, unknown>
	: InferInsertModel<TableFor<Schema, Name>>;
/**
 * Union of all relation names defined on a specific table.
 *
 * @typeParam Schema - The relational config.
 * @typeParam Name   - The table key within the schema.
 */
export type RelationKeysFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = SafeKeys<TableConfigFor<Schema, Name>['relations']>;
/**
 * Union of all scalar (non-relation) column keys for a specific table.
 * This is the set of keys available for filtering and ordering.
 *
 * @typeParam Schema - The relational config.
 * @typeParam Name   - The table key within the schema.
 */
export type ScalarKeysFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Exclude<keyof SelectModelFor<Schema, Name>, RelationKeysFor<Schema, Name>>;
/**
 * Extracts the Drizzle relation definition for a specific relation on a table.
 *
 * @typeParam Schema       - The relational config.
 * @typeParam Name         - The table key within the schema.
 * @typeParam RelationName - The relation name on the table.
 */
export type RelationFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = TableConfigFor<Schema, Name>['relations'][RelationName];
/**
 * Resolves the TypeScript table key of the table referenced by a specific
 * relation on a table.
 *
 * @typeParam Schema       - The relational config.
 * @typeParam Name         - The table key within the schema.
 * @typeParam RelationName - The relation name on the table.
 */
export type RelatedNameFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = Extract<
	RelationFor<Schema, Name, RelationName>['targetTableName'],
	TableKey<Schema>
>;
/**
 * Extracts the relational configuration of the table referenced by a
 * specific relation on a table.
 *
 * @typeParam Schema       - The relational config.
 * @typeParam Name         - The table key within the schema.
 * @typeParam RelationName - The relation name on the table.
 */
export type RelatedConfigFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = TableConfigFor<Schema, RelatedNameFor<Schema, Name, RelationName>>;
/**
 * `true` when a relation resolves to many rows.
 *
 * @typeParam Schema       - The relational config.
 * @typeParam Name         - The table key within the schema.
 * @typeParam RelationName - The relation name on the table.
 */
export type IsManyRelation<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = RelationFor<Schema, Name, RelationName> extends Many<string> ? true : false;

/**
 * Removes `null` and `undefined` from `T`.
 *
 * @typeParam T - The type to refine.
 */
export type NonNullish<T> = Exclude<T, null | undefined>;

/**
 * Sort direction for ordering results.
 *
 * @example
 * ```ts
 * const users = await db.user.findMany({
 *   orderBy: { name: 'asc' },
 * });
 * ```
 */
export type SortOrder = 'asc' | 'desc';

/** Controls where SQL NULL values appear within a sort direction. */
export type NullsOrder = 'first' | 'last';

/** Direction and optional SQL NULL placement for one ordered column. */
export type SortConfig = {
	direction: SortOrder;
	nulls?: NullsOrder;
};

/**
 * Query mode controlling case sensitivity for string comparisons.
 * - `'default'` - case-sensitive
 * - `'insensitive'` - case-insensitive
 *
 * @example
 * ```ts
 * const users = await db.user.findMany({
 *   where: {
 *     name: { contains: 'alice', mode: 'insensitive' },
 *   },
 * });
 * ```
 */
export type QueryMode = 'default' | 'insensitive';

/** A literal value or a prepared statement `param()` standing in for it. */
export type Bindable<T> = T | import('./prepared').PreparedParam<string, T>;

/**
 * Filter operators for string columns. Supports equality, membership,
 * pattern matching, and case-insensitive mode.
 *
 * @typeParam T - The string column type.
 *
 * @example
 * ```ts
 * const users = await db.user.findMany({
 *   where: {
 *     name: { contains: 'alice', mode: 'insensitive' },
 *     email: { endsWith: '@example.com' },
 *     role: { in: ['admin', 'moderator'] },
 *   },
 * });
 * ```
 */
export type StringFilter<T> = {
	/** Exact match. */
	equals?: Bindable<T>;
	/** Match any value in the array. */
	in?: Bindable<T[]>;
	/** Match none of the values in the array. */
	notIn?: Bindable<T[]>;
	/** Substring match. */
	contains?: Bindable<string>;
	/** Prefix match. */
	startsWith?: Bindable<string>;
	/** Suffix match. */
	endsWith?: Bindable<string>;
	/** Case sensitivity mode. */
	mode?: QueryMode;
	/** Negation filter. */
	not?: Bindable<T> | Omit<StringFilter<T>, 'not'>;
};

/**
 * Filter operators for comparable scalar columns (numbers, bigints, dates).
 * Supports equality, membership, and range comparisons.
 *
 * @typeParam T - The comparable column type.
 *
 * @example
 * ```ts
 * const users = await db.user.findMany({
 *   where: {
 *     age: { gte: 18, lt: 65 },
 *     score: { gt: 90 },
 *     createdAt: { gte: new Date('2024-01-01') },
 *   },
 * });
 * ```
 */
export type ComparableFilter<T> = {
	/** Exact match. */
	equals?: Bindable<T>;
	/** Match any value in the array. */
	in?: Bindable<T[]>;
	/** Match none of the values in the array. */
	notIn?: Bindable<T[]>;
	/** Less than. */
	lt?: Bindable<T>;
	/** Less than or equal. */
	lte?: Bindable<T>;
	/** Greater than. */
	gt?: Bindable<T>;
	/** Greater than or equal. */
	gte?: Bindable<T>;
	/** Negation filter. */
	not?: Bindable<T> | Omit<ComparableFilter<T>, 'not'>;
};

/**
 * Filter operators for boolean columns.
 *
 * @typeParam T - The boolean column type.
 *
 * @example
 * ```ts
 * const users = await db.user.findMany({
 *   where: { active: true },
 * });
 * ```
 */
export type BooleanFilter<T> = {
	/** Exact match. */
	equals?: Bindable<T>;
	/** Negation filter. */
	not?: Bindable<T> | Omit<BooleanFilter<T>, 'not'>;
};

/**
 * Resolves the appropriate filter type for a scalar column based on its
 * underlying type: {@link StringFilter} for strings, {@link ComparableFilter}
 * for numbers/bigints/dates, {@link BooleanFilter} for booleans, and a
 * simple equality filter for everything else.
 *
 * @typeParam T - The scalar column type.
 *
 * @example
 * ```ts
 * // Automatically resolves to the correct filter type
 * const users = await db.user.findMany({
 *   where: {
 *     name: 'Alice',              // StringFilter
 *     age: { gte: 18 },           // ComparableFilter
 *     active: true,               // BooleanFilter
 *   },
 * });
 * ```
 */
export type ScalarFilter<T> =
	NonNullish<T> extends string
		? StringFilter<T>
		: NonNullish<T> extends number | bigint | Date
			? ComparableFilter<T>
			: NonNullish<T> extends boolean
				? BooleanFilter<T>
				: {
						equals?: Bindable<T>;
						not?: Bindable<T> | { equals?: Bindable<T> };
					};

/**
 * Accepted value for a scalar where-clause field. Can be a raw value
 * (direct equality), a {@link ScalarFilter} object, or `null` when the
 * column is nullable.
 *
 * @typeParam T - The scalar column type.
 *
 * @example
 * ```ts
 * const users = await db.user.findMany({
 *   where: {
 *     name: 'Alice',                  // raw value (equality)
 *     age: { gte: 18, lt: 65 },       // filter object
 *     deletedAt: null,                 // null check
 *   },
 * });
 * ```
 */
export type ScalarWhereField<T> =
	| Bindable<T>
	| ScalarFilter<T>
	| (null extends T ? null : never);

type ArrayElement<T> =
	NonNullish<T> extends readonly (infer Value)[]
		? ArrayElement<Value>
		: NonNullish<T>;

type ArrayValue<T> = Exclude<ArrayElement<T>, null>;

/** Filter operators for native PostgreSQL array columns. */
export type ArrayFilter<T> = {
	equals?: Bindable<T>;
	has?: Bindable<ArrayValue<T>>;
	hasEvery?: Bindable<readonly ArrayValue<T>[]>;
	hasNone?: Bindable<readonly ArrayValue<T>[]>;
	hasSome?: Bindable<readonly ArrayValue<T>[]>;
	containedBy?: Bindable<readonly ArrayValue<T>[]>;
	isEmpty?: boolean;
	length?: Bindable<number> | ComparableFilter<number>;
	not?: Bindable<T> | Omit<ArrayFilter<T>, 'not'>;
	none?: ScalarFilter<ArrayValue<T>>;
	some?: ScalarFilter<ArrayValue<T>>;
	every?: ScalarFilter<ArrayValue<T>>;
};

/** Accepted where value for a native PostgreSQL array column. */
export type ArrayWhereField<T> =
	| Bindable<NonNullish<T>>
	// `length` would let a bare string match the all-optional filter shape.
	| (ArrayFilter<T> & { charAt?: never })
	| (null extends T ? null : never);

/**
 * `true` for PostgreSQL columns declared with `.array()`. Drizzle 1.x keeps
 * the element's `dataType`, so JSON columns (`object json`) and vector-like
 * types (`array ...`) are excluded even when their data is an array.
 */
export type IsPgArrayColumn<Column> = Column extends PgColumn
	? Column['_']['dataType'] extends
			| 'object json'
			| 'array'
			| `array ${string}`
		? false
		: NonNullable<Column['_']['data']> extends readonly unknown[]
			? true
			: false
	: false;

/** `true` for PostgreSQL JSON/JSONB columns. */
export type IsPgJsonColumn<Column> = Column extends PgColumn
	? Column['_']['dataType'] extends 'object json'
		? true
		: false
	: false;

/** Keys backed by Drizzle's native PostgreSQL array column. */
export type PgArrayKeysFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	[K in ScalarKeysFor<Schema, Name>]: K extends keyof TableFor<Schema, Name>
		? IsPgArrayColumn<TableFor<Schema, Name>[K]> extends true
			? K
			: never
		: never;
}[ScalarKeysFor<Schema, Name>];

export type IsUnknown<T> = unknown extends T
	? [keyof T] extends [never]
		? true
		: false
	: false;

type JsonPathPrefix<
	Prefix extends string,
	Key extends string,
> = Prefix extends '' ? Key : `${Prefix}.${Key}`;

export type JsonScalarPath<T, Prefix extends string = ''> =
	IsUnknown<T> extends true
		? never
		: NonNullish<T> extends readonly unknown[]
			? never
			: NonNullish<T> extends object
				? {
						[K in Extract<keyof NonNullish<T>, string>]: NonNullish<
							NonNullish<T>[K]
						> extends readonly unknown[]
							? never
							: NonNullish<NonNullish<T>[K]> extends object
								? JsonScalarPath<
										NonNullish<T>[K],
										JsonPathPrefix<Prefix, K>
									>
								: JsonPathPrefix<Prefix, K>;
					}[Extract<keyof NonNullish<T>, string>]
				: never;

export type JsonPathValue<
	T,
	Path extends string,
> = Path extends `${infer Key}.${infer Rest}`
	? Key extends keyof NonNullish<T>
		? JsonPathValue<NonNullish<T>[Key], Rest>
		: never
	: Path extends keyof NonNullish<T>
		? Exclude<NonNullish<T>[Path], undefined>
		: never;

export type JsonWhereInput<T> =
	IsUnknown<T> extends true
		? never
		: {
				[Path in JsonScalarPath<T>]?: ScalarWhereField<
					JsonPathValue<T, Path>
				>;
			};

type JsonDottedPathValue =
	| import('./prepared').PreparedParam
	| string
	| number
	| bigint
	| boolean
	| null
	| StringFilter<string>
	| ComparableFilter<number | bigint>
	| BooleanFilter<boolean>;

/**
 * Dotted JSONB path filters. Paths and value types follow `$type<T>()`;
 * untyped columns accept any dotted path with JSON scalar filters.
 */
export type JsonDottedWhereInput<T = unknown> =
	IsUnknown<T> extends true
		? {
				[path: `${string}.${string}`]: JsonDottedPathValue;
				json?: never;
			}
		: [Extract<JsonScalarPath<T>, `${string}.${string}`>] extends [never]
			? never
			: {
					[
						Path in
							| Extract<JsonScalarPath<T>, `${string}.${string}`>
							| 'json'
					]?: Path extends 'json'
						? never
						: ScalarWhereField<JsonPathValue<T, Path>>;
				};

/**
 * A JSON-compatible mutation value for a single JSONB path.
 * Excludes `undefined`, functions, symbols, and bigint to match the
 * runtime, which throws on values `JSON.stringify` cannot encode.
 */
export type JsonMutationValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonMutationValue[]
	| { readonly [key: string]: JsonMutationValue };

export type JsonMutationPath<T, Prefix extends string = ''> =
	IsUnknown<T> extends true
		? never
		: NonNullish<T> extends readonly unknown[]
			? never
			: NonNullish<T> extends object
				? {
						[K in Extract<keyof NonNullish<T>, string>]:
							| JsonPathPrefix<Prefix, K>
							| JsonMutationPath<
									NonNullish<T>[K],
									JsonPathPrefix<Prefix, K>
							  >;
					}[Extract<keyof NonNullish<T>, string>]
				: never;

/**
 * Typed JSONB path assignments for the `{ json: ... }` mutation wrapper.
 * Maps every addressable path (including intermediate objects and
 * single-level keys) to its declared value type. Dotted shorthand uses the
 * same types but only permits multi-segment paths. Untyped (`$type`-less)
 * columns fall back to an open record so the wrapper stays usable without
 * declared paths.
 */
export type JsonMutationInput<T> =
	IsUnknown<T> extends true
		? Record<string, JsonMutationValue>
		: {
				[Path in JsonMutationPath<T>]?: JsonPathValue<T, Path>;
			};

/** Typed multi-segment JSONB path assignments for mutation. */
export type JsonDottedMutationInput<T = unknown> =
	IsUnknown<T> extends true
		? {
				[path: `${string}.${string}`]: JsonMutationValue;
				json?: never;
			}
		: {
				[
					Path in Extract<JsonMutationPath<T>, `${string}.${string}`>
				]?: JsonPathValue<T, Path>;
			} & { json?: never };
