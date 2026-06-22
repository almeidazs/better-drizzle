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

export type WhereInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	AND?: WhereInput<Schema, Name>[];
	OR?: WhereInput<Schema, Name>[];
	NOT?: WhereInput<Schema, Name> | WhereInput<Schema, Name>[];
} & {
	[K in ScalarKeysFor<Schema, Name>]?: ScalarWhereField<
		SelectModelFor<Schema, Name>[K]
	>;
} & {
	[K in RelationKeysFor<Schema, Name>]?: RelationWhereInput<Schema, Name, K>;
};

export type WhereArg<Schema extends AnySchema, Name extends TableKey<Schema>> =
	| WhereInput<Schema, Name>
	| SQL
	| SQLWrapper;

type SelectRelationArg<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	RelationName extends RelationKeysFor<Schema, Name>,
> = true | QueryArgs<Schema, RelatedNameFor<Schema, Name, RelationName>>;

export type SelectInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	[K in ScalarKeysFor<Schema, Name>]?: boolean;
} & {
	[K in RelationKeysFor<Schema, Name>]?: SelectRelationArg<Schema, Name, K>;
};

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

export type OrderByInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = OrderByField<Schema, Name> | OrderByField<Schema, Name>[];

export type CursorInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Partial<Pick<SelectModelFor<Schema, Name>, ScalarKeysFor<Schema, Name>>>;

export interface QueryArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> {
	where?: WhereArg<Schema, Name>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
	orderBy?: OrderByInput<Schema, Name>;
	take?: number;
	skip?: number;
	cursor?: CursorInput<Schema, Name>;
}

export type CountArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Pick<QueryArgs<Schema, Name>, 'where' | 'cursor'>;

export type ExistsArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = CountArgs<Schema, Name>;

export type PaginationArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = QueryArgs<Schema, Name> & PaginationOptions<SelectModelFor<Schema, Name>>;

export interface CreateArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> {
	data: InsertModelFor<Schema, Name>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
}

export interface UpdateArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> {
	where: WhereArg<Schema, Name>;
	data: Partial<InsertModelFor<Schema, Name>>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
}

export interface DeleteArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> {
	where: WhereArg<Schema, Name>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
}

export interface UpsertArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> {
	where: WhereArg<Schema, Name>;
	create: InsertModelFor<Schema, Name>;
	update: Partial<InsertModelFor<Schema, Name>>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
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

export interface BetterClientOptions<Schema extends AnySchema> {
	schema: Schema;
	plugins?: Plugin[];
	hooks?: BetterClientHooks;
}

export interface BetterClientHooks {
	afterCreate?(): unknown;
	beforeCreate?(): unknown;
}

type BetterDrizzleClientByTable<Schema extends AnySchema> = {
	[K in TableKey<Schema>]: BetterDrizzleModelDelegate<Schema, K>;
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

export type BetterDrizzleClient<Schema extends AnySchema> =
	BetterDrizzleClientByTable<Schema> & {
		repository<Name extends RepositoryKey<Schema>>(
			name: Name,
		): BetterDrizzleModelDelegate<
			Schema,
			RepositorySourceKey<Schema, Name>
		>;
	};

export interface BetterDrizzleModelDelegate<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> {
	count(args?: CountArgs<Schema, Name>): Promise<number>;
	exists(args?: ExistsArgs<Schema, Name>): Promise<boolean>;
	create<Args extends CreateArgs<Schema, Name>>(
		args: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>>;
	upsert<Args extends UpsertArgs<Schema, Name>>(
		args: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>>;
	findMany<Args extends QueryArgs<Schema, Name>>(
		args?: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>[]>;
	delete<Args extends DeleteArgs<Schema, Name>>(
		args: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>>;
	update<Args extends UpdateArgs<Schema, Name>>(
		args: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>>;
	findOne<Args extends QueryArgs<Schema, Name>>(
		args?: Args,
	): Promise<PayloadForArgs<Schema, Name, Args> | null>;
	findFirst<Args extends QueryArgs<Schema, Name>>(
		args?: Args,
	): Promise<PayloadForArgs<Schema, Name, Args> | null>;
	findUnique<Args extends QueryArgs<Schema, Name>>(
		args: Args,
	): Promise<PayloadForArgs<Schema, Name, Args> | null>;
	paginate<Args extends PaginationArgs<Schema, Name>>(
		args: Args,
	): Promise<PaginationResult<PayloadForArgs<Schema, Name, Args>>>;
}

export type BetterTableConfig<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = TableConfigFor<Schema, Name>;

export type BetterTableKey<Schema extends AnySchema> = TableKey<Schema>;
export type BetterAliasKey<Schema extends AnySchema> = AliasKey<Schema>;
export type BetterRepositoryKey<Schema extends AnySchema> =
	RepositoryKey<Schema>;

export type BetterTableRelations<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = TableConfigFor<Schema, Name>['relations'];

export type BetterRelationalConfig = TableRelationalConfig;

export type BetterRecord<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = SelectModelFor<Schema, Name>;
