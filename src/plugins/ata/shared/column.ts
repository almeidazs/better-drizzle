import type { AnyColumn } from 'drizzle-orm';

/**
 * What a drizzle column becomes for ata.
 *
 * ata validates JSON-shaped data, so three of drizzle's column kinds have no
 * spelling in a schema: `date` is a `Date` instance, `bigint` is a `BigInt`, and
 * `buffer` is a `Buffer`. Rather than reach for a custom keyword, which would put
 * the whole schema on ata's interpreted engine and give up most of the reason to
 * use it, those columns ask the schema for nothing and name a `residue` instead:
 * a predicate run only on values ata has already accepted.
 *
 * That is the split `@ata-project/zod` already makes for `z.date()` and friends.
 * ata rejecting is final and fast; ata accepting hands the value on to the one
 * check it cannot express.
 */
export type ResidueKind = 'bigint' | 'buffer' | 'date';

export type ColumnSchema = {
	/** JSON Schema for the part ata can check. `{}` accepts anything. */
	schema: Record<string, unknown>;
	/** Present when the column's type is a JS value ata cannot describe. */
	residue?: ResidueKind;
	/** The column accepts null. */
	nullable: boolean;
};

const RESIDUE_CHECK: Record<ResidueKind, (value: unknown) => boolean> = {
	bigint: (value) => typeof value === 'bigint',
	buffer: (value) => value instanceof Uint8Array,
	date: (value) => value instanceof Date && !Number.isNaN(value.getTime()),
};

/** The predicate for a residue kind, for a caller that has a value in hand. */
export const checkResidue = (kind: ResidueKind, value: unknown): boolean =>
	RESIDUE_CHECK[kind](value);

const sqlTypeIncludes = (column: AnyColumn, token: string) =>
	column.getSQLType().toLowerCase().includes(token);

const withNull = (
	schema: Record<string, unknown>,
	nullable: boolean,
): Record<string, unknown> => {
	if (!nullable || typeof schema.type !== 'string') return schema;
	return { ...schema, type: [schema.type, 'null'] };
};

const stringSchema = (column: AnyColumn): Record<string, unknown> => {
	if (sqlTypeIncludes(column, 'uuid'))
		return { type: 'string', format: 'uuid' };

	// drizzle records a varchar's limit on the column; a JSON Schema can say it,
	// so it does rather than leaving the bound to the database.
	const length = (column as { length?: unknown }).length;
	return typeof length === 'number' && length > 0
		? { type: 'string', maxLength: length }
		: { type: 'string' };
};

const numberSchema = (column: AnyColumn): Record<string, unknown> => {
	// numeric and decimal arrive as strings from every driver drizzle supports,
	// which is what the zod plugin encodes too.
	if (
		sqlTypeIncludes(column, 'numeric') ||
		sqlTypeIncludes(column, 'decimal')
	)
		return { type: 'string' };
	return sqlTypeIncludes(column, 'int')
		? { type: 'integer' }
		: { type: 'number' };
};

/**
 * A column's schema, its residue, and whether it takes null. The order of the
 * tests mirrors `src/plugins/zod/shared/schema-builder.ts` so the two plugins
 * classify a column the same way and a difference between them is a difference
 * in what ata can express, never in what the column was read as.
 */
export const columnToSchema = (column: AnyColumn): ColumnSchema => {
	const nullable = !column.notNull;

	const enumValues =
		'enumValues' in column && Array.isArray(column.enumValues)
			? column.enumValues
			: undefined;

	if (enumValues?.length) {
		const values: unknown[] = [...enumValues];
		if (nullable) values.push(null);
		return { nullable, schema: { enum: values } };
	}

	if (column.dataType === 'boolean')
		return { nullable, schema: withNull({ type: 'boolean' }, nullable) };
	if (column.dataType === 'date')
		return { nullable, residue: 'date', schema: {} };
	if (column.dataType === 'bigint')
		return { nullable, residue: 'bigint', schema: {} };
	if (column.dataType === 'number')
		return { nullable, schema: withNull(numberSchema(column), nullable) };
	if (column.dataType === 'json') return { nullable, schema: {} };
	if (column.dataType === 'buffer')
		return { nullable, residue: 'buffer', schema: {} };
	if (
		column.dataType === 'string' ||
		sqlTypeIncludes(column, 'text') ||
		sqlTypeIncludes(column, 'char')
	)
		return { nullable, schema: withNull(stringSchema(column), nullable) };

	// SQL-type fallbacks, for drivers whose dataType is less specific than the
	// declared column. Same order as the zod plugin's.
	if (sqlTypeIncludes(column, 'bigint'))
		return { nullable, residue: 'bigint', schema: {} };
	if (sqlTypeIncludes(column, 'timestamp') || sqlTypeIncludes(column, 'date'))
		return { nullable, residue: 'date', schema: {} };
	if (sqlTypeIncludes(column, 'bool'))
		return { nullable, schema: withNull({ type: 'boolean' }, nullable) };
	if (sqlTypeIncludes(column, 'int'))
		return { nullable, schema: withNull(numberSchema(column), nullable) };
	if (sqlTypeIncludes(column, 'json')) return { nullable, schema: {} };
	if (sqlTypeIncludes(column, 'uuid'))
		return { nullable, schema: withNull(stringSchema(column), nullable) };
	if (sqlTypeIncludes(column, 'blob') || sqlTypeIncludes(column, 'bytea'))
		return { nullable, residue: 'buffer', schema: {} };

	// Unknown to this classifier: accept, and let nothing be claimed about it.
	// Declining to constrain is recoverable; constraining wrongly is not.
	return { nullable, schema: {} };
};
