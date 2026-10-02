import {
	type AnyColumn,
	entityKind,
	getColumns,
	getTableName,
	is,
	isTable,
	Relation,
	type Table,
	type TablesRelationalConfig,
} from 'drizzle-orm';

import type {
	AnyPlugin,
	AnySchema,
	BetterClientOptions,
	BetterMeta,
	BetterTableKey,
	PluginHookKind,
	PluginModelRelation,
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
		hasIntercepts: false,
		hasTransforms: false,
		intercepts: [],
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
		cursor: createBucket(),
		paginate: createBucket(),
		update: createBucket(),
		updateEach: createBucket(),
		updateMany: createBucket(),
		upsert: createBucket(),
		upsertMany: createBucket(),
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

const ExtraConfigBuilder = Symbol.for('drizzle:ExtraConfigBuilder');
const ExtraConfigColumns = Symbol.for('drizzle:ExtraConfigColumns');

const sameColumns = (left: readonly AnyColumn[], right: readonly AnyColumn[]) =>
	left.length === right.length &&
	left.every((column) => right.includes(column));

const keyOf = (columns: Record<string, AnyColumn>, name: unknown) => {
	for (const key in columns) if (columns[key]?.name === name) return key;
};

// Primary key columns plus every unique key (constraint or full, plain-column
// unique index) as column keys. Expression and partial indexes are skipped.
const getKeys = (table: Table, columns: Record<string, AnyColumn>) => {
	const primaryKey: AnyColumn[] = [];
	const uniqueKeys: string[][] = [];
	for (const key in columns) {
		const column = columns[key];
		if (column?.primary) primaryKey.push(column);
	}

	const tableSymbols = table as unknown as Record<symbol, unknown>;
	const extraConfig = (
		tableSymbols[ExtraConfigBuilder] as
			| ((columns: unknown) => Record<string, unknown> | unknown[])
			| undefined
	)?.(tableSymbols[ExtraConfigColumns]);
	if (!extraConfig) return { primaryKey, uniqueKeys };

	for (const entry of Object.values(extraConfig)) {
		const kind = (entry as { constructor?: Record<symbol, unknown> })
			?.constructor?.[entityKind];
		if (typeof kind !== 'string') continue;
		if (kind.endsWith('PrimaryKeyBuilder')) {
			for (const column of (entry as { columns: { name: string }[] })
				.columns) {
				const candidate =
					columns[keyOf(columns, column.name) as string];
				if (candidate && !primaryKey.includes(candidate))
					primaryKey.push(candidate);
			}
			continue;
		}
		let targets: { name?: unknown }[] | undefined;
		if (kind.endsWith('UniqueConstraintBuilder'))
			targets = (entry as { columns: { name?: unknown }[] }).columns;
		else if (kind.endsWith('IndexBuilder')) {
			const config = (
				entry as {
					config: {
						columns: { name?: unknown }[];
						unique: boolean;
						where?: unknown;
					};
				}
			).config;
			if (config.unique && !config.where) targets = config.columns;
		}
		if (!targets?.length) continue;
		const fields: string[] = [];
		for (const target of targets) {
			const field = keyOf(columns, target.name);
			if (!field) break;
			fields.push(field);
		}
		if (fields.length === targets.length) uniqueKeys.push(fields);
	}

	return { primaryKey, uniqueKeys };
};

const findRuntime = (tables: Record<string, TableRuntime>, name: string) => {
	const runtime = tables[name];
	if (runtime) return runtime;

	for (const key in tables) {
		const candidate = tables[key];
		if (candidate?.dbName === name || candidate?.tableConfig.name === name)
			return candidate;
	}
};

const getUnsupportedRelationReason = (relation: Relation) => {
	if (relation.where)
		return 'filtered relations (relation-level where) are not supported';
	if (relation.through && relation.relationType === 'one')
		return 'one relations through a junction table are not supported';
};

const buildRelations = (
	tables: Record<string, TableRuntime>,
	relational: TablesRelationalConfig,
) => {
	for (const tableName in tables) {
		const runtime = tables[tableName];
		const tableConfig = relational[tableName];
		if (!runtime || !tableConfig) continue;

		for (const relationName in tableConfig.relations) {
			const relation = tableConfig.relations[relationName];
			if (!is(relation, Relation)) continue;
			const target = findRuntime(tables, relation.targetTableName);
			const unsupported = target
				? getUnsupportedRelationReason(relation)
				: 'the target is not a table';
			if (unsupported) {
				runtime.unsupportedRelations[relationName] = unsupported;
				continue;
			}
			if (!target) continue;

			const fields = relation.sourceColumns as AnyColumn[];
			const references = relation.targetColumns as AnyColumn[];
			const through = relation.through;
			const throughTable = relation.throughTable;

			if (through && throughTable) {
				const throughRuntime = Object.values(tables).find(
					(candidate) => candidate.table === throughTable,
				);
				if (!throughRuntime) {
					runtime.unsupportedRelations[relationName] =
						'the junction table is not part of the relations config';
					continue;
				}
				runtime.relations[relationName] = {
					fields,
					kind: 'manyToMany',
					references,
					relation,
					sourceOwnsForeignKey: false,
					tableName: target.tableConfig.name,
					through: {
						sourceFields: through.source.map(
							(column) => column._.column as AnyColumn,
						),
						tableName: throughRuntime.tableConfig.name,
						targetFields: through.target.map(
							(column) => column._.column as AnyColumn,
						),
					},
				};
				runtime.relationNames.add(relationName);
				continue;
			}

			const one = relation.relationType === 'one';
			runtime.relations[relationName] = {
				fields,
				kind: one ? 'one' : 'many',
				references,
				relation,
				sourceOwnsForeignKey:
					one &&
					(!sameColumns(fields, runtime.primaryKey) ||
						sameColumns(references, target.primaryKey)),
				tableName: target.tableConfig.name,
			};
			runtime.relationNames.add(relationName);
		}
	}
};

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
	const relational = (db as { _?: { relations?: TablesRelationalConfig } })._
		?.relations;
	const tables = Object.create(null) as Record<string, TableRuntime>;
	const models = Object.create(null) as RuntimeContext<
		Schema,
		Meta,
		Plugins
	>['models'];

	for (const tableName in relational) {
		const tableConfig = relational[tableName];
		const table = tableConfig?.table;
		if (!tableConfig || !isTable(table)) continue;

		const columns = getColumns(table) as Record<string, AnyColumn>;
		const { primaryKey, uniqueKeys } = getKeys(table, columns);
		const dbName = getTableName(table);
		const primaryKeyFields = primaryKey.map(
			(column) =>
				Object.keys(columns).find((key) => columns[key] === column) ??
				column.name,
		);
		const model = {
			columns,
			dbName,
			hasColumn(column: string) {
				return column in columns;
			},
			name: tableName as never,
			primaryKey: primaryKeyFields,
			relations: Object.create(null),
		} as TableRuntime['model'];

		tables[tableName] = {
			columns,
			dbName,
			hasColumn(column: string) {
				return column in this.columns;
			},
			model,
			primaryKey,
			primaryKeyFields,
			relations: Object.create(null) as TableRuntime['relations'],
			relationNames: new Set(),
			table,
			tableConfig,
			uniqueKeys,
			unsupportedRelations: Object.create(null),
		};
		models[tableName] = model;
	}

	if (!relational || !Object.keys(tables).length)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message:
				'No tables found on the Drizzle instance. Pass your relations to drizzle(), e.g. drizzle({ client, relations: defineRelations(schema) }).',
			operation: 'bootstrap',
		});

	buildRelations(tables, relational);

	for (const tableName in tables) {
		const runtime = tables[tableName] as TableRuntime;
		const relations = runtime.model.relations as Record<
			string,
			PluginModelRelation
		>;
		for (const name in runtime.relations) {
			const relation = runtime.relations[name];
			if (!relation) continue;
			relations[name] = relation.through
				? {
						foreignKey: 'junction',
						kind: relation.kind,
						model: relation.tableName,
						through: relation.through.tableName,
					}
				: {
						foreignKey: relation.sourceOwnsForeignKey
							? 'source'
							: 'target',
						kind: relation.kind,
						model: relation.tableName,
					};
		}
	}

	const hooks = options.hooks;
	const plugins = options.plugins ?? [];

	return {
		client: null,
		clientExtensions: [],
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
		scopedMeta: undefined,
		plugins: {
			byKind: createPluginBuckets(),
			meta: [],
			raw: createRawPluginBucket(),
			transaction: createTransactionPluginBucket(),
		},
		fullSchema: relational as unknown as Schema,
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
	scopedMeta = context.scopedMeta,
): RuntimeContext<Schema, Meta, Plugins> => ({
	client: null,
	clientExtensions: context.clientExtensions,
	db: db as RuntimeContext<Schema, Meta, Plugins>['db'],
	dialect: context.dialect,
	hasHooks: context.hasHooks,
	hasOnError: context.hasOnError,
	hasPlugins: context.hasPlugins,
	models: context.models,
	options: context.options,
	scopedMeta,
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
	let runtime = context.tables[tableName];
	if (!runtime)
		for (const key in context.tables) {
			const candidate = context.tables[key];
			if (
				candidate?.dbName !== tableName &&
				candidate?.tableConfig.name !== tableName
			)
				continue;
			runtime = candidate;
			break;
		}

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
export const getArgsMeta = <Meta>(args: unknown): Meta | undefined =>
	typeof args === 'object' && args !== null && 'meta' in args
		? (args as { meta?: Meta }).meta
		: undefined;

export const mergeMeta = <Meta>(
	scopedMeta: Meta | undefined,
	operationMeta: Meta | undefined,
): Meta | undefined => {
	if (operationMeta === undefined) return scopedMeta;
	if (scopedMeta === undefined) return operationMeta;

	return {
		...(scopedMeta as Record<string, unknown>),
		...(operationMeta as Record<string, unknown>),
	} as Meta;
};

export function getMeta<Meta>(args: unknown): Meta | undefined;
export function getMeta<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	context: RuntimeContext<Schema, Meta, Plugins>,
	args: unknown,
): Meta | undefined;
export function getMeta<
	Schema extends AnySchema,
	Meta,
	Plugins extends readonly AnyPlugin[],
>(
	contextOrArgs: RuntimeContext<Schema, Meta, Plugins> | unknown,
	args?: unknown,
): Meta | undefined {
	if (args === undefined) return getArgsMeta<Meta>(contextOrArgs);

	return mergeMeta(
		(contextOrArgs as RuntimeContext<Schema, Meta, Plugins>).scopedMeta,
		getArgsMeta<Meta>(args),
	);
}

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
