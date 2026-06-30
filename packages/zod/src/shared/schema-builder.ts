import type { AnySchema, BetterTableKey, TableKey } from 'better-drizzle';
import type { AnyColumn, Table } from 'drizzle-orm';
import { z } from 'zod';

import type {
	BetterDrizzleZodModelSchemas,
	ZodPluginBehavior,
	ZodPluginOptions,
} from '../types';

export type RelationMeta = {
	isMany: boolean;
	isNullable: boolean;
	tableName: string;
};

export type TableSchemaEntry = {
	columns: Record<string, AnyColumn>;
	dbName: string;
	queryInputSchema: z.AnyZodObject;
	relations: Record<string, RelationMeta>;
	schemas: BetterDrizzleZodModelSchemas<any, any>;
	selectInputSchema: z.AnyZodObject;
	table: Table;
	tableName: string;
};

export type TableRegistry = Map<string, TableSchemaEntry>;

type SchemaMode = 'create' | 'select' | 'update';
type SchemaObjectBlock = {
	extend?: Record<string, z.ZodTypeAny>;
	omit?: readonly string[];
	partial?: boolean;
};

const DEFAULT_UNKNOWN_KEYS = 'strip';

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isZodSchema = (value: unknown): value is z.ZodTypeAny =>
	value instanceof z.ZodType;

const getUnknownKeysBehavior = (behavior: ZodPluginBehavior | undefined) =>
	behavior?.unknownKeys ?? DEFAULT_UNKNOWN_KEYS;

const applyUnknownKeys = (
	schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
	behavior: ZodPluginBehavior | undefined,
) => {
	const mode = getUnknownKeysBehavior(behavior);

	if (mode === 'strict') return schema.strict();
	if (mode === 'passthrough') return schema.passthrough();
	return schema.strip();
};

const sqlTypeIncludes = (column: AnyColumn, token: string) =>
	column.getSQLType().toLowerCase().includes(token);

const hasCoerce = (
	behavior: ZodPluginBehavior | undefined,
	key: 'bigint' | 'boolean' | 'date' | 'number' | 'string',
) =>
	behavior?.coerce === true ||
	(behavior?.coerce !== false && behavior?.coerce?.[key] === true);

const baseStringSchema = (
	column: AnyColumn,
	behavior: ZodPluginBehavior | undefined,
) => {
	const schema = hasCoerce(behavior, 'string')
		? z.coerce.string()
		: z.string();

	if (sqlTypeIncludes(column, 'uuid')) return schema.uuid();

	return schema;
};

const baseNumberSchema = (
	column: AnyColumn,
	behavior: ZodPluginBehavior | undefined,
) => {
	if (
		sqlTypeIncludes(column, 'numeric') ||
		sqlTypeIncludes(column, 'decimal')
	)
		return hasCoerce(behavior, 'number') ? z.coerce.number() : z.string();

	const schema = hasCoerce(behavior, 'number')
		? z.coerce.number()
		: z.number();

	return sqlTypeIncludes(column, 'int') ? schema.int() : schema;
};

const baseBigintSchema = (behavior: ZodPluginBehavior | undefined) =>
	hasCoerce(behavior, 'bigint') ? z.coerce.bigint() : z.string();

const baseDateSchema = (behavior: ZodPluginBehavior | undefined) =>
	hasCoerce(behavior, 'date') ? z.coerce.date() : z.date();

const baseBooleanSchema = (behavior: ZodPluginBehavior | undefined) =>
	hasCoerce(behavior, 'boolean') ? z.coerce.boolean() : z.boolean();

const baseColumnSchema = (
	column: AnyColumn,
	behavior: ZodPluginBehavior | undefined,
) => {
	const enumValues =
		'enumValues' in column && Array.isArray(column.enumValues)
			? column.enumValues
			: undefined;

	if (enumValues?.length) return z.enum(enumValues as [string, ...string[]]);

	if (column.dataType === 'boolean') return baseBooleanSchema(behavior);
	if (column.dataType === 'date') return baseDateSchema(behavior);
	if (column.dataType === 'bigint') return baseBigintSchema(behavior);
	if (column.dataType === 'number') return baseNumberSchema(column, behavior);
	if (column.dataType === 'json') return z.unknown();
	if (column.dataType === 'buffer') return z.instanceof(Buffer);
	if (
		column.dataType === 'string' ||
		sqlTypeIncludes(column, 'text') ||
		sqlTypeIncludes(column, 'char')
	)
		return baseStringSchema(column, behavior);

	if (sqlTypeIncludes(column, 'bigint')) return baseBigintSchema(behavior);
	if (sqlTypeIncludes(column, 'timestamp') || sqlTypeIncludes(column, 'date'))
		return baseDateSchema(behavior);
	if (sqlTypeIncludes(column, 'bool')) return baseBooleanSchema(behavior);
	if (sqlTypeIncludes(column, 'int'))
		return baseNumberSchema(column, behavior);
	if (sqlTypeIncludes(column, 'json')) return z.unknown();
	if (sqlTypeIncludes(column, 'uuid'))
		return baseStringSchema(column, behavior);

	return z.unknown();
};

const getBlockConfig = <
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
>(
	options: ZodPluginOptions<Schema>,
	tableName: Name,
	dbName: string,
	key:
		| 'create'
		| 'orderBy'
		| 'pagination'
		| 'query'
		| 'select'
		| 'update'
		| 'upsert'
		| 'where',
): SchemaObjectBlock | undefined => {
	const byName = options.schemas?.[tableName];
	if (byName?.[key]) return byName[key];

	const byDbName = options.schemas?.[dbName as Name];
	return byDbName?.[key];
};

const getFieldOverrides = <
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
>(
	options: ZodPluginOptions<Schema>,
	tableName: Name,
	dbName: string,
) => {
	const byName = options.schemas?.[tableName]?.fields;
	if (byName) return byName;

	return options.schemas?.[dbName as Name]?.fields;
};

const applyFieldOverride = (
	override: unknown,
	schema: z.ZodTypeAny,
): z.ZodTypeAny | false => {
	if (override === false) return false;
	if (isZodSchema(override)) return override;
	if (typeof override === 'function')
		return (override as (schema: z.ZodTypeAny) => z.ZodTypeAny)(schema);
	return schema;
};

const isGeneratedColumn = (column: AnyColumn) =>
	('generated' in column &&
		typeof column.generated === 'object' &&
		column.generated?.type === 'always') ||
	('generatedIdentity' in column &&
		typeof column.generatedIdentity === 'object' &&
		column.generatedIdentity?.type === 'always');

const getOptionality = (column: AnyColumn, mode: SchemaMode) => {
	if (mode === 'select')
		return { nullable: !column.notNull, optional: false };
	if (mode === 'update') return { nullable: !column.notNull, optional: true };

	return {
		nullable: !column.notNull,
		optional: !column.notNull || column.hasDefault,
	};
};

const applyColumnRules = (
	schema: z.ZodTypeAny,
	column: AnyColumn,
	mode: SchemaMode,
) => {
	const { nullable, optional } = getOptionality(column, mode);
	let next = schema;

	if (nullable) next = next.nullable();
	if (optional) next = next.optional();

	return next;
};

export const buildRowShape = <
	Schema extends AnySchema,
	Name extends TableKey<Schema>,
>(
	columns: Record<string, AnyColumn>,
	behavior: ZodPluginBehavior | undefined,
	options: ZodPluginOptions<Schema>,
	tableName: Name,
	dbName: string,
	mode: SchemaMode,
) => {
	const shape: Record<string, z.ZodTypeAny> = Object.create(null);
	const fieldOverrides = getFieldOverrides(options, tableName, dbName);

	for (const [columnName, column] of Object.entries(columns)) {
		if (mode !== 'select' && isGeneratedColumn(column)) continue;

		const baseSchema = baseColumnSchema(column, behavior);
		const override =
			fieldOverrides?.[columnName as keyof typeof fieldOverrides];
		const overridden = applyFieldOverride(override, baseSchema);

		if (overridden === false) continue;
		shape[columnName] = applyColumnRules(overridden, column, mode);
	}

	return shape;
};

export const applySchemaBlock = <
	Schema extends AnySchema,
	_Name extends TableKey<Schema>,
>(
	schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
	behavior: ZodPluginBehavior | undefined,
	block: SchemaObjectBlock | undefined,
) => {
	let next = schema;

	if (block?.omit?.length) {
		const omitShape = Object.create(null) as Record<string, true>;
		for (const key of block.omit as readonly string[])
			omitShape[key] = true;
		next = next.omit(omitShape);
	}

	if (block?.extend) next = next.extend(block.extend);
	if (block?.partial) next = next.partial();

	return applyUnknownKeys(next, behavior);
};

const createComparableFilterSchema = (valueSchema: z.ZodTypeAny) => {
	const filter: z.ZodTypeAny = z.lazy(() =>
		z.object({
			equals: valueSchema.optional(),
			gt: valueSchema.optional(),
			gte: valueSchema.optional(),
			in: z.array(valueSchema).optional(),
			lt: valueSchema.optional(),
			lte: valueSchema.optional(),
			not: z.union([valueSchema, filter]).optional(),
			notIn: z.array(valueSchema).optional(),
		}),
	);

	return z.union([valueSchema, filter]);
};

const createStringFilterSchema = (valueSchema: z.ZodTypeAny) => {
	const filter: z.ZodTypeAny = z.lazy(() =>
		z.object({
			contains: z.string().optional(),
			endsWith: z.string().optional(),
			equals: valueSchema.optional(),
			in: z.array(valueSchema).optional(),
			mode: z.enum(['default', 'insensitive']).optional(),
			not: z.union([valueSchema, filter]).optional(),
			notIn: z.array(valueSchema).optional(),
			startsWith: z.string().optional(),
		}),
	);

	return z.union([valueSchema, filter]);
};

const createBooleanFilterSchema = (valueSchema: z.ZodTypeAny) => {
	const filter: z.ZodTypeAny = z.lazy(() =>
		z.object({
			equals: valueSchema.optional(),
			not: z.union([valueSchema, filter]).optional(),
		}),
	);

	return z.union([valueSchema, filter]);
};

const createDefaultFilterSchema = (valueSchema: z.ZodTypeAny) => {
	const filter: z.ZodTypeAny = z.lazy(() =>
		z.object({
			equals: valueSchema.optional(),
			not: z.union([valueSchema, filter]).optional(),
		}),
	);

	return z.union([valueSchema, filter]);
};

const createScalarWhereSchema = (columnSchema: z.ZodTypeAny) => {
	const directValue =
		columnSchema instanceof z.ZodOptional
			? columnSchema.unwrap()
			: columnSchema;
	const nullableValue =
		directValue instanceof z.ZodNullable
			? directValue.unwrap()
			: directValue;

	if (nullableValue instanceof z.ZodString)
		return createStringFilterSchema(directValue);
	if (
		nullableValue instanceof z.ZodNumber ||
		nullableValue instanceof z.ZodBigInt ||
		nullableValue instanceof z.ZodDate
	)
		return createComparableFilterSchema(directValue);
	if (nullableValue instanceof z.ZodBoolean)
		return createBooleanFilterSchema(directValue);

	return createDefaultFilterSchema(directValue);
};

export const createOrderBySchema = (
	scalarKeys: string[],
	behavior: ZodPluginBehavior | undefined,
) => {
	const shape: Record<string, z.ZodTypeAny> = Object.create(null);

	for (const key of scalarKeys)
		shape[key] = z.enum(['asc', 'desc']).optional();

	const objectSchema = applyUnknownKeys(z.object(shape), behavior);
	return z.union([objectSchema, z.array(objectSchema)]);
};

export const createCursorSchema = (
	shape: Record<string, z.ZodTypeAny>,
	behavior: ZodPluginBehavior | undefined,
) => applyUnknownKeys(z.object(shape).partial(), behavior);

export const createLockSchema = () =>
	z.union([
		z.enum(['share', 'update']),
		z.object({
			mode: z.enum(['keyShare', 'noKeyUpdate', 'share', 'update']),
			noWait: z.boolean().optional(),
			skipLocked: z.boolean().optional(),
			tables: z.array(z.string()).optional(),
		}),
	]);

export const createSelectInputSchema = (
	entry: TableSchemaEntry,
	getQueryArgsSchema: (entry: TableSchemaEntry) => z.AnyZodObject,
	behavior: ZodPluginBehavior | undefined,
	registry: TableRegistry,
) => {
	const shape: Record<string, z.ZodTypeAny> = Object.create(null);

	for (const key of Object.keys(entry.schemas.select.shape))
		shape[key] = z.boolean().optional();

	for (const [relationName, relation] of Object.entries(entry.relations)) {
		const target = registry.get(relation.tableName);
		if (!target) continue;
		shape[relationName] = z
			.union([z.literal(true), z.lazy(() => getQueryArgsSchema(target))])
			.optional();
	}

	return applyUnknownKeys(z.object(shape), behavior);
};

export const createIncludeInputSchema = (
	entry: TableSchemaEntry,
	getQueryArgsSchema: (entry: TableSchemaEntry) => z.AnyZodObject,
	behavior: ZodPluginBehavior | undefined,
	registry: TableRegistry,
) => {
	const shape: Record<string, z.ZodTypeAny> = Object.create(null);

	for (const [relationName, relation] of Object.entries(entry.relations)) {
		const target = registry.get(relation.tableName);
		if (!target) continue;
		shape[relationName] = z
			.union([z.literal(true), z.lazy(() => getQueryArgsSchema(target))])
			.optional();
	}

	return applyUnknownKeys(z.object(shape), behavior);
};

export const createWhereSchema = <Schema extends AnySchema>(
	entry: TableSchemaEntry,
	behavior: ZodPluginBehavior | undefined,
	registry: TableRegistry,
	options: ZodPluginOptions<Schema>,
) => {
	const shape: Record<string, z.ZodTypeAny> = Object.create(null);
	const self = z.lazy(() => entry.schemas.where);

	shape.AND = z.array(self).optional();
	shape.NOT = z.union([self, z.array(self)]).optional();
	shape.OR = z.array(self).optional();

	for (const [columnName, columnSchema] of Object.entries(
		entry.schemas.select.shape,
	))
		shape[columnName] = createScalarWhereSchema(
			columnSchema as z.ZodTypeAny,
		).optional();

	for (const [relationName, relation] of Object.entries(entry.relations)) {
		const target = registry.get(relation.tableName);
		if (!target) continue;
		const targetWhere = z.lazy(() => target.schemas.where);

		shape[relationName] = relation.isMany
			? applyUnknownKeys(
					z.object({
						every: targetWhere.optional(),
						none: targetWhere.optional(),
						some: targetWhere.optional(),
					}),
					behavior,
				).optional()
			: applyUnknownKeys(
					z.object({
						is: z.union([targetWhere, z.null()]).optional(),
						isNot: z.union([targetWhere, z.null()]).optional(),
					}),
					behavior,
				).optional();
	}

	return applySchemaBlock(
		z.object(shape),
		behavior,
		getBlockConfig(
			options,
			entry.tableName as BetterTableKey<Schema>,
			entry.dbName,
			'where',
		),
	);
};

export const createQueryArgsSchema = <Schema extends AnySchema>(
	entry: TableSchemaEntry,
	behavior: ZodPluginBehavior | undefined,
	options: ZodPluginOptions<Schema>,
	getCursorSchema: (entry: TableSchemaEntry) => z.AnyZodObject,
	getIncludeInputSchema: (entry: TableSchemaEntry) => z.AnyZodObject,
	getSelectInputSchema: (entry: TableSchemaEntry) => z.AnyZodObject,
) =>
	applySchemaBlock(
		applyUnknownKeys(
			z.object({
				cursor: getCursorSchema(entry).optional(),
				include: getIncludeInputSchema(entry).optional(),
				lock: createLockSchema().optional(),
				orderBy: entry.schemas.orderBy.optional(),
				select: getSelectInputSchema(entry).optional(),
				skip: z.number().int().optional(),
				take: z.number().int().optional(),
				where: entry.schemas.where.optional(),
			}),
			behavior,
		),
		behavior,
		getBlockConfig(
			options,
			entry.tableName as BetterTableKey<Schema>,
			entry.dbName,
			'query',
		),
	);

export const createPaginationSchema = <Schema extends AnySchema>(
	entry: TableSchemaEntry,
	behavior: ZodPluginBehavior | undefined,
	options: ZodPluginOptions<Schema>,
	getCursorSchema: (entry: TableSchemaEntry) => z.AnyZodObject,
	getIncludeInputSchema: (entry: TableSchemaEntry) => z.AnyZodObject,
	getSelectInputSchema: (entry: TableSchemaEntry) => z.AnyZodObject,
) =>
	applySchemaBlock(
		applyUnknownKeys(
			z.object({
				cursor: getCursorSchema(entry).optional(),
				include: getIncludeInputSchema(entry).optional(),
				limit: z.number().int().optional(),
				lock: createLockSchema().optional(),
				orderBy: entry.schemas.orderBy.optional(),
				select: getSelectInputSchema(entry).optional(),
				skip: z.number().int().optional(),
				take: z.number().int().optional(),
				where: entry.schemas.where.optional(),
			}),
			behavior,
		),
		behavior,
		getBlockConfig(
			options,
			entry.tableName as BetterTableKey<Schema>,
			entry.dbName,
			'pagination',
		),
	);

export const createSelectResultSchema = (
	entry: TableSchemaEntry,
	registry: TableRegistry,
	behavior: ZodPluginBehavior | undefined,
	kind: 'include' | 'select',
	input: Record<string, unknown>,
): z.ZodTypeAny => {
	const shape: Record<string, z.ZodTypeAny> = Object.create(null);

	if (kind === 'include') {
		const selectShape = entry.schemas.select.shape;
		for (const key of Object.keys(selectShape))
			shape[key] = selectShape[key];
	}

	for (const [key, value] of Object.entries(input)) {
		if (key in entry.schemas.select.shape) {
			if (value === true) shape[key] = entry.schemas.select.shape[key];
			continue;
		}

		const relation = entry.relations[key];
		if (!relation) continue;

		const target = registry.get(relation.tableName);
		if (!target) continue;

		const nestedSchema =
			value === true
				? target.schemas.select
				: createResultSchema(target, registry, behavior, value);

		shape[key] = relation.isMany
			? z.array(nestedSchema)
			: relation.isNullable
				? nestedSchema.nullable()
				: nestedSchema;
	}

	return applyUnknownKeys(z.object(shape), behavior);
};

export const createResultSchema = (
	entry: TableSchemaEntry,
	registry: TableRegistry,
	behavior: ZodPluginBehavior | undefined,
	args: unknown,
) => {
	if (!isPlainRecord(args)) return entry.schemas.select;
	if (isPlainRecord(args.select))
		return createSelectResultSchema(
			entry,
			registry,
			behavior,
			'select',
			args.select,
		);
	if (isPlainRecord(args.include))
		return createSelectResultSchema(
			entry,
			registry,
			behavior,
			'include',
			args.include,
		);

	return entry.schemas.select;
};

export const createOperationMetaShape = () => ({
	meta: z.unknown().optional(),
	validate: z.boolean().optional(),
});

export const createQueryResultSchema = (
	rowSchema: z.ZodTypeAny,
	mode:
		| 'cursor'
		| 'findFirst'
		| 'findMany'
		| 'findOne'
		| 'findUnique'
		| 'paginate',
) => {
	if (mode === 'findMany') return z.array(rowSchema);
	if (mode === 'paginate')
		return z.object({
			data: z.array(rowSchema),
			pagination: z.object({
				hasNext: z.boolean(),
				hasPrevious: z.boolean(),
				page: z.number(),
				pageCount: z.number(),
				perPage: z.number(),
				total: z.number(),
				type: z.literal('offset'),
			}),
		});
	if (mode === 'cursor')
		return z.object({
			data: z.array(rowSchema),
			pagination: z.object({
				hasNext: z.boolean(),
				hasPrevious: z.boolean(),
				nextCursor: z.custom<Record<string, unknown> | null>(),
				previousCursor: z.custom<Record<string, unknown> | null>(),
				type: z.literal('cursor'),
			}),
		});

	return rowSchema.nullable();
};
