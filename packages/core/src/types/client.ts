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

export type BetterMeta = Record<string, unknown>;

export type CursorInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Partial<Pick<SelectModelFor<Schema, Name>, ScalarKeysFor<Schema, Name>>>;

export interface QueryArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	where?: WhereArg<Schema, Name>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
	orderBy?: OrderByInput<Schema, Name>;
	take?: number;
	skip?: number;
	cursor?: CursorInput<Schema, Name>;
	meta?: Meta;
}

export type CountArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> = Pick<QueryArgs<Schema, Name, Meta>, 'where' | 'cursor' | 'meta'>;

export type ExistsArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> = CountArgs<Schema, Name, Meta>;

export type ThrowFactory = () => unknown;

export type ThrowingResult<T> = Promise<T | null> & {
	throw(): Promise<NonNullish<T>>;
	throw(factory: ThrowFactory): Promise<NonNullish<T>>;
};

export interface BatchResult<T> {
	count: number;
	data?: T[];
}

export type PaginationArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> = QueryArgs<Schema, Name, Meta> &
	PaginationOptions<SelectModelFor<Schema, Name>>;

export interface CreateArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	data: InsertModelFor<Schema, Name>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
	meta?: Meta;
}

export interface UpdateArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	where: WhereArg<Schema, Name>;
	data: Partial<InsertModelFor<Schema, Name>>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
	meta?: Meta;
}

export interface CreateManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	data: InsertModelFor<Schema, Name>[];
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
	meta?: Meta;
}

export interface UpdateManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	where?: WhereArg<Schema, Name>;
	data: Partial<InsertModelFor<Schema, Name>>;
	meta?: Meta;
}

export interface DeleteManyArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	where?: WhereArg<Schema, Name>;
	meta?: Meta;
}

export interface DeleteArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	where: WhereArg<Schema, Name>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
	meta?: Meta;
}

export interface UpsertArgs<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	where: WhereArg<Schema, Name>;
	create: InsertModelFor<Schema, Name>;
	update: Partial<InsertModelFor<Schema, Name>>;
	select?: SelectInput<Schema, Name>;
	include?: IncludeInput<Schema, Name>;
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

export type QueryHookAction =
	| 'findMany'
	| 'findFirst'
	| 'findOne'
	| 'findUnique'
	| 'count'
	| 'exists'
	| 'paginate';

export type CreateHookAction = 'create' | 'createMany' | 'upsert';
export type UpdateHookAction = 'update' | 'updateMany' | 'upsert';
export type DeleteHookAction = 'delete' | 'deleteMany';
export type HookAction =
	| QueryHookAction
	| CreateHookAction
	| UpdateHookAction
	| DeleteHookAction;

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

export type AfterCreateHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> =
	| CreateHookContext<Schema, Meta, 'create'>
	| CreateHookContext<Schema, Meta, 'createMany'>
	| CreateHookContext<Schema, Meta, 'upsert'>;

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

export type AfterUpdateHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> =
	| UpdateHookContext<Schema, Meta, 'update'>
	| UpdateHookContext<Schema, Meta, 'updateMany'>
	| UpdateHookContext<Schema, Meta, 'upsert'>;

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

export type AfterDeleteHookContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> =
	| DeleteHookContext<Schema, Meta, 'delete'>
	| DeleteHookContext<Schema, Meta, 'deleteMany'>;

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

export type AfterQueryHookContext<Schema extends AnySchema, Meta = BetterMeta> =
	| QueryHookContext<Schema, Meta, 'findMany'>
	| QueryHookContext<Schema, Meta, 'findFirst'>
	| QueryHookContext<Schema, Meta, 'findOne'>
	| QueryHookContext<Schema, Meta, 'findUnique'>
	| QueryHookContext<Schema, Meta, 'count'>
	| QueryHookContext<Schema, Meta, 'exists'>
	| QueryHookContext<Schema, Meta, 'paginate'>;

export type ErrorHookContext<Schema extends AnySchema, Meta = BetterMeta> = {
	action: HookAction;
	args: unknown;
	db: unknown;
	error: unknown;
	hookName?: keyof BetterClientHooks<Schema, Meta>;
	meta: Meta | undefined;
	options: BetterClientOptions<Schema, Meta>;
	schema: Schema;
	stage: HookStage;
	table: BetterTableKey<Schema>;
	tableConfig: BetterRelationalConfig;
	tableInstance: Table;
};

export interface BetterClientOptions<
	Schema extends AnySchema,
	Meta = BetterMeta,
> {
	schema: Schema;
	plugins?: Plugin[];
	hooks?: BetterClientHooks<Schema, Meta>;
}

export interface BetterClientHooks<
	Schema extends AnySchema,
	Meta = BetterMeta,
> {
	beforeCreate?(context: BeforeCreateHookContext<Schema, Meta>): unknown;
	afterCreate?(context: AfterCreateHookContext<Schema, Meta>): unknown;
	beforeUpdate?(context: BeforeUpdateHookContext<Schema, Meta>): unknown;
	afterUpdate?(context: AfterUpdateHookContext<Schema, Meta>): unknown;
	beforeDelete?(context: BeforeDeleteHookContext<Schema, Meta>): unknown;
	afterDelete?(context: AfterDeleteHookContext<Schema, Meta>): unknown;
	beforeQuery?(context: BeforeQueryHookContext<Schema, Meta>): unknown;
	afterQuery?(context: AfterQueryHookContext<Schema, Meta>): unknown;
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

export type BetterDrizzleClient<
	Schema extends AnySchema,
	Meta = BetterMeta,
> = BetterDrizzleClientByTable<Schema, Meta> & {
	repository<Name extends RepositoryKey<Schema>>(
		name: Name,
	): BetterDrizzleModelDelegate<
		Schema,
		RepositorySourceKey<Schema, Name>,
		Meta
	>;
};

export interface BetterDrizzleModelDelegate<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta = BetterMeta,
> {
	count(args?: CountArgs<Schema, Name, Meta>): Promise<number>;
	exists(args?: ExistsArgs<Schema, Name, Meta>): Promise<boolean>;
	create<Args extends CreateArgs<Schema, Name, Meta>>(
		args: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>>;
	createMany<Args extends CreateManyArgs<Schema, Name, Meta>>(
		args: Args,
	): Promise<BatchResult<PayloadForArgs<Schema, Name, Args>>>;
	upsert<Args extends UpsertArgs<Schema, Name, Meta>>(
		args: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>>;
	findMany<Args extends QueryArgs<Schema, Name, Meta>>(
		args?: Args,
	): Promise<PayloadForArgs<Schema, Name, Args>[]>;
	update<Args extends UpdateArgs<Schema, Name, Meta>>(
		args: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	updateMany(
		args: UpdateManyArgs<Schema, Name, Meta>,
	): Promise<BatchResult<never>>;
	findOne<Args extends QueryArgs<Schema, Name, Meta>>(
		args?: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	findFirst<Args extends QueryArgs<Schema, Name, Meta>>(
		args?: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	findUnique<Args extends QueryArgs<Schema, Name, Meta>>(
		args: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	paginate<Args extends PaginationArgs<Schema, Name, Meta>>(
		args: Args,
	): Promise<PaginationResult<PayloadForArgs<Schema, Name, Args>>>;
	delete<Args extends DeleteArgs<Schema, Name, Meta>>(
		args: Args,
	): ThrowingResult<PayloadForArgs<Schema, Name, Args>>;
	deleteMany(
		args: DeleteManyArgs<Schema, Name, Meta>,
	): Promise<BatchResult<never>>;
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
