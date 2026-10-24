import type { CleanedWhere } from 'better-auth/adapters';
import type { PluginDialect, TableRuntime } from 'better-drizzle';
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

import { invalid } from './errors';
import { getColumn, type Row } from './state';

/** An empty Better Auth `where` matches every row; core treats it as a no-op. */
export const EVERY_ROW = sql`1 = 1`;

/** A JSON object compared as a value, never read as a filter (`{ in: 1 }`). */
const literal = (value: unknown) =>
	typeof value === 'object' &&
	value !== null &&
	!Array.isArray(value) &&
	!(value instanceof Date) &&
	!(value instanceof Uint8Array)
		? { equals: value }
		: value;

const isInsensitive = ({ mode, value }: CleanedWhere) =>
	mode === 'insensitive' &&
	(typeof value === 'string' ||
		(Array.isArray(value) &&
			value.every((item) => typeof item === 'string')));

/** Core `endsWith` keeps SQL wildcards; Better Auth matches literally. */
const endsWith = (
	column: AnyColumn,
	value: unknown,
	insensitive: boolean,
	dialect: PluginDialect,
) => {
	const pattern = `%${String(value).replace(/[!%_]/g, '!$&')}`;
	if (!insensitive) return sql`${column} like ${pattern} escape '!'`;

	return dialect === 'pg'
		? sql`${column} ilike ${pattern} escape '!'`
		: sql`lower(${column}) like lower(${pattern}) escape '!'`;
};

const toFilter = (
	runtime: TableRuntime,
	model: string,
	where: CleanedWhere,
	dialect: PluginDialect,
): Row | SQL => {
	const { field, operator, value } = where;
	// Core skips `undefined` filter values, which would drop the condition.
	if (value === undefined)
		throw invalid(
			`The value for "${field}" must not be undefined when using the "${operator}" operator.`,
			model,
		);
	const column = getColumn(runtime, model, field);
	const insensitive = isInsensitive(where);
	const filter = (filter: Row) => ({
		[field]: insensitive ? { ...filter, mode: 'insensitive' } : filter,
	});

	switch (operator) {
		case 'eq':
			if (insensitive) return filter({ equals: value });
			return { [field]: literal(value) };
		case 'ne':
			return filter({ not: insensitive ? value : literal(value) });
		case 'in':
		case 'not_in':
			if (!Array.isArray(value))
				throw invalid(
					`The value for "${field}" must be an array when using the "${operator}" operator.`,
					model,
				);
			return filter(operator === 'in' ? { in: value } : { notIn: value });
		case 'lt':
		case 'lte':
		case 'gt':
		case 'gte':
			return { [field]: { [operator]: value } };
		case 'contains':
			return filter({ contains: String(value) });
		case 'starts_with':
			return filter({ startsWith: String(value) });
		case 'ends_with':
			return endsWith(column, value, insensitive, dialect);
		default:
			throw invalid(`Unsupported where operator "${operator}".`, model);
	}
};

/**
 * Better Auth's where list as a Better Drizzle filter: `AND(and group,
 * OR(or group))`. Fields of the AND group share one object when they do not
 * repeat, so simple lookups keep the core fast path.
 */
export const toWhere = (
	runtime: TableRuntime,
	model: string,
	where: CleanedWhere[] | undefined,
	dialect: PluginDialect,
) => {
	if (!where?.length) return undefined;

	const result = Object.create(null) as Row;
	const and: unknown[] = [];
	const or: unknown[] = [];
	for (const entry of where) {
		const filter = toFilter(runtime, model, entry, dialect);
		if (entry.connector === 'OR') {
			or.push(filter);
			continue;
		}

		const [field] = 'getSQL' in filter ? [] : Object.keys(filter);
		if (field === undefined || field in result) and.push(filter);
		else result[field] = (filter as Row)[field];
	}

	if (and.length) result.AND = and;
	if (or.length) result.OR = or;

	return result;
};
