import {
	createTableRelationsHelpers,
	extractTablesRelationalConfig,
	getTableColumns,
	isTable,
	normalizeRelation,
} from 'drizzle-orm';

import type {
	AnyPlugin,
	AnySchema,
	BetterClientOptions,
	BetterMeta,
	BetterTableKey,
	PluginHookKind,
	PluginRuntimeBucket,
	RuntimeContext,
	TableRuntime,
} from '../../types';

const getDialect = (db: { dialect?: { constructor?: { name?: string } } }) => {
	const name = db.dialect?.constructor?.name?.toLowerCase() ?? '';

	if (name.includes('sqlite')) return 'sqlite';
	if (name.includes('mysql')) return 'mysql';
	if (name.includes('pg') || name.includes('postgres')) return 'pg';

	throw new Error(
		`Unable to infer Better Drizzle dialect from "${db.dialect?.constructor?.name ?? 'unknown'}".`,
	);
};

const createPluginBuckets = () => {
	const createBucket = (): PluginRuntimeBucket => ({
		afterHooks: [],
		beforeHooks: [],
		hasAfterHooks: false,
		hasBeforeHooks: false,
		hasTransforms: false,
		transforms: [],
	});

	return {
		count: createBucket(),
		create: createBucket(),
		createMany: createBucket(),
		delete: createBucket(),
		deleteMany: createBucket(),
		exists: createBucket(),
		findFirst: createBucket(),
		findMany: createBucket(),
		findOne: createBucket(),
		findUnique: createBucket(),
		paginate: createBucket(),
		update: createBucket(),
		updateMany: createBucket(),
		upsert: createBucket(),
	} satisfies Record<PluginHookKind, PluginRuntimeBucket>;
};

export const createRuntimeContext = <
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
>(
	db: unknown,
	options: BetterClientOptions<Schema, Meta, Plugins>,
): RuntimeContext<Schema, Meta, Plugins> => {
	const relational = extractTablesRelationalConfig(
		options.schema,
		createTableRelationsHelpers,
	);
	const tables = Object.create(null) as Record<string, TableRuntime>;
	const models = Object.create(null) as RuntimeContext<
		Schema,
		Meta,
		Plugins
	>['models'];

	for (const [tableName, table] of Object.entries(options.schema)) {
		if (!isTable(table)) continue;

		const tableConfig = relational.tables[tableName];

		if (!tableConfig) continue;
		const columns = getTableColumns(table);

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
			columns,
			dbName: tableConfig.dbName,
			hasColumn(column: string) {
				return column in this.columns;
			},
			model: {
				columns,
				dbName: tableConfig.dbName,
				hasColumn(column: string) {
					return column in columns;
				},
				name: tableName as never,
			} as TableRuntime['model'],
			primaryKeyFields: tableConfig.primaryKey.map(
				(column) => column.name,
			),
			relations,
			relationNames: new Set(Object.keys(tableConfig.relations)),
			table,
			tableConfig,
		};
		const tableRuntime = tables[tableName];
		if (!tableRuntime) continue;
		models[tableName] = tableRuntime.model;
	}

	const hooks = options.hooks;
	const plugins = options.plugins ?? [];

	return {
		db: db as RuntimeContext<Schema, Meta, Plugins>['db'],
		dialect: getDialect(db as RuntimeContext<Schema, Meta, Plugins>['db']),
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
		hasPlugins: plugins.length > 0,
		models,
		options,
		plugins: {
			byKind: createPluginBuckets(),
			meta: [],
		},
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
