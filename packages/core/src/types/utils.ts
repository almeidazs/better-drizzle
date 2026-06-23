import type {
	ExtractTablesWithRelations,
	FindTableByDBName,
	InferInsertModel,
	InferSelectModel,
	Table,
} from 'drizzle-orm';

/**
 * Represents any Drizzle schema object – a record mapping table names to their
 * Drizzle `Table` definitions (or arbitrary values for non-table entries).
 */
export type AnySchema = Record<string, unknown>;

/**
 * Extracts the relational table configuration map from a Drizzle schema.
 * This is the shape returned by Drizzle's `extractTablesRelationalConfig`.
 *
 * @typeParam Schema - The Drizzle schema type.
 */
export type TablesConfig<Schema extends AnySchema> =
	ExtractTablesWithRelations<Schema>;

/**
 * Union of all valid TypeScript table keys in a Drizzle schema. Only keys
 * that exist both as direct properties of the schema and in the relational
 * config are included.
 *
 * @typeParam Schema - The Drizzle schema type.
 */
export type TableKey<Schema extends AnySchema> = Extract<
	keyof TablesConfig<Schema>,
	keyof Schema
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
 * @typeParam Schema - The Drizzle schema type.
 */
export type AliasKey<Schema extends AnySchema> = Singularize<
	Extract<TableKey<Schema>, string>
>;

/**
 * Union of all database table names in the schema (the `dbName` property
 * of each table's relational config).
 *
 * @typeParam Schema - The Drizzle schema type.
 */
export type DbNameKey<Schema extends AnySchema> = Extract<
	{
		[K in TableKey<Schema>]: TableConfigFor<Schema, K>['dbName'];
	}[TableKey<Schema>],
	string
>;
/**
 * Given a database table name, extracts the corresponding TypeScript
 * table key from the schema.
 *
 * @typeParam Schema  - The Drizzle schema type.
 * @typeParam DbName - The database table name to resolve.
 */
export type SourceKeyFromDbName<
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
/**
 * Extracts the relational configuration for a specific table from the schema.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name   - The table key within the schema.
 */
export type TableConfigFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = TablesConfig<Schema>[Name];
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
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name   - The table key within the schema.
 */
export type TableFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<Schema[Name], Table>;
/**
 * Infers the select (read) model for a specific table. This is the shape
 * of a row returned from queries.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name   - The table key within the schema.
 */
export type SelectModelFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = InferSelectModel<TableFor<Schema, Name>>;
/**
 * Infers the insert model for a specific table. This is the shape
 * accepted by create operations. Optional columns become optional here.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name   - The table key within the schema.
 */
export type InsertModelFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = InferInsertModel<TableFor<Schema, Name>>;
/**
 * Union of all relation names defined on a specific table.
 *
 * @typeParam Schema - The Drizzle schema type.
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
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Name   - The table key within the schema.
 */
export type ScalarKeysFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Exclude<keyof SelectModelFor<Schema, Name>, RelationKeysFor<Schema, Name>>;
/**
 * Extracts the relational configuration for a specific relation on a table,
 * resolved by the referenced table's database name.
 *
 * @typeParam Schema       - The Drizzle schema type.
 * @typeParam Name         - The table key within the schema.
 * @typeParam RelationName - The relation name on the table.
 */
export type RelatedConfigFor<
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
/**
 * Resolves the TypeScript table key of the table referenced by a specific
 * relation on a table.
 *
 * @typeParam Schema       - The Drizzle schema type.
 * @typeParam Name         - The table key within the schema.
 * @typeParam RelationName - The relation name on the table.
 */
export type RelatedNameFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = Extract<
	RelatedConfigFor<Schema, Name, RelationName>['tsName'],
	TableKey<Schema>
>;
/**
 * Extracts the Drizzle relation definition for a specific relation on a table.
 *
 * @typeParam Schema       - The Drizzle schema type.
 * @typeParam Name         - The table key within the schema.
 * @typeParam RelationName - The relation name on the table.
 */
export type RelationFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = TableConfigFor<Schema, Name>['relations'][RelationName];

/**
 * Removes `null` and `undefined` from `T`.
 *
 * @typeParam T - The type to refine.
 */
export type NonNullish<T> = Exclude<T, null | undefined>;

/**
 * Sort direction for ordering results.
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Query mode controlling case sensitivity for string comparisons.
 * - `'default'` — case-sensitive
 * - `'insensitive'` — case-insensitive
 */
export type QueryMode = 'default' | 'insensitive';

/**
 * Filter operators for string columns. Supports equality, membership,
 * pattern matching, and case-insensitive mode.
 *
 * @typeParam T - The string column type.
 */
export type StringFilter<T> = {
	equals?: T;
	in?: T[];
	notIn?: T[];
	contains?: string;
	startsWith?: string;
	endsWith?: string;
	mode?: QueryMode;
	not?: T | Omit<StringFilter<T>, 'not'>;
};

/**
 * Filter operators for comparable scalar columns (numbers, bigints, dates).
 * Supports equality, membership, and range comparisons.
 *
 * @typeParam T - The comparable column type.
 */
export type ComparableFilter<T> = {
	equals?: T;
	in?: T[];
	notIn?: T[];
	lt?: T;
	lte?: T;
	gt?: T;
	gte?: T;
	not?: T | Omit<ComparableFilter<T>, 'not'>;
};

/**
 * Filter operators for boolean columns.
 *
 * @typeParam T - The boolean column type.
 */
export type BooleanFilter<T> = {
	equals?: T;
	not?: T | Omit<BooleanFilter<T>, 'not'>;
};

/**
 * Resolves the appropriate filter type for a scalar column based on its
 * underlying type: {@link StringFilter} for strings, {@link ComparableFilter}
 * for numbers/bigints/dates, {@link BooleanFilter} for booleans, and a
 * simple equality filter for everything else.
 *
 * @typeParam T - The scalar column type.
 */
export type ScalarFilter<T> =
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

/**
 * Accepted value for a scalar where-clause field. Can be a raw value
 * (direct equality), a {@link ScalarFilter} object, or `null` when the
 * column is nullable.
 *
 * @typeParam T - The scalar column type.
 */
export type ScalarWhereField<T> =
	| T
	| ScalarFilter<T>
	| (null extends T ? null : never);
