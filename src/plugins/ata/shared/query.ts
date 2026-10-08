import {
	type AnyColumn,
	getColumns,
	type TablesRelationalConfig,
} from 'drizzle-orm';

import { columnToSchema } from './column';
import { whereDefinitions } from './where';

type JsonSchema = Record<string, unknown>;
type OrderByDefinitions = { defs: Record<string, JsonSchema>; ref: string };

/**
 * The operation arguments, as JSON Schema.
 *
 * A read takes one object: `where`, `select`, `include`, `orderBy`, `take`,
 * `skip`, `cursor`, `lock`, plus `meta` and `validate`. Each of those is a shape
 * ata can describe, so the whole argument object compiles to one validator and a
 * misspelled argument is refused rather than silently ignored.
 *
 * Three spellings differ and the difference is kept: a plain query takes `skip`
 * and `take`, offset pagination adds `limit`, and cursor pagination takes
 * `after` and `before` as well.
 *
 * The clause's definitions are hoisted into whichever document is being built,
 * rather than nested as a document of their own. A nested `$ref: '#'` would name
 * the argument object instead of the clause, and giving the clause its own `$id`
 * would put the whole schema on the interpreted engine, which is most of the
 * reason not to do it that way.
 */

const SORT_ORDER = ['asc', 'desc'] as const;
const ORDER_BY_VALUE: JsonSchema = {
	anyOf: [
		{ enum: [...SORT_ORDER] },
		{
			additionalProperties: false,
			properties: {
				direction: { enum: [...SORT_ORDER] },
				nulls: { enum: ['first', 'last'] },
			},
			required: ['direction'],
			type: 'object',
		},
	],
};
const LOCK_MODES = ['keyShare', 'noKeyUpdate', 'share', 'update'] as const;

/** `meta` is the caller's own request-scoped context, so nothing is claimed about it. */
const META_PROPERTIES: Record<string, JsonSchema> = {
	meta: {},
	validate: { type: 'boolean' },
};

/**
 * A sort specification: a map of column to direction, or an array of them for
 * multi-column ordering.
 */
export const createOrderBySchema = (
	columns: Record<string, AnyColumn>,
	definitions?: OrderByDefinitions,
): JsonSchema => {
	const { defs, ref } = definitions ?? orderByDefinitions(columns);
	return { $defs: defs, $ref: ref };
};

/** The same, as definitions a caller can hoist. */
export const orderByDefinitions = (
	columns: Record<string, AnyColumn>,
	prefix = '',
): { defs: Record<string, JsonSchema>; ref: string } => {
	const field = `${prefix}orderByField`;
	const name = `${prefix}orderBy`;
	const properties: Record<string, JsonSchema> = {};
	for (const key of Object.keys(columns)) properties[key] = ORDER_BY_VALUE;

	return {
		defs: {
			[field]: {
				additionalProperties: false,
				properties,
				type: 'object',
			},
			[name]: {
				anyOf: [
					{ $ref: `#/$defs/${field}` },
					{ items: { $ref: `#/$defs/${field}` }, type: 'array' },
				],
			},
		},
		ref: `#/$defs/${name}`,
	};
};

/** Share hoisted field maps across models, including recursive one relations. */
export const createRelationOrderByDefinitions = (
	schema: TablesRelationalConfig,
): ((tableName: string) => OrderByDefinitions) => {
	const defs: Record<string, JsonSchema> = {};
	const fields = new Map<string, string>();
	const visit = (name: string): string => {
		const known = fields.get(name);
		if (known) return known;
		const field = `relationOrderBy${fields.size}`;
		fields.set(name, field);
		const table = schema[name];
		const properties: Record<string, JsonSchema> = {};
		for (const key of Object.keys(table ? getColumns(table.table) : {}))
			properties[key] = ORDER_BY_VALUE;
		defs[field] = {
			additionalProperties: false,
			properties,
			type: 'object',
		};
		for (const key in table?.relations) {
			const relation = table.relations[key];
			if (!relation) continue;
			properties[key] =
				relation.relationType === 'many'
					? {
							additionalProperties: false,
							properties: { _count: { enum: [...SORT_ORDER] } },
							required: ['_count'],
							type: 'object',
						}
					: { $ref: `#/$defs/${visit(relation.targetTableName)}` };
		}
		return field;
	};
	return (tableName) => {
		const field = visit(tableName);
		const order = `${field}Order`;
		defs[order] ??= {
			anyOf: [
				{ $ref: `#/$defs/${field}` },
				{ items: { $ref: `#/$defs/${field}` }, type: 'array' },
			],
		};
		return { defs, ref: `#/$defs/${order}` };
	};
};

/**
 * A cursor: the column values that identify one row. Any subset is allowed,
 * since a cursor names as many columns as the ordering needs.
 */
export const createCursorSchema = (
	columns: Record<string, AnyColumn>,
): JsonSchema => {
	const properties: Record<string, JsonSchema> = {};
	for (const [name, column] of Object.entries(columns))
		properties[name] = columnToSchema(column).schema;

	return { additionalProperties: false, properties, type: 'object' };
};

/**
 * A relation inside a projection: `true`, or the relation's own arguments. The
 * related table's columns are not in hand here, so what is checked is that the
 * value is a projection at all, not what is inside it.
 */
const RELATION_ARG: JsonSchema = {
	anyOf: [{ type: 'boolean' }, { type: 'object' }],
};

const countSelect = (relations: readonly string[]): JsonSchema => {
	const properties: Record<string, JsonSchema> = {};
	for (const name of relations) properties[name] = { type: 'boolean' };
	return { additionalProperties: false, properties, type: 'object' };
};

/**
 * A `select` projection: scalar columns take a boolean, relations take `true`
 * or their own arguments.
 */
export const createSelectSchema = (
	columns: Record<string, AnyColumn>,
	relations: readonly string[] = [],
): JsonSchema => {
	const properties: Record<string, JsonSchema> = {};
	for (const key of Object.keys(columns))
		properties[key] = { type: 'boolean' };
	for (const name of relations) properties[name] = RELATION_ARG;

	return { additionalProperties: false, properties, type: 'object' };
};

/**
 * An `include` projection: relations only, plus `_count`. Scalar columns are
 * always returned when `include` is used, so naming one here is a mistake.
 */
export const createIncludeSchema = (
	relations: readonly string[] = [],
): JsonSchema => {
	const properties: Record<string, JsonSchema> = {
		_count: {
			additionalProperties: false,
			properties: { select: countSelect(relations) },
			required: ['select'],
			type: 'object',
		},
	};
	for (const name of relations) properties[name] = RELATION_ARG;

	return { additionalProperties: false, properties, type: 'object' };
};

/** The row lock clause, for the dialects that support one. */
export const createLockSchema = (): JsonSchema => ({
	anyOf: [
		{ enum: ['share', 'update'] },
		{
			additionalProperties: false,
			properties: {
				mode: { enum: [...LOCK_MODES] },
				noWait: { type: 'boolean' },
				skipLocked: { type: 'boolean' },
				tables: { items: { type: 'string' }, type: 'array' },
			},
			required: ['mode'],
			type: 'object',
		},
	],
});

type ArgsShape = 'cursor' | 'pagination' | 'query';

/**
 * The argument object for a read.
 *
 * `take` may be negative, which the core reads as "reverse the ordering", so
 * only `skip` and `limit` carry a lower bound.
 */
export const createQueryArgsSchema = (
	columns: Record<string, AnyColumn>,
	relations: readonly string[] = [],
	shape: ArgsShape = 'query',
	definitions?: OrderByDefinitions,
): JsonSchema => {
	const where = whereDefinitions(columns, '', relations);
	const orderBy = definitions ?? orderByDefinitions(columns);
	const cursor = createCursorSchema(columns);

	const properties: Record<string, JsonSchema> = {
		...META_PROPERTIES,
		cursor,
		include: createIncludeSchema(relations),
		lock: createLockSchema(),
		orderBy: { $ref: orderBy.ref },
		select: createSelectSchema(columns, relations),
		skip: { minimum: 0, type: 'integer' },
		take: { type: 'integer' },
		where: { $ref: where.ref },
	};

	if (shape !== 'query') properties.limit = { minimum: 0, type: 'integer' };
	if (shape === 'pagination') {
		properties.page = { minimum: 1, type: 'integer' };
		properties.perPage = { minimum: 0, type: 'integer' };
	}
	if (shape === 'cursor') {
		// Only cursor pagination takes a position: the row values the previous
		// page handed back, or `null` for a missing `nextCursor` /
		// `previousCursor`.
		const position: JsonSchema = { anyOf: [cursor, { type: 'null' }] };
		properties.after = position;
		properties.before = position;
	}

	return {
		$defs: { ...where.defs, ...orderBy.defs },
		additionalProperties: false,
		properties,
		type: 'object',
	};
};

/** Offset pagination: the query arguments plus `limit`. */
export const createPaginationArgsSchema = (
	columns: Record<string, AnyColumn>,
	relations: readonly string[] = [],
	definitions?: OrderByDefinitions,
): JsonSchema =>
	createQueryArgsSchema(columns, relations, 'pagination', definitions);

/** Cursor pagination: the query arguments plus `limit`, `after` and `before`. */
export const createCursorArgsSchema = (
	columns: Record<string, AnyColumn>,
	relations: readonly string[] = [],
): JsonSchema => createQueryArgsSchema(columns, relations, 'cursor');

/**
 * `count` and `exists` take a filter and nothing else to project.
 */
export const createCountArgsSchema = (
	columns: Record<string, AnyColumn>,
	relations: readonly string[] = [],
): JsonSchema => {
	const where = whereDefinitions(columns, '', relations);
	return {
		$defs: where.defs,
		additionalProperties: false,
		properties: {
			...META_PROPERTIES,
			cursor: createCursorSchema(columns),
			where: { $ref: where.ref },
		},
		type: 'object',
	};
};

/**
 * `delete` requires a filter, `deleteMany` does not. Deleting every row should
 * be something you asked for, not something you got by leaving an argument out,
 * and the core draws that line, so this follows it.
 */
export const createDeleteArgsSchema = (
	columns: Record<string, AnyColumn>,
	relations: readonly string[] = [],
	required = true,
): JsonSchema => {
	const where = whereDefinitions(columns, '', relations);
	const schema: JsonSchema = {
		$defs: where.defs,
		additionalProperties: false,
		properties: {
			...META_PROPERTIES,
			include: createIncludeSchema(relations),
			select: createSelectSchema(columns, relations),
			where: { $ref: where.ref },
		},
		type: 'object',
	};
	if (required) schema.required = ['where'];
	return schema;
};
