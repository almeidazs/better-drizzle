import type {
	AnyPlugin,
	AnySchema,
	BetterTableKey,
	CursorArgs,
	InsertModelFor,
	OrderType,
	PaginationArgs,
	PluginModelExtensionContext,
	QueryArgs,
	ScalarKeysFor,
	SelectModelFor,
	TableKey,
	WhereInput,
} from 'better-drizzle';
import type { z } from 'zod';

// biome-ignore lint/suspicious/noExplicitAny: local escape hatch for generic type extraction
type Any = any;

type ScalarFieldName<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<keyof SelectModelFor<Schema, Name>, string>;

type Simplify<T> = {
	[K in keyof T]: T[K];
} & {};

type RemoveIndexSignature<T> = {
	[K in keyof T as string extends K
		? never
		: number extends K
			? never
			: symbol extends K
				? never
				: K]: T[K];
};

type InsertScalarShape<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	[K in Extract<
		ScalarKeysFor<Schema, Name>,
		keyof InsertModelFor<Schema, Name>
	>]: InsertModelFor<Schema, Name>[K];
};

type SelectScalarShape<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	[K in ScalarKeysFor<Schema, Name>]: SelectModelFor<Schema, Name>[K];
};

type FieldSchemaOverride<SchemaType extends z.ZodTypeAny = z.ZodTypeAny> =
	| false
	| z.ZodTypeAny
	| ((schema: SchemaType) => z.ZodTypeAny);

type SchemaBlock<Schema extends AnySchema, Name extends TableKey<Schema>> = {
	extend?: Record<string, z.ZodTypeAny>;
	omit?: readonly ScalarFieldName<Schema, Name>[];
	partial?: boolean;
};

/**
 * Controls how the Zod plugin handles type coercion and unknown keys.
 *
 * @property coerce - When `true`, coerces all supported types. Accepts a partial
 *   record to enable coercion per type. When `false` or omitted, no coercion is applied.
 * @property unknownKeys - Determines how Zod handles keys not present in the schema.
 *   - `'strip'` (default): removes unknown keys from parsed output.
 *   - `'passthrough'`: preserves unknown keys as-is.
 *   - `'strict'`: rejects objects containing unknown keys.
 */
export type ZodPluginBehavior = {
	coerce?:
		| boolean
		| Partial<
				Record<
					'bigint' | 'boolean' | 'date' | 'number' | 'string',
					true
				>
		  >;
	unknownKeys?: 'passthrough' | 'strict' | 'strip';
};

/**
 * Per-operation validation toggle. Each key corresponds to a Better Drizzle
 * operation kind. Set a key to `true` to enable validation, `false` to disable,
 * or omit it to fall back to the plugin's default behavior.
 */
export type ZodPluginValidateOptions = Partial<
	Record<
		| 'count'
		| 'create'
		| 'createMany'
		| 'cursor'
		| 'delete'
		| 'deleteMany'
		| 'exists'
		| 'findFirst'
		| 'findMany'
		| 'findOne'
		| 'findUnique'
		| 'paginate'
		| 'query'
		| 'result'
		| 'update'
		| 'updateEach'
		| 'updateMany'
		| 'upsert'
		| 'upsertMany',
		boolean
	>
>;

/**
 * Schema customization block for a specific table. Allows extending, omitting,
 * or marking fields as partial for each operation schema (create, update, select, etc.).
 *
 * @typeParam Schema - The full Drizzle schema object.
 * @typeParam Name - The table key within the schema.
 */
export type ZodPluginTableSchemasConfig<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = {
	create?: SchemaBlock<Schema, Name>;
	fields?: Partial<{
		[K in ScalarFieldName<Schema, Name>]: FieldSchemaOverride<
			z.ZodType<SelectModelFor<Schema, Name>[K]>
		>;
	}>;
	orderBy?: SchemaBlock<Schema, Name>;
	pagination?: SchemaBlock<Schema, Name>;
	query?: SchemaBlock<Schema, Name>;
	select?: SchemaBlock<Schema, Name>;
	update?: SchemaBlock<Schema, Name>;
	upsert?: SchemaBlock<Schema, Name>;
	where?: SchemaBlock<Schema, Name>;
};

/**
 * Configuration options for the `@better-drizzle/zod` plugin.
 *
 * @typeParam Schema - The full Drizzle schema object.
 * @property behavior - Global coercion and unknown-keys behavior applied to all tables.
 * @property schemas - Per-table schema customizations (field overrides, extend, omit, partial).
 * @property validate - Per-operation validation toggles. Overrides can also be set per call
 *   via the `validate` operation arg.
 */
export type ZodPluginOptions<Schema extends AnySchema = AnySchema> = {
	behavior?: ZodPluginBehavior;
	schemas?: Partial<{
		[K in BetterTableKey<Schema>]: ZodPluginTableSchemasConfig<Schema, K>;
	}>;
	validate?: ZodPluginValidateOptions;
};

type TableSchemaConfigFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = Name extends keyof NonNullable<Options['schemas']>
	? NonNullable<Options['schemas']>[Name]
	: never;

type FieldsConfigFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> =
	TableSchemaConfigFor<Schema, Name, Options> extends {
		fields?: infer Fields;
	}
		? NonNullable<Fields>
		: never;

type BlockConfigFor<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
	Key extends keyof ZodPluginTableSchemasConfig<Schema, Name>,
> =
	TableSchemaConfigFor<Schema, Name, Options> extends Record<Key, infer Block>
		? NonNullable<Block>
		: TableSchemaConfigFor<Schema, Name, Options> extends {
					[K in Key]?: infer Block;
				}
			? NonNullable<Block>
			: never;

type ResolveOverrideOutput<Override, Base> = Override extends false
	? never
	: Override extends z.ZodTypeAny
		? z.output<Override>
		: Override extends (schema: Any) => infer Result
			? Result extends z.ZodTypeAny
				? z.output<Result>
				: Base
			: Base;

type ResolveOverrideInput<Override, Base> = Override extends false
	? never
	: Override extends z.ZodTypeAny
		? z.input<Override>
		: Override extends (schema: Any) => infer Result
			? Result extends z.ZodTypeAny
				? z.input<Result>
				: Base
			: Base;

type ApplyFieldOverridesOutput<
	Shape extends Record<string, unknown>,
	Overrides,
> = Simplify<{
	[K in keyof Shape as ResolveOverrideOutput<
		K extends keyof NonNullable<Overrides>
			? NonNullable<Overrides>[K]
			: never,
		Shape[K]
	> extends never
		? never
		: K]: ResolveOverrideOutput<
		K extends keyof NonNullable<Overrides>
			? NonNullable<Overrides>[K]
			: never,
		Shape[K]
	>;
}>;

type ApplyFieldOverridesInput<
	Shape extends Record<string, unknown>,
	Overrides,
> = Simplify<{
	[K in keyof Shape as ResolveOverrideInput<
		K extends keyof NonNullable<Overrides>
			? NonNullable<Overrides>[K]
			: never,
		Shape[K]
	> extends never
		? never
		: K]: ResolveOverrideInput<
		K extends keyof NonNullable<Overrides>
			? NonNullable<Overrides>[K]
			: never,
		Shape[K]
	>;
}>;

type ApplyOmit<Shape extends Record<string, unknown>, Block> = Block extends {
	omit?: readonly PropertyKey[];
}
	? Omit<Shape, Extract<NonNullable<Block['omit']>[number], keyof Shape>>
	: Shape;

type ApplyExtendOutput<
	Shape extends Record<string, unknown>,
	Block,
> = Block extends { extend?: infer Extends }
	? Extends extends Record<string, z.ZodTypeAny>
		? Simplify<Shape & { [K in keyof Extends]: z.output<Extends[K]> }>
		: Shape
	: Shape;

type ApplyExtendInput<
	Shape extends Record<string, unknown>,
	Block,
> = Block extends { extend?: infer Extends }
	? Extends extends Record<string, z.ZodTypeAny>
		? Simplify<Shape & { [K in keyof Extends]: z.input<Extends[K]> }>
		: Shape
	: Shape;

type ApplyPartialFlag<
	Shape extends Record<string, unknown>,
	Block,
> = Block extends { partial?: true } ? Partial<Shape> : Shape;

type ApplyBlockOutput<
	Shape extends Record<string, unknown>,
	Block,
> = ApplyPartialFlag<ApplyExtendOutput<ApplyOmit<Shape, Block>, Block>, Block>;

type ApplyBlockInput<
	Shape extends Record<string, unknown>,
	Block,
> = ApplyPartialFlag<ApplyExtendInput<ApplyOmit<Shape, Block>, Block>, Block>;

type CreateBaseOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyFieldOverridesOutput<
	InsertScalarShape<Schema, Name>,
	FieldsConfigFor<Schema, Name, Options>
>;

type CreateBaseInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyFieldOverridesInput<
	InsertScalarShape<Schema, Name>,
	FieldsConfigFor<Schema, Name, Options>
>;

type SelectBaseOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyFieldOverridesOutput<
	SelectScalarShape<Schema, Name>,
	FieldsConfigFor<Schema, Name, Options>
>;

type SelectBaseInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyFieldOverridesInput<
	SelectScalarShape<Schema, Name>,
	FieldsConfigFor<Schema, Name, Options>
>;

type CreateOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockOutput<
	CreateBaseOutput<Schema, Name, Options>,
	BlockConfigFor<Schema, Name, Options, 'create'>
>;

type CreateInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockInput<
	CreateBaseInput<Schema, Name, Options>,
	BlockConfigFor<Schema, Name, Options, 'create'>
>;

type UpdateOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockOutput<
	Partial<CreateOutput<Schema, Name, Options>>,
	BlockConfigFor<Schema, Name, Options, 'update'>
>;

type UpdateInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockInput<
	Partial<CreateInput<Schema, Name, Options>>,
	BlockConfigFor<Schema, Name, Options, 'update'>
>;

type SelectOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockOutput<
	SelectBaseOutput<Schema, Name, Options>,
	BlockConfigFor<Schema, Name, Options, 'select'>
>;

type SelectInputShape<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockInput<
	SelectBaseInput<Schema, Name, Options>,
	BlockConfigFor<Schema, Name, Options, 'select'>
>;

type WhereOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockOutput<
	RemoveIndexSignature<WhereInput<Schema, Name>>,
	BlockConfigFor<Schema, Name, Options, 'where'>
>;

type WhereInputShape<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockInput<
	RemoveIndexSignature<WhereInput<Schema, Name>>,
	BlockConfigFor<Schema, Name, Options, 'where'>
>;

type QueryOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockOutput<
	RemoveIndexSignature<ZodPluginQueryInput<Schema, Name>>,
	BlockConfigFor<Schema, Name, Options, 'query'>
>;

type QueryInputShape<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockInput<
	RemoveIndexSignature<ZodPluginQueryInput<Schema, Name>>,
	BlockConfigFor<Schema, Name, Options, 'query'>
>;

type PaginationOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockOutput<
	RemoveIndexSignature<ZodPluginPaginationInput<Schema, Name>>,
	BlockConfigFor<Schema, Name, Options, 'pagination'>
>;

type PaginationInputShape<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockInput<
	RemoveIndexSignature<ZodPluginPaginationInput<Schema, Name>>,
	BlockConfigFor<Schema, Name, Options, 'pagination'>
>;

type OrderByOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = ZodPluginOrderByInput<Schema, Name>;

type OrderByInputShape<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = ZodPluginOrderByInput<Schema, Name>;

type UpsertOutput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockOutput<
	{
		create: CreateOutput<Schema, Name, Options>;
		update: UpdateOutput<Schema, Name, Options>;
		where: WhereOutput<Schema, Name, Options>;
	},
	BlockConfigFor<Schema, Name, Options, 'upsert'>
>;

type UpsertInputShape<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema>,
> = ApplyBlockInput<
	{
		create: CreateInput<Schema, Name, Options>;
		update: UpdateInput<Schema, Name, Options>;
		where: WhereInputShape<Schema, Name, Options>;
	},
	BlockConfigFor<Schema, Name, Options, 'upsert'>
>;

/**
 * The set of Zod schemas generated for a single table. Exposed on each model
 * as `db.<table>.$zod`.
 *
 * @typeParam Schema - The full Drizzle schema object.
 * @typeParam Name - The table key within the schema.
 */
export type BetterDrizzleZodModelSchemas<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema> = ZodPluginOptions<Schema>,
> = {
	create: z.ZodType<
		CreateOutput<Schema, Name, Options>,
		z.ZodTypeDef,
		CreateInput<Schema, Name, Options>
	>;
	orderBy: z.ZodType<
		OrderByOutput<Schema, Name>,
		z.ZodTypeDef,
		OrderByInputShape<Schema, Name>
	>;
	pagination: z.ZodType<
		PaginationOutput<Schema, Name, Options>,
		z.ZodTypeDef,
		PaginationInputShape<Schema, Name, Options>
	>;
	query: z.ZodType<
		QueryOutput<Schema, Name, Options>,
		z.ZodTypeDef,
		QueryInputShape<Schema, Name, Options>
	>;
	select: z.ZodType<
		SelectOutput<Schema, Name, Options>,
		z.ZodTypeDef,
		SelectInputShape<Schema, Name, Options>
	>;
	update: z.ZodType<
		UpdateOutput<Schema, Name, Options>,
		z.ZodTypeDef,
		UpdateInput<Schema, Name, Options>
	>;
	upsert: z.ZodType<
		UpsertOutput<Schema, Name, Options>,
		z.ZodTypeDef,
		UpsertInputShape<Schema, Name, Options>
	>;
	where: z.ZodType<
		WhereOutput<Schema, Name, Options>,
		z.ZodTypeDef,
		WhereInputShape<Schema, Name, Options>
	>;
};

/**
 * Model extension added by the Zod plugin. Attaches a `$zod` property to each
 * table delegate containing the generated Zod schemas.
 *
 * @typeParam Schema - The full Drizzle schema object.
 * @typeParam Name - The table key within the schema.
 */
export type BetterDrizzleZodModelExtension<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
	Options extends ZodPluginOptions<Schema> = ZodPluginOptions<Schema>,
> = {
	$zod: BetterDrizzleZodModelSchemas<Schema, Name, Options>;
};

/**
 * Resolver function signature used by the plugin system to compute per-table
 * model extensions. The Zod plugin provides a resolver that attaches `$zod`
 * schemas to each table delegate.
 */
export type BetterDrizzleZodModelExtensionResolver<
	Options extends ZodPluginOptions<AnySchema> = ZodPluginOptions<AnySchema>,
> = <
	Schema extends AnySchema,
	Name extends BetterTableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: PluginModelExtensionContext<Schema, Meta, Name, Plugins>,
) => BetterDrizzleZodModelExtension<
	Schema,
	Name,
	Extract<Options, ZodPluginOptions<Schema>>
>;

/**
 * Extracts the `orderBy` input type for a given table, excluding `meta`.
 * Useful for typing order-by arguments in custom validation or extension code.
 *
 * @typeParam Schema - The full Drizzle schema object.
 * @typeParam Name - The table key within the schema.
 */
export type ZodPluginOrderByInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = NonNullable<QueryArgs<Schema, Name>['orderBy']>;

/**
 * The query input type for a given table, with `meta` stripped.
 * Corresponds to the arguments accepted by `findMany`, `findFirst`, `findOne`,
 * and `findUnique`.
 *
 * @typeParam Schema - The full Drizzle schema object.
 * @typeParam Name - The table key within the schema.
 */
export type ZodPluginQueryInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Omit<QueryArgs<Schema, Name>, 'meta'>;

/**
 * The pagination input type for a given table, with `meta` stripped.
 * Corresponds to the arguments accepted by `paginate`.
 *
 * @typeParam Schema - The full Drizzle schema object.
 * @typeParam Name - The table key within the schema.
 */
export type ZodPluginPaginationInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Omit<PaginationArgs<Schema, Name>, 'meta'>;

/**
 * The cursor input type for a given table, with `meta` stripped.
 * Corresponds to the arguments accepted by `cursor`.
 *
 * @typeParam Schema - The full Drizzle schema object.
 * @typeParam Name - The table key within the schema.
 */
export type ZodPluginCursorInput<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Omit<CursorArgs<Schema, Name>, 'meta'>;

/** Re-exported from `better-drizzle` for convenience. */
export type { OrderType };
