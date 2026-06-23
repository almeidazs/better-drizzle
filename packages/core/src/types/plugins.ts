import type { AnyColumn } from 'drizzle-orm';

import type {
	AnySchema,
	BetterClientOptions,
	BetterMeta,
	BetterTableKey,
	InsertModelFor,
	TableKey,
} from '.';
import type {
	BatchResult,
	BetterDrizzleClient,
	BetterDrizzleModelDelegate,
	CreateArgs,
	CreateManyArgs,
	DeleteArgs,
	DeleteManyArgs,
	UpdateArgs,
	UpdateManyArgs,
	UpsertArgs,
} from './delegate';
import type { CountArgs, ExistsArgs, PaginationArgs, QueryArgs } from './query';

export type PluginDialect = 'pg' | 'mysql' | 'sqlite';
export type PluginState = Record<string, unknown>;
export type PluginExtension = Record<string, unknown>;

export type PluginColumnRequirement = {
	column: string;
	optional?: boolean;
	type?: string;
};

export type PluginConfig = {
	dialects?: PluginDialect[];
	requires?: {
		columns?: PluginColumnRequirement[];
	};
};

export type PluginMeta<Options = unknown> = {
	description?: string;
	id: string;
	name?: string;
	options?: Options;
	version?: string;
};

export type PluginModelInfo<
	Schema extends AnySchema = AnySchema,
	Name extends string = Extract<TableKey<Schema>, string>,
> = {
	columns: Record<string, AnyColumn>;
	dbName: string;
	hasColumn(column: string): boolean;
	name: Name;
};

export type ModelRegistry<Schema extends AnySchema = AnySchema> = Record<
	string,
	PluginModelInfo<Schema, string>
>;

export type PluginHookKind =
	| 'count'
	| 'create'
	| 'createMany'
	| 'delete'
	| 'deleteMany'
	| 'exists'
	| 'findFirst'
	| 'findMany'
	| 'findOne'
	| 'findUnique'
	| 'paginate'
	| 'update'
	| 'updateMany'
	| 'upsert';

type PluginOperationArgsMap<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
> = {
	count: CountArgs<Schema, Name, Meta>;
	create: CreateArgs<Schema, Name, Meta>;
	createMany: CreateManyArgs<Schema, Name, Meta>;
	delete: DeleteArgs<Schema, Name, Meta>;
	deleteMany: DeleteManyArgs<Schema, Name, Meta>;
	exists: ExistsArgs<Schema, Name, Meta>;
	findFirst: QueryArgs<Schema, Name, Meta>;
	findMany: QueryArgs<Schema, Name, Meta>;
	findOne: QueryArgs<Schema, Name, Meta>;
	findUnique: QueryArgs<Schema, Name, Meta>;
	paginate: PaginationArgs<Schema, Name, Meta>;
	update: UpdateArgs<Schema, Name, Meta>;
	updateMany: UpdateManyArgs<Schema, Name, Meta>;
	upsert: UpsertArgs<Schema, Name, Meta>;
};

type PluginOperationResultMap<
	Schema extends AnySchema,
	_Name extends TableKey<Schema>,
	_Meta,
> = {
	count: number;
	create: unknown;
	createMany: BatchResult<unknown>;
	delete: unknown;
	deleteMany: BatchResult<never>;
	exists: boolean;
	findFirst: unknown;
	findMany: unknown[];
	findOne: unknown;
	findUnique: unknown;
	paginate: unknown;
	update: unknown;
	updateMany: BatchResult<never>;
	upsert: unknown;
};

export type PluginOperationInput<
	Schema extends AnySchema = AnySchema,
	Name extends TableKey<Schema> = TableKey<Schema>,
	Meta = BetterMeta,
	State extends PluginState = PluginState,
	Kind extends PluginHookKind = PluginHookKind,
> = {
	args: PluginOperationArgsMap<Schema, Name, Meta>[Kind];
	data?: Kind extends 'create'
		? InsertModelFor<Schema, Name>
		: Kind extends 'createMany'
			? InsertModelFor<Schema, Name>[]
			: Kind extends 'update' | 'updateMany'
				? Partial<InsertModelFor<Schema, Name>>
				: Kind extends 'upsert'
					? {
							create: InsertModelFor<Schema, Name>;
							update: Partial<InsertModelFor<Schema, Name>>;
						}
					: never;
	db: unknown;
	dialect: PluginDialect;
	include?: PluginOperationArgsMap<Schema, Name, Meta>[Kind] extends {
		include?: infer Include;
	}
		? Include
		: never;
	kind: Kind;
	meta: Meta | undefined;
	model: PluginModelInfo<Schema, Name>;
	options: BetterClientOptions<Schema, Meta, readonly Plugin[]>;
	orderBy?: PluginOperationArgsMap<Schema, Name, Meta>[Kind] extends {
		orderBy?: infer OrderBy;
	}
		? OrderBy
		: never;
	cursor?: PluginOperationArgsMap<Schema, Name, Meta>[Kind] extends {
		cursor?: infer Cursor;
	}
		? Cursor
		: never;
	schema: Schema;
	select?: PluginOperationArgsMap<Schema, Name, Meta>[Kind] extends {
		select?: infer Select;
	}
		? Select
		: never;
	skip?: PluginOperationArgsMap<Schema, Name, Meta>[Kind] extends {
		skip?: infer Skip;
	}
		? Skip
		: never;
	state: State;
	table: Name;
	take?: PluginOperationArgsMap<Schema, Name, Meta>[Kind] extends {
		take?: infer Take;
	}
		? Take
		: never;
	where?: PluginOperationArgsMap<Schema, Name, Meta>[Kind] extends {
		where?: infer Where;
	}
		? Where
		: never;
};

type PluginBeforeHookContext<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	State extends PluginState,
	Kind extends PluginHookKind,
> = PluginOperationInput<Schema, Name, Meta, State, Kind> & {
	client: BetterDrizzleModelDelegate<Schema, Name, Meta>;
};

type PluginAfterHookContext<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Meta,
	State extends PluginState,
	Kind extends PluginHookKind,
> = PluginBeforeHookContext<Schema, Name, Meta, State, Kind> & {
	result: PluginOperationResultMap<Schema, Name, Meta>[Kind];
};

export type PluginHooks<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	State extends PluginState = PluginState,
> = {
	afterCreate?(
		context: PluginAfterHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			'create' | 'createMany' | 'upsert'
		>,
	): unknown;
	afterDelete?(
		context: PluginAfterHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			'delete' | 'deleteMany'
		>,
	): unknown;
	afterQuery?(
		context: PluginAfterHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			| 'count'
			| 'exists'
			| 'findFirst'
			| 'findMany'
			| 'findOne'
			| 'findUnique'
			| 'paginate'
		>,
	): unknown;
	afterUpdate?(
		context: PluginAfterHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			'update' | 'updateMany'
		>,
	): unknown;
	beforeCreate?(
		context: PluginBeforeHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			'create' | 'createMany' | 'upsert'
		>,
	):
		| PluginBeforeHookContext<
				Schema,
				BetterTableKey<Schema>,
				Meta,
				State,
				'create' | 'createMany' | 'upsert'
		  >['data']
		| undefined;
	beforeDelete?(
		context: PluginBeforeHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			'delete' | 'deleteMany'
		>,
	): unknown;
	beforeQuery?(
		context: PluginBeforeHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			| 'count'
			| 'exists'
			| 'findFirst'
			| 'findMany'
			| 'findOne'
			| 'findUnique'
			| 'paginate'
		>,
	): unknown;
	beforeUpdate?(
		context: PluginBeforeHookContext<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			'update' | 'updateMany'
		>,
	):
		| PluginBeforeHookContext<
				Schema,
				BetterTableKey<Schema>,
				Meta,
				State,
				'update' | 'updateMany'
		  >['data']
		| undefined;
};

export type PluginTransform<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	State extends PluginState = PluginState,
> = (
	operation: PluginOperationInput<
		Schema,
		BetterTableKey<Schema>,
		Meta,
		State,
		PluginHookKind
	>,
) =>
	| PluginOperationInput<
			Schema,
			BetterTableKey<Schema>,
			Meta,
			State,
			PluginHookKind
	  >
	| undefined;

export type PluginSetupContext<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	State extends PluginState = PluginState,
> = {
	addHook(hook: PluginHooks<Schema, Meta, State>): void;
	addTransform(transform: PluginTransform<Schema, Meta, State>): void;
	dialect: PluginDialect;
	isColumnExists(model: string, column: string): boolean;
	models: ModelRegistry<Schema>;
	plugin: PluginMeta;
	schema: Schema;
};

export type PluginModelExtensionContext<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
> = {
	client: BetterDrizzleModelDelegate<Schema, BetterTableKey<Schema>, Meta>;
	db: unknown;
	dialect: PluginDialect;
	model: PluginModelInfo<Schema, BetterTableKey<Schema>>;
	plugin: PluginMeta;
	schema: Schema;
};

export type PluginClientExtensionContext<
	Schema extends AnySchema = AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly Plugin[] = readonly Plugin[],
> = {
	client: BetterDrizzleClient<Schema, Meta, Plugins>;
	db: unknown;
	dialect: PluginDialect;
	models: ModelRegistry<Schema>;
	plugin: PluginMeta;
	schema: Schema;
};

export interface Plugin<
	Options = unknown,
	ClientExtension extends PluginExtension = Record<never, never>,
	ModelExtension extends PluginExtension = Record<never, never>,
	State extends PluginState = PluginState,
> extends PluginMeta<Options> {
	config?: PluginConfig;
	extendClient?<
		Schema extends AnySchema,
		Meta,
		Plugins extends readonly Plugin[],
	>(
		context: PluginClientExtensionContext<Schema, Meta, Plugins>,
	): ClientExtension | undefined;
	extendModel?<Schema extends AnySchema, Meta>(
		context: PluginModelExtensionContext<Schema, Meta>,
	): ModelExtension | undefined;
	hooks?: PluginHooks<AnySchema, BetterMeta, State>;
	setup?<Schema extends AnySchema, Meta>(
		context: PluginSetupContext<Schema, Meta, State>,
	): void;
	transform?: PluginTransform<AnySchema, BetterMeta, State>;
}

export type ClientExtensionOf<PluginDef> =
	PluginDef extends Plugin<
		unknown,
		infer Extension,
		PluginExtension,
		PluginState
	>
		? Extension
		: Record<never, never>;

export type ModelExtensionOf<PluginDef> =
	PluginDef extends Plugin<
		unknown,
		PluginExtension,
		infer Extension,
		PluginState
	>
		? Extension
		: Record<never, never>;

export type UnionToIntersection<Value> = (
	Value extends unknown
		? (input: Value) => void
		: never
) extends (input: infer Intersection) => void
	? Intersection
	: never;

export type ClientExtensionsOf<Plugins extends readonly Plugin[]> =
	UnionToIntersection<
		ClientExtensionOf<Plugins[number]>
	> extends infer Extension
		? Extension extends Record<string, unknown>
			? Extension
			: Record<never, never>
		: Record<never, never>;

export type ModelExtensionsOf<Plugins extends readonly Plugin[]> =
	UnionToIntersection<
		ModelExtensionOf<Plugins[number]>
	> extends infer Extension
		? Extension extends Record<string, unknown>
			? Extension
			: Record<never, never>
		: Record<never, never>;

export const definePlugin = <
	const PluginDef extends Plugin<
		unknown,
		PluginExtension,
		PluginExtension,
		PluginState
	>,
>(
	plugin: PluginDef,
) => plugin;
