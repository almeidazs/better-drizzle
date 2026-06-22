import { isTable, type Table } from 'drizzle-orm';

import type {
	AnySchema,
	BetterRelationalConfig,
	BetterTableKey,
	RuntimeContext,
} from '../../types';

export const getTableRuntime = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: string,
): {
	table: Table;
	tableConfig: BetterRelationalConfig;
} => {
	const table = context.fullSchema[tableName];
	if (!isTable(table))
		throw new Error(`Schema key "${tableName}" is not a Drizzle table.`);

	const tableConfig = context.relational.tables[tableName];

	if (!tableConfig)
		throw new Error(`No relational config found for table "${tableName}".`);

	return { table, tableConfig };
};

export const getMeta = <Meta>(args: unknown): Meta | undefined =>
	typeof args === 'object' && args !== null && 'meta' in args
		? (args as { meta?: Meta }).meta
		: undefined;

export const getPrimaryKeyWhere = (
	tableConfig: BetterRelationalConfig,
	record: Record<string, unknown>,
) => {
	const where: Record<string, unknown> = {};

	for (const column of tableConfig.primaryKey)
		if (record[column.name] !== undefined)
			where[column.name] = record[column.name];

	return where;
};

export const isTableKey = <Schema extends AnySchema>(
	schema: Schema,
	key: string,
): key is BetterTableKey<Schema> => isTable(schema[key]);
