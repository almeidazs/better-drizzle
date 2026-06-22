import {
	createTableRelationsHelpers,
	extractTablesRelationalConfig,
	getTableColumns,
	isTable,
	normalizeRelation,
} from 'drizzle-orm';

import type {
	AnySchema,
	BetterClientOptions,
	BetterMeta,
	BetterTableKey,
	RuntimeContext,
	TableRuntime,
} from '../../types';

export const createRuntimeContext = <
	Schema extends AnySchema,
	Meta = BetterMeta,
>(
	db: unknown,
	options: BetterClientOptions<Schema, Meta>,
): RuntimeContext<Schema, Meta> => {
	const relational = extractTablesRelationalConfig(
		options.schema,
		createTableRelationsHelpers,
	);
	const tables = Object.create(null) as Record<string, TableRuntime>;

	for (const [tableName, table] of Object.entries(options.schema)) {
		if (!isTable(table)) continue;

		const tableConfig = relational.tables[tableName];

		if (!tableConfig) continue;

		const relations = Object.create(null) as TableRuntime['relations'];

		for (const relationName in tableConfig.relations) {
			const relation = tableConfig.relations[relationName];
			const normalized = normalizeRelation(
				relational.tables,
				relational.tableNamesMap,
				relation,
			);

			relations[relationName] = {
				fields: normalized.fields,
				references: normalized.references,
				relation,
				tableName:
					relational.tableNamesMap[
						`public.${relation.referencedTableName}`
					] ?? relation.referencedTableName,
			};
		}

		tables[tableName] = {
			columns: getTableColumns(table),
			dbName: tableConfig.dbName,
			primaryKeyFields: tableConfig.primaryKey.map(
				(column) => column.name,
			),
			relations,
			relationNames: new Set(Object.keys(tableConfig.relations)),
			table,
			tableConfig,
		};
	}

	const hooks = options.hooks;

	return {
		db: db as RuntimeContext<Schema, Meta>['db'],
		hasHooks: Boolean(
			hooks?.beforeCreate ||
				hooks?.afterCreate ||
				hooks?.beforeUpdate ||
				hooks?.afterUpdate ||
				hooks?.beforeDelete ||
				hooks?.afterDelete ||
				hooks?.beforeQuery ||
				hooks?.afterQuery,
		),
		hasOnError: Boolean(hooks?.onError),
		options,
		fullSchema: options.schema,
		relational,
		repositories: Object.create(null) as Record<string, unknown>,
		tables,
	};
};

export const getTableRuntime = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: string,
) => {
	const runtime = context.tables[tableName];

	if (!runtime) throw new Error(`No runtime found for table "${tableName}".`);

	return runtime;
};

export const getMeta = <Meta>(args: unknown): Meta | undefined =>
	typeof args === 'object' && args !== null && 'meta' in args
		? (args as { meta?: Meta }).meta
		: undefined;

export const getPrimaryKeyWhere = (
	runtime: TableRuntime,
	record: Record<string, unknown>,
) => {
	const where: Record<string, unknown> = {};

	for (const field of runtime.primaryKeyFields)
		if (record[field] !== undefined) where[field] = record[field];

	return where;
};

export const isSimpleRecord = (
	value: unknown,
): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const isTableKey = <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	key: string,
): key is BetterTableKey<Schema> => key in context.tables;
