import type { AnySchema, BetterTableKey } from 'better-drizzle';
import {
	createTableRelationsHelpers,
	extractTablesRelationalConfig,
	getTableColumns,
	isTable,
	Many,
	One,
} from 'drizzle-orm';
import { z } from 'zod';

import type { ZodPluginOptions } from '../types';
import {
	applySchemaBlock,
	buildRowShape,
	createCursorSchema,
	createIncludeInputSchema,
	createOperationMetaShape,
	createOrderBySchema,
	createPaginationSchema,
	createQueryArgsSchema,
	createQueryResultSchema,
	createResultSchema,
	createSelectInputSchema,
	createWhereSchema,
	type RelationMeta,
	type TableRegistry,
	type TableSchemaEntry,
} from './schema-builder';

export type ZodSchemasRegistry = {
	get(tableName: string): TableSchemaEntry | undefined;
	getBatchResultSchema(tableName: string, args: unknown): z.ZodTypeAny;
	getCountArgsSchema(tableName: string): z.AnyZodObject;
	getCreateArgsSchema(tableName: string): z.AnyZodObject;
	getCreateManyArgsSchema(tableName: string): z.AnyZodObject;
	getCursorArgsSchema(tableName: string): z.AnyZodObject;
	getDeleteArgsSchema(tableName: string): z.AnyZodObject;
	getDeleteManyArgsSchema(tableName: string): z.AnyZodObject;
	getExistsArgsSchema(tableName: string): z.AnyZodObject;
	getPaginationArgsSchema(tableName: string): z.AnyZodObject;
	getQueryArgsSchema(tableName: string): z.AnyZodObject;
	getQueryResultSchema(
		tableName: string,
		args: unknown,
		mode:
			| 'cursor'
			| 'findFirst'
			| 'findMany'
			| 'findOne'
			| 'findUnique'
			| 'paginate',
	): z.ZodTypeAny;
	getSingleResultSchema(tableName: string, args: unknown): z.ZodTypeAny;
	getUpdateArgsSchema(tableName: string): z.AnyZodObject;
	getUpdateEachArgsSchema(tableName: string): z.AnyZodObject;
	getUpdateManyArgsSchema(tableName: string): z.AnyZodObject;
	getUpsertArgsSchema(tableName: string): z.AnyZodObject;
	getUpsertManyArgsSchema(tableName: string): z.AnyZodObject;
};

export const createZodSchemasRegistry = <Schema extends AnySchema>(
	schema: Schema,
	options: ZodPluginOptions<Schema>,
): ZodSchemasRegistry => {
	const behavior = options.behavior;
	const relational = extractTablesRelationalConfig(
		schema,
		createTableRelationsHelpers,
	);
	const registry: TableRegistry = new Map();

	for (const [tableName, tableValue] of Object.entries(schema)) {
		if (!isTable(tableValue)) continue;

		const tableConfig = relational.tables[tableName];
		if (!tableConfig) continue;

		const columns = getTableColumns(tableValue);
		const key = tableName as BetterTableKey<Schema>;
		const createShape = buildRowShape(
			columns,
			behavior,
			options,
			key,
			tableConfig.dbName,
			'create',
		);
		const selectShape = buildRowShape(
			columns,
			behavior,
			options,
			key,
			tableConfig.dbName,
			'select',
		);
		const updateShape = buildRowShape(
			columns,
			behavior,
			options,
			key,
			tableConfig.dbName,
			'update',
		);
		const createSchema = applySchemaBlock(
			z.object(createShape),
			behavior,
			options.schemas?.[key]?.create ??
				options.schemas?.[tableConfig.dbName as BetterTableKey<Schema>]
					?.create,
		);
		const updateSchema = applySchemaBlock(
			z.object(updateShape),
			behavior,
			options.schemas?.[key]?.update ??
				options.schemas?.[tableConfig.dbName as BetterTableKey<Schema>]
					?.update ?? { partial: true },
		);
		const selectSchema = applySchemaBlock(
			z.object(selectShape),
			behavior,
			options.schemas?.[key]?.select ??
				options.schemas?.[tableConfig.dbName as BetterTableKey<Schema>]
					?.select,
		);
		const upsertSchema = applySchemaBlock(
			z.object({
				create: createSchema,
				update: updateSchema,
				where: z.lazy(
					() => registry.get(tableName)?.schemas.where ?? z.unknown(),
				),
			}),
			behavior,
			options.schemas?.[key]?.upsert ??
				options.schemas?.[tableConfig.dbName as BetterTableKey<Schema>]
					?.upsert,
		);
		const relationMeta = Object.create(null) as Record<
			string,
			RelationMeta
		>;

		for (const [relationName, relation] of Object.entries(
			tableConfig.relations,
		)) {
			const referencedTable =
				relational.tableNamesMap[
					`public.${relation.referencedTableName}`
				] ??
				relational.tableNamesMap[relation.referencedTableName] ??
				relation.referencedTableName;

			relationMeta[relationName] = {
				isMany: relation instanceof Many,
				isNullable:
					relation instanceof One ? relation.isNullable : false,
				tableName: referencedTable,
			};
		}

		registry.set(tableName, {
			columns,
			dbName: tableConfig.dbName,
			queryInputSchema: z.object({}),
			relations: relationMeta,
			schemas: {
				create: createSchema,
				orderBy: createOrderBySchema(
					Object.keys(selectShape),
					behavior,
				),
				pagination: z.object({}),
				query: z.object({}),
				select: selectSchema,
				update: updateSchema,
				upsert: upsertSchema,
				where: z.object({}),
			},
			selectInputSchema: z.object({}),
			table: tableValue,
			tableName,
		});
	}

	const getEntry = (tableName: string) => {
		const entry = registry.get(tableName);
		if (!entry)
			throw new Error(
				`Missing zod schema entry for table "${tableName}".`,
			);
		return entry;
	};

	const getCursorInputSchema = (entry: TableSchemaEntry) =>
		createCursorSchema(entry.schemas.select.shape, behavior);

	const getSelectSchema = (entry: TableSchemaEntry) =>
		createSelectInputSchema(entry, getQuerySchema, behavior, registry);

	const getIncludeSchema = (entry: TableSchemaEntry) =>
		createIncludeInputSchema(entry, getQuerySchema, behavior, registry);

	const getQuerySchema = (entry: TableSchemaEntry) =>
		createQueryArgsSchema(
			entry,
			behavior,
			options,
			getCursorInputSchema,
			getIncludeSchema,
			getSelectSchema,
		);

	for (const entry of registry.values()) {
		entry.selectInputSchema = getSelectSchema(entry);
		entry.schemas.where = createWhereSchema(
			entry,
			behavior,
			registry,
			options,
		);
		entry.queryInputSchema = getQuerySchema(entry);
		entry.schemas.query = entry.queryInputSchema;
		entry.schemas.pagination = createPaginationSchema(
			entry,
			behavior,
			options,
			getCursorInputSchema,
			getIncludeSchema,
			getSelectSchema,
		);
	}

	const getQueryArgsWithMetaSchema = (entry: TableSchemaEntry) =>
		entry.queryInputSchema.extend(createOperationMetaShape());

	const getPaginationArgsWithMetaSchema = (entry: TableSchemaEntry) =>
		entry.schemas.pagination.extend(createOperationMetaShape());

	const getCursorArgsWithMetaSchema = (entry: TableSchemaEntry) =>
		z.object({
			after: z
				.union([getCursorInputSchema(entry), z.string()])
				.optional(),
			before: z
				.union([getCursorInputSchema(entry), z.string()])
				.optional(),
			include: getIncludeSchema(entry).optional(),
			limit: z.number().int().optional(),
			lock: zodLockSchema.optional(),
			orderBy: entry.schemas.orderBy.optional(),
			select: getSelectSchema(entry).optional(),
			skip: z.number().int().optional(),
			take: z.number().int().optional(),
			where: entry.schemas.where.optional(),
			...createOperationMetaShape(),
		});

	const getSingleResultSchema = (tableName: string, args: unknown) =>
		createResultSchema(getEntry(tableName), registry, behavior, args);

	return {
		get(tableName) {
			return registry.get(tableName);
		},
		getBatchResultSchema(tableName, args) {
			const rowSchema = getSingleResultSchema(tableName, args);
			return z.object({
				count: z.number().int(),
				data: z.array(rowSchema).optional(),
			});
		},
		getCountArgsSchema(tableName) {
			const entry = getEntry(tableName);
			return z.object({
				cursor: getCursorInputSchema(entry).optional(),
				where: entry.schemas.where.optional(),
				...createOperationMetaShape(),
			});
		},
		getCreateArgsSchema(tableName) {
			const entry = getEntry(tableName);
			return z.object({
				data: entry.schemas.create,
				include: getIncludeSchema(entry).optional(),
				meta: z.unknown().optional(),
				select: getSelectSchema(entry).optional(),
				skipDuplicates: createSkipDuplicatesSchema(entry).optional(),
				validate: z.boolean().optional(),
			});
		},
		getCreateManyArgsSchema(tableName) {
			const entry = getEntry(tableName);
			return z.object({
				data: z.array(entry.schemas.create),
				include: getIncludeSchema(entry).optional(),
				meta: z.unknown().optional(),
				select: getSelectSchema(entry).optional(),
				skipDuplicates: createSkipDuplicatesSchema(entry).optional(),
				validate: z.boolean().optional(),
			});
		},
		getCursorArgsSchema(tableName) {
			return getCursorArgsWithMetaSchema(getEntry(tableName));
		},
		getDeleteArgsSchema(tableName) {
			const entry = getEntry(tableName);
			return z.object({
				include: getIncludeSchema(entry).optional(),
				meta: z.unknown().optional(),
				select: getSelectSchema(entry).optional(),
				validate: z.boolean().optional(),
				where: entry.schemas.where,
			});
		},
		getDeleteManyArgsSchema(tableName) {
			const entry = getEntry(tableName);
			return z.object({
				meta: z.unknown().optional(),
				validate: z.boolean().optional(),
				where: entry.schemas.where.optional(),
			});
		},
		getExistsArgsSchema(tableName) {
			return this.getCountArgsSchema(tableName);
		},
		getPaginationArgsSchema(tableName) {
			return getPaginationArgsWithMetaSchema(getEntry(tableName));
		},
		getQueryArgsSchema(tableName) {
			return getQueryArgsWithMetaSchema(getEntry(tableName));
		},
		getQueryResultSchema(tableName, args, mode) {
			return createQueryResultSchema(
				getSingleResultSchema(tableName, args),
				mode,
			);
		},
		getSingleResultSchema(tableName, args) {
			return getSingleResultSchema(tableName, args);
		},
		getUpdateArgsSchema(tableName) {
			const entry = getEntry(tableName);
			return z.object({
				data: entry.schemas.update,
				include: getIncludeSchema(entry).optional(),
				meta: z.unknown().optional(),
				select: getSelectSchema(entry).optional(),
				validate: z.boolean().optional(),
				where: entry.schemas.where.optional(),
			});
		},
		getUpdateEachArgsSchema(tableName) {
			const entry = getEntry(tableName);
			return z.object({
				by: z.enum(Object.keys(entry.columns) as [string, ...string[]]),
				data: z.array(entry.schemas.update),
				meta: z.unknown().optional(),
				onEmpty: z.enum(['ignore', 'throw']).optional(),
				select: getSelectSchema(entry).optional(),
				update: entry.schemas.update.optional(),
				validate: z.boolean().optional(),
				where: entry.schemas.where.optional(),
			});
		},
		getUpdateManyArgsSchema(tableName) {
			return this.getUpdateArgsSchema(tableName);
		},
		getUpsertArgsSchema(tableName) {
			const entry = getEntry(tableName);
			return z.object({
				create: entry.schemas.create,
				include: getIncludeSchema(entry).optional(),
				meta: z.unknown().optional(),
				select: getSelectSchema(entry).optional(),
				update: entry.schemas.update,
				validate: z.boolean().optional(),
				where: entry.schemas.where,
			});
		},
		getUpsertManyArgsSchema(tableName) {
			const entry = getEntry(tableName);
			return z.object({
				batchSize: z.number().int().positive().optional(),
				data: z.array(entry.schemas.create),
				meta: z.unknown().optional(),
				select: getSelectSchema(entry).optional(),
				target: z
					.array(
						z.enum(
							Object.keys(entry.columns) as [string, ...string[]],
						),
					)
					.min(1),
				update: entry.schemas.update,
				validate: z.boolean().optional(),
				where: z.unknown().optional(),
			});
		},
	};
};

const zodLockSchema = z.union([
	z.enum(['share', 'update']),
	z.object({
		mode: z.enum(['keyShare', 'noKeyUpdate', 'share', 'update']),
		noWait: z.boolean().optional(),
		skipLocked: z.boolean().optional(),
		tables: z.array(z.string()).optional(),
	}),
]);

const createSkipDuplicatesSchema = (entry: TableSchemaEntry) =>
	z.union([
		z.boolean(),
		z.array(z.enum(Object.keys(entry.columns) as [string, ...string[]])),
	]);
