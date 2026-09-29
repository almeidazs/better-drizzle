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
	/**
	 * The residue belongs to each element, not to the value. Set for an array
	 * whose element is undescribable: an array of `Date` is a valid array, and it
	 * is each entry that has to be a `Date`.
	 */
	residueDimensions?: number;
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

export const invalidResiduePath = (
	kind: ResidueKind,
	value: unknown,
	dimensions: number,
): string | null => {
	if (dimensions === 0) return checkResidue(kind, value) ? null : '';
	if (!Array.isArray(value)) return '';
	for (let index = 0; index < value.length; index++) {
		const path = invalidResiduePath(kind, value[index], dimensions - 1);
		if (path !== null) return `/${index}${path}`;
	}
	return null;
};

const sqlTypeIncludes = (column: AnyColumn, token: string) =>
	column.getSQLType().toLowerCase().includes(token);

const withNull = (
	schema: Record<string, unknown>,
	nullable: boolean,
): Record<string, unknown> => {
	if (!nullable || typeof schema.type !== 'string') return schema;
	return { ...schema, type: [schema.type, 'null'] };
};

const withoutNull = (
	schema: Record<string, unknown>,
): Record<string, unknown> => {
	if (!Array.isArray(schema.type)) return schema;
	const types = schema.type.filter((t) => t !== 'null');
	if (types.length === schema.type.length) return schema;
	return { ...schema, type: types.length === 1 ? types[0] : types };
};

/**
 * Drizzle 1.x declares an array column as its element column with
 * `dimensions`, so the schema for `text[]` is the schema for `text` wrapped in
 * an array, read through a view of the column with one dimension fewer. A
 * residue on the element carries up: an array of `Date` is as undescribable as
 * one `Date`, and the predicate that judges it has to see the array.
 */
const arraySchema = (
	column: AnyColumn,
	dimensions: number,
	nullable: boolean,
): ColumnSchema => {
	const element = columnToSchema(
		Object.create(column, {
			dimensions: { value: dimensions - 1 },
			notNull: { value: true },
		}) as AnyColumn,
	);
	// The array's nullability does not apply to its elements:
	// `text('tags').array().notNull()` is `string[]`, and assigning
	// `['x', null]` to it is a type error.
	const schema = withNull(
		{ items: withoutNull(element.schema), type: 'array' },
		nullable,
	);
	return element.residue
		? {
				nullable,
				residue: element.residue,
				residueDimensions: dimensions,
				schema,
			}
		: { nullable, schema };
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

	// Before the scalar kinds, since an array of anything is an array first.
	const dimensions = (column as { dimensions?: number }).dimensions ?? 0;
	if (dimensions > 0) return arraySchema(column, dimensions, nullable);

	const enumValues =
		'enumValues' in column && Array.isArray(column.enumValues)
			? column.enumValues
			: undefined;

	if (enumValues?.length) {
		const values: unknown[] = [...enumValues];
		if (nullable) values.push(null);
		return { nullable, schema: { enum: values } };
	}

	// Drizzle 1.x spells dataType as `<type> <constraint>` (`number int32`,
	// `object date`, `string uuid`).
	const [type, constraint] = column.dataType.split(' ');

	if (type === 'boolean')
		return { nullable, schema: withNull({ type: 'boolean' }, nullable) };
	if (type === 'object' && constraint === 'date')
		return {
			nullable,
			residue: 'date',
			schema: nullable ? {} : { not: { type: 'null' } },
		};
	if (type === 'bigint')
		return {
			nullable,
			residue: 'bigint',
			schema: nullable ? {} : { not: { type: 'null' } },
		};
	if (type === 'number')
		return { nullable, schema: withNull(numberSchema(column), nullable) };
	if (type === 'object' && constraint === 'json')
		return { nullable, schema: {} };
	if (type === 'object' && constraint === 'buffer')
		return {
			nullable,
			residue: 'buffer',
			schema: nullable ? {} : { not: { type: 'null' } },
		};
	if (
		type === 'string' ||
		sqlTypeIncludes(column, 'text') ||
		sqlTypeIncludes(column, 'char')
	)
		return { nullable, schema: withNull(stringSchema(column), nullable) };

	// SQL-type fallbacks, for drivers whose dataType is less specific than the
	// declared column. Same order as the zod plugin's.
	if (sqlTypeIncludes(column, 'bigint'))
		return {
			nullable,
			residue: 'bigint',
			schema: nullable ? {} : { not: { type: 'null' } },
		};
	if (sqlTypeIncludes(column, 'timestamp') || sqlTypeIncludes(column, 'date'))
		return {
			nullable,
			residue: 'date',
			schema: nullable ? {} : { not: { type: 'null' } },
		};
	if (sqlTypeIncludes(column, 'bool'))
		return { nullable, schema: withNull({ type: 'boolean' }, nullable) };
	if (sqlTypeIncludes(column, 'int'))
		return { nullable, schema: withNull(numberSchema(column), nullable) };
	if (sqlTypeIncludes(column, 'json')) return { nullable, schema: {} };
	if (sqlTypeIncludes(column, 'uuid'))
		return { nullable, schema: withNull(stringSchema(column), nullable) };
	if (sqlTypeIncludes(column, 'blob') || sqlTypeIncludes(column, 'bytea'))
		return {
			nullable,
			residue: 'buffer',
			schema: nullable ? {} : { not: { type: 'null' } },
		};

	// Unknown to this classifier: accept, and let nothing be claimed about it.
	// Declining to constrain is recoverable; constraining wrongly is not.
	return { nullable, schema: {} };
};
