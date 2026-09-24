import type { AnyColumn } from 'drizzle-orm';

import { columnToSchema, type ResidueKind } from './column';

type JsonSchema = Record<string, unknown>;

/**
 * The where clause, as one JSON Schema.
 *
 * It is recursive twice over: a scalar filter's `not` takes another filter, and
 * AND/OR/NOT take the whole clause again. JSON Schema spells that with `$defs`
 * and local `$ref`, which ata resolves and compiles into a single validator, so
 * a clause of any depth still costs one pass.
 *
 * A filter is `anyOf` the column's own value and the operator object, which is
 * how `{ id: 1 }` and `{ id: { gt: 1 } }` are both clauses. `additionalProperties`
 * is false on every operator object and on the clause itself, so a misspelled
 * operator or a column that is not on the table is refused rather than ignored.
 *
 * A column ata cannot describe still gets its operator object checked, as long as
 * a bare value of that column is something ata can tell apart from an operator
 * object. A `Date` has no own keys, so it satisfies the operator object itself; a
 * bigint is not an object at all. Either way a misspelled operator is still
 * refused, and the value itself is left to the plugin's residue pass.
 *
 * A buffer is the one kind that does not work: it is an object whose own keys are
 * indices, so it matches neither the operator object nor "not an object", and the
 * clause has to accept anything for that column. The limitation is real and small,
 * and saying it is better than a schema that quietly refuses a `Buffer`.
 */

const STRING_OPS = ['contains', 'endsWith', 'startsWith'] as const;
const COMPARABLE_OPS = ['gt', 'gte', 'lt', 'lte'] as const;

type FilterKind = 'boolean' | 'comparable' | 'plain' | 'string';

const filterKindFor = (schema: JsonSchema): FilterKind => {
	const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
	if (type === 'string') return schema.format === 'uuid' ? 'plain' : 'string';
	if (type === 'integer' || type === 'number') return 'comparable';
	if (type === 'boolean') return 'boolean';
	// A column with no type of its own, a date or a bigint, still takes the
	// comparisons: an ORDER BY or a range is exactly what those columns are for.
	if (schema.type === undefined && schema.enum === undefined)
		return 'comparable';
	return 'plain';
};

const filterBody = (kind: FilterKind, value: JsonSchema, ref: string) => {
	const properties: Record<string, JsonSchema> = {
		equals: value,
		not: { anyOf: [value, { $ref: ref }] },
	};

	if (kind !== 'boolean') {
		properties.in = { items: value, type: 'array' };
		properties.notIn = { items: value, type: 'array' };
	}
	if (kind === 'comparable')
		for (const op of COMPARABLE_OPS) properties[op] = value;
	if (kind === 'string') {
		for (const op of STRING_OPS) properties[op] = { type: 'string' };
		properties.mode = { enum: ['default', 'insensitive'] };
	}

	return { additionalProperties: false, properties, type: 'object' };
};

/**
 * What a column accepts in a clause: its own value, or an operator object.
 *
 * For a column ata can describe, that is a plain union of the two. For a residue
 * column there is no value schema to union with, so the bare value is spelled as
 * "not an object" and the operator object carries the rest. See the note above
 * for why `buffer` cannot be spelled that way.
 */
const valueOrFilter = (
	schema: JsonSchema,
	residue: ResidueKind | undefined,
	ref: string,
): JsonSchema => {
	if (residue === 'buffer') return {};
	if (residue) return { anyOf: [{ not: { type: 'object' } }, { $ref: ref }] };
	return { anyOf: [schema, { $ref: ref }] };
};

/**
 * The clause's definitions, and the reference that names it.
 *
 * The clause refers to itself through AND, OR and NOT. Spelling that as
 * `$ref: '#'` only works while the clause is the whole document: nested under
 * a query argument, `#` would name the argument object instead. So the clause
 * is a definition like any other and refers to itself by name, which lets a
 * caller hoist these definitions into whatever document it is building.
 *
 * `prefix` keeps two tables' definitions apart in one document.
 */
export const whereDefinitions = (
	columns: Record<string, AnyColumn>,
	prefix = '',
): { defs: Record<string, JsonSchema>; ref: string } => {
	const clause = `${prefix}where`;
	const self = `#/$defs/${clause}`;
	const defs: Record<string, JsonSchema> = {};
	const properties: Record<string, JsonSchema> = {
		AND: { items: { $ref: self }, type: 'array' },
		NOT: {
			anyOf: [{ $ref: self }, { items: { $ref: self }, type: 'array' }],
		},
		OR: { items: { $ref: self }, type: 'array' },
	};

	for (const [name, column] of Object.entries(columns)) {
		const { schema, residue } = columnToSchema(column);
		const kind = filterKindFor(schema);
		const defName = `${prefix}filter_${name}`;
		defs[defName] = filterBody(kind, schema, `#/$defs/${defName}`);
		properties[name] = valueOrFilter(schema, residue, `#/$defs/${defName}`);
	}

	defs[clause] = {
		additionalProperties: false,
		properties,
		type: 'object',
	};

	return { defs, ref: self };
};

/** The where clause for one table's columns, as a document of its own. */
export const createWhereSchema = (
	columns: Record<string, AnyColumn>,
): JsonSchema => {
	const { defs, ref } = whereDefinitions(columns);
	return { $defs: defs, $ref: ref };
};
