import type {
	AnyPlugin,
	AnySchema,
	BetterTableKey,
	CursorArgs,
	OrderType,
	PaginationArgs,
	PluginModelExtensionContext,
	QueryArgs,
	SelectModelFor,
	TableKey,
} from 'better-drizzle';
import type { z } from 'zod';

type ScalarFieldName<
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
> = Extract<keyof SelectModelFor<Schema, Name>, string>;

type FieldSchemaOverride =
	| false
	| z.ZodTypeAny
	| ((schema: z.ZodTypeAny) => z.ZodTypeAny);

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
	fields?: Partial<
		Record<ScalarFieldName<Schema, Name>, FieldSchemaOverride>
	>;
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

/**
 * The set of Zod schemas generated for a single table. Exposed on each model
 * as `db.<table>.$zod`.
 *
 * @typeParam Schema - The full Drizzle schema object.
 * @typeParam Name - The table key within the schema.
 */
export type BetterDrizzleZodModelSchemas<
	Schema extends AnySchema,
	_Name extends TableKey<Schema>,
> = {
	create: z.AnyZodObject;
	orderBy: z.ZodTypeAny;
	pagination: z.AnyZodObject;
	query: z.AnyZodObject;
	select: z.AnyZodObject;
	update: z.AnyZodObject;
	upsert: z.AnyZodObject;
	where: z.AnyZodObject;
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
> = {
	$zod: BetterDrizzleZodModelSchemas<Schema, Name>;
};

/**
 * Resolver function signature used by the plugin system to compute per-table
 * model extensions. The Zod plugin provides a resolver that attaches `$zod`
 * schemas to each table delegate.
 */
export type BetterDrizzleZodModelExtensionResolver = <
	Schema extends AnySchema,
	Name extends BetterTableKey<Schema>,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: PluginModelExtensionContext<Schema, Meta, Name, Plugins>,
) => BetterDrizzleZodModelExtension<Schema, Name>;

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
