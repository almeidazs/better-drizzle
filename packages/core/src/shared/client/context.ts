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
	PluginRuntimeRawBucket,
	PluginRuntimeTransactionBucket,
	RuntimeContext,
	TableRuntime,
	TransactionRuntime,
} from '../../types';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';

const getDialect = (db: { dialect?: { constructor?: { name?: string } } }) => {
	const name = db.dialect?.constructor?.name?.toLowerCase() ?? '';

	if (name.includes('sqlite')) return 'sqlite';
	if (name.includes('mysql')) return 'mysql';
	if (name.includes('pg') || name.includes('postgres')) return 'pg';

	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.DialectInferenceFailed,
		details: {
			dialectConstructorName: db.dialect?.constructor?.name ?? 'unknown',
		},
		message: `Unable to infer Better Drizzle dialect from "${db.dialect?.constructor?.name ?? 'unknown'}".`,
	});
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

const createTransactionPluginBucket = (): PluginRuntimeTransactionBucket => ({
	afterCommitHooks: [],
	afterRollbackHooks: [],
	beforeHooks: [],
	errorHooks: [],
});

const createRawPluginBucket = (): PluginRuntimeRawBucket => ({
	afterHooks: [],
	beforeHooks: [],
	errorHooks: [],
});

/**
 * Builds the internal runtime context used by every delegate and operation.
 * Extracts relational config, precomputes table metadata, and registers
 * plugin hooks and transforms once during client initialization.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type carried through hooks.
 * @typeParam Plugins - The plugin tuple.
 * @param db     - The raw Drizzle database instance.
 * @param options - Client options including schema, plugins, and hooks.
 * @returns A fully-initialised runtime context.
 */
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
		client: null,
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
			raw: createRawPluginBucket(),
			transaction: createTransactionPluginBucket(),
		},
		fullSchema: options.schema,
		relational,
		repositories: Object.create(null) as Record<string, unknown>,
		tables,
		transaction: null,
	};
};

export const createDerivedRuntimeContext = <
	Schema extends AnySchema,
	Meta = BetterMeta,
	Plugins extends readonly AnyPlugin[] = readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	db: unknown,
	transaction: TransactionRuntime | null,
): RuntimeContext<Schema, Meta, Plugins> => ({
	client: null,
	db: db as RuntimeContext<Schema, Meta, Plugins>['db'],
	dialect: context.dialect,
	hasHooks: context.hasHooks,
	hasOnError: context.hasOnError,
	hasPlugins: context.hasPlugins,
	models: context.models,
	options: context.options,
	plugins: context.plugins,
	fullSchema: context.fullSchema,
	relational: context.relational,
	repositories: Object.create(null) as Record<string, unknown>,
	tables: context.tables,
	transaction,
});

/**
 * Retrieves the precomputed runtime metadata for a table by name.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The TypeScript table key.
 * @returns The table runtime metadata.
 * @throws If no runtime is found for the given table name.
 */
export const getTableRuntime = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: string,
) => {
	const runtime = context.tables[tableName];

	if (!runtime)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.TableRuntimeNotFound,
			message: `No runtime found for table "${tableName}".`,
			table: tableName,
		});

	return runtime;
};

/**
 * Extracts the custom metadata value from an operation's arguments object.
 *
 * @typeParam Meta - The expected metadata type.
 * @param args - The operation arguments (may contain a `meta` property).
 * @returns The metadata value, or `undefined` when not present.
 */
export const getMeta = <Meta>(args: unknown): Meta | undefined =>
	typeof args === 'object' && args !== null && 'meta' in args
		? (args as { meta?: Meta }).meta
		: undefined;

/**
 * Builds a where-clause object from a record's primary key values.
 *
 * @param runtime - The table runtime metadata.
 * @param record  - The record to extract primary key values from.
 * @returns A where-clause object containing only primary key fields with defined values.
 */
export const getPrimaryKeyWhere = (
	runtime: TableRuntime,
	record: Record<string, unknown>,
) => {
	const where: Record<string, unknown> = {};

	for (const field of runtime.primaryKeyFields)
		if (record[field] !== undefined) where[field] = record[field];

	return where;
};

/**
 * Checks whether a value is a plain object (not an array or null).
 *
 * @param value - The value to check.
 * @returns `true` when the value is a non-null, non-array object.
 */
export const isSimpleRecord = (
	value: unknown,
): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Checks whether a string key corresponds to a table in the runtime context.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @param context - The runtime context.
 * @param key     - The key to check.
 * @returns `true` when the key is a valid table key in the schema.
 */
export const isTableKey = <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	key: string,
): key is BetterTableKey<Schema> => key in context.tables;
