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

export type TablesConfig<Schema extends AnySchema> =
	ExtractTablesWithRelations<Schema>;
export type TableKey<Schema extends AnySchema> = Extract<
	keyof TablesConfig<Schema>,
	keyof Schema
>;
export type Singularize<Key extends string> = Key extends `${infer Stem}ies`
	? `${Stem}y`
	: Key extends `${infer Stem}s`
		? Stem
		: Key;
export type AliasKey<Schema extends AnySchema> = Singularize<
	Extract<TableKey<Schema>, string>
>;

export type DbNameKey<Schema extends AnySchema> = Extract<
	{
		[K in TableKey<Schema>]: TableConfigFor<Schema, K>['dbName'];
	}[TableKey<Schema>],
	string
>;
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
export type TableConfigFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = TablesConfig<Schema>[Name];
export type SafeKeys<T> = [T] extends [never]
	? never
	: Extract<keyof T, string>;
export type TableFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<Schema[Name], Table>;
export type SelectModelFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = InferSelectModel<TableFor<Schema, Name>>;
export type InsertModelFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = InferInsertModel<TableFor<Schema, Name>>;
export type RelationKeysFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = SafeKeys<TableConfigFor<Schema, Name>['relations']>;
export type ScalarKeysFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Exclude<keyof SelectModelFor<Schema, Name>, RelationKeysFor<Schema, Name>>;
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
export type RelatedNameFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = Extract<
	RelatedConfigFor<Schema, Name, RelationName>['tsName'],
	TableKey<Schema>
>;
export type RelationFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = TableConfigFor<Schema, Name>['relations'][RelationName];

export type NonNullish<T> = Exclude<T, null | undefined>;
export type SortOrder = 'asc' | 'desc';
export type QueryMode = 'default' | 'insensitive';

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

export type BooleanFilter<T> = {
	equals?: T;
	not?: T | Omit<BooleanFilter<T>, 'not'>;
};

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

export type ScalarWhereField<T> =
	| T
	| ScalarFilter<T>
	| (null extends T ? null : never);
