import type { AnyColumn, SQL, SQLWrapper, Table } from 'drizzle-orm';
import {
	aliasedTable,
	aliasedTableColumn,
	and,
	asc,
	Column,
	count,
	desc,
	eq,
	exists,
	getColumns,
	gt,
	gte,
	ilike,
	inArray,
	is,
	isNull,
	isNotNull,
	isSQLWrapper,
	like,
	lt,
	lte,
	not,
	notExists,
	notInArray,
	or,
	Placeholder,
	sql,
} from 'drizzle-orm';
import { mapColumnsInSQLToAlias } from 'drizzle-orm/alias';

import type {
	AnySchema,
	BetterTableKey,
	CompilableWhere,
	CursorArgs,
	CursorInput,
	DrizzleLikeDatabase,
	OrderByInput,
	PaginationArgs,
	RuntimeContext,
	TableRuntime,
	WhereArg,
	WhereCompilerContext,
} from '../../types';
import { getTableRuntime } from '../client/context';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' &&
	value !== null &&
	!Array.isArray(value) &&
	!(value instanceof Date) &&
	!(value instanceof Uint8Array);

const isScalarFilter = (value: unknown): value is Record<string, unknown> => {
	if (!isPlainObject(value)) return false;

	return (
		'equals' in value ||
		'in' in value ||
		'notIn' in value ||
		'lt' in value ||
		'lte' in value ||
		'gt' in value ||
		'gte' in value ||
		'contains' in value ||
		'startsWith' in value ||
		'endsWith' in value ||
		'mode' in value ||
		'not' in value
	);
};

export const orderDirection = (value: unknown): 'asc' | 'desc' =>
	value === 'desc' || (isPlainObject(value) && value.direction === 'desc')
		? 'desc'
		: 'asc';

export const orderNulls = (value: unknown): 'first' | 'last' | undefined =>
	isPlainObject(value) && (value.nulls === 'first' || value.nulls === 'last')
		? value.nulls
		: undefined;

const compileSimpleWhere = (
	runtime: TableRuntime,
	where: Record<string, unknown>,
	rootAlias?: string,
): SQL | undefined => {
	const conditions: SQL[] = [];

	for (const key in where) {
		const value = where[key];
		if (value === undefined || runtime.relationNames.has(key)) return;

		const column = runtime.columns[key];
		if (!column || isScalarFilter(value) || isPlainObject(value)) return;

		const field = rootAlias
			? aliasedTableColumn(column, rootAlias)
			: column;
		conditions.push(value === null ? isNull(field) : eq(field, value));
	}

	return conditions.length ? and(...conditions) : undefined;
};

const preparedParamError = (message: string, dialect?: string) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.PreparedUnsupported,
		dialect,
		message,
	});

/**
 * Binds a prepared `param()` through the column encoder, the way Drizzle
 * binds literal values. Other values pass through unchanged.
 */
const bind = (column: AnyColumn, value: unknown) =>
	value instanceof Placeholder && is(column, Column)
		? sql.param(value, column)
		: value;

/** Binds a literal or `param()` through the column encoder. */
const encode = (column: AnyColumn, value: unknown) =>
	is(column, Column) ? sql.param(value, column) : value;

// `mode: 'insensitive'` equality lowers both sides in SQL on every dialect, so
// case folding follows the database rather than JS.
const lowerEq = (left: unknown, right: unknown) =>
	sql`lower(${left}) = lower(${right})`;

const lowerIn = (column: AnyColumn, values: unknown[]) =>
	values.length
		? sql`lower(${column}) in (${sql.join(
				values.map((value) => sql`lower(${encode(column, value)})`),
				sql`, `,
			)})`
		: sql`false`;

const lowerAny = (left: unknown, list: unknown) =>
	sql`lower(${left}) = any(select lower(v) from unnest(${list}::text[]) v)`;

/** Encodes a list param element by element for `= any($1)`. */
const listEncoder = (column: AnyColumn) => {
	const list = getPgArrayElementColumn(
		column,
		getPgArrayDimensions(column) + 1,
	);
	if ((column.mapToDriverValue as { isNoop?: boolean }).isNoop) return list;
	return Object.create(list, {
		mapToDriverValue: {
			value: (values: unknown[]) =>
				values.map((value) => column.mapToDriverValue(value)),
		},
	}) as AnyColumn;
};

/** Matches a list param on PostgreSQL; other dialects cannot bind arrays. */
const compileListParam = (
	column: AnyColumn,
	value: Placeholder,
	dialect: string | undefined,
	encoder: AnyColumn = column,
	insensitive = false,
) => {
	if (dialect !== 'pg')
		throw preparedParamError(
			'param() in "in" / "notIn" filters is only supported by PostgreSQL.',
			dialect,
		);
	const list = sql.param(value, listEncoder(encoder));
	return insensitive ? lowerAny(column, list) : sql`${column} = any(${list})`;
};

const PATTERN_MODES = ['contains', 'startsWith', 'endsWith'] as const;
const escapePattern = (value: string) => value.replace(/[!%_]/g, '!$&');
// Pattern params are wrapped in JS when the statement executes, so the
// database compares against a ready pattern instead of concatenating per row.
const PATTERN_ENCODERS = {
	contains: {
		mapToDriverValue: (value: unknown) =>
			`%${escapePattern(String(value))}%`,
	},
	endsWith: { mapToDriverValue: (value: unknown) => `%${value}` },
	startsWith: {
		mapToDriverValue: (value: unknown) =>
			`${escapePattern(String(value))}%`,
	},
};

const patternParam = (
	value: Placeholder,
	mode: 'contains' | 'startsWith' | 'endsWith',
) => sql.param(value, PATTERN_ENCODERS[mode]);

const isPatternValue = (value: unknown): value is string | Placeholder =>
	typeof value === 'string' || value instanceof Placeholder;

const compilePattern = (
	column: AnyColumn,
	value: string | Placeholder,
	mode: 'contains' | 'startsWith' | 'endsWith',
	insensitive: boolean,
	dialect: string | undefined,
) => {
	const pattern =
		typeof value !== 'string'
			? patternParam(value, mode)
			: mode === 'contains'
				? `%${escapePattern(value)}%`
				: mode === 'startsWith'
					? `${escapePattern(value)}%`
					: `%${value}`;

	// ILIKE is PostgreSQL-only; lowering both sides stays case-insensitive
	// under any SQLite/MySQL collation.
	const condition = !insensitive
		? like(column, pattern)
		: dialect && dialect !== 'pg'
			? sql`lower(${column}) like lower(${pattern})`
			: ilike(column, pattern);
	return mode === 'endsWith' ? condition : sql`${condition} escape '!'`;
};

const compileScalarFilter = (
	column: AnyColumn,
	value: unknown,
	dialect?: string,
): SQL | undefined => {
	if (value === undefined) return;
	if (value === null) return isNull(column);
	if (!isScalarFilter(value)) return eq(column, bind(column, value));

	const filter = value;
	const conditions: SQL[] = [];
	const insensitive = filter.mode === 'insensitive';

	if ('equals' in filter)
		conditions.push(
			filter.equals === null
				? isNull(column)
				: insensitive
					? lowerEq(column, encode(column, filter.equals))
					: eq(column, bind(column, filter.equals)),
		);

	if (Array.isArray(filter.in))
		conditions.push(
			insensitive
				? lowerIn(column, filter.in)
				: inArray(column, filter.in),
		);
	else if (filter.in instanceof Placeholder)
		conditions.push(
			compileListParam(column, filter.in, dialect, column, insensitive),
		);
	if (Array.isArray(filter.notIn))
		conditions.push(
			insensitive
				? not(lowerIn(column, filter.notIn))
				: notInArray(column, filter.notIn),
		);
	else if (filter.notIn instanceof Placeholder)
		conditions.push(
			not(
				compileListParam(
					column,
					filter.notIn,
					dialect,
					column,
					insensitive,
				),
			),
		);
	if (filter.lt !== undefined)
		conditions.push(lt(column, bind(column, filter.lt)));
	if (filter.lte !== undefined)
		conditions.push(lte(column, bind(column, filter.lte)));
	if (filter.gt !== undefined)
		conditions.push(gt(column, bind(column, filter.gt)));
	if (filter.gte !== undefined)
		conditions.push(gte(column, bind(column, filter.gte)));

	if (isPatternValue(filter.contains))
		conditions.push(
			compilePattern(
				column,
				filter.contains,
				'contains',
				insensitive,
				dialect,
			),
		);

	if (isPatternValue(filter.startsWith))
		conditions.push(
			compilePattern(
				column,
				filter.startsWith,
				'startsWith',
				insensitive,
				dialect,
			),
		);

	if (isPatternValue(filter.endsWith))
		conditions.push(
			compilePattern(
				column,
				filter.endsWith,
				'endsWith',
				insensitive,
				dialect,
			),
		);

	if ('not' in filter) {
		const nested =
			insensitive && isPatternValue(filter.not)
				? lowerEq(column, encode(column, filter.not))
				: compileScalarFilter(column, filter.not, dialect);
		if (nested) conditions.push(not(nested));
	}

	return conditions.length ? and(...conditions) : undefined;
};

const isJsonWhereFilter = (
	value: unknown,
): value is { json: Record<string, unknown> } =>
	isPlainObject(value) && isPlainObject(value.json);

const isJsonPathShorthand = (
	value: unknown,
): value is Record<string, unknown> => {
	if (!isPlainObject(value) || isScalarFilter(value)) return false;
	const keys = Object.keys(value);
	return keys.length > 0 && keys.every((key) => key.includes('.'));
};

const JSON_PARAM = {
	mapToDriverValue: (value: unknown) => JSON.stringify(value),
};
const JSON_LIST_PARAM = {
	mapToDriverValue: (values: unknown[]) =>
		values.map((value) => JSON.stringify(value)),
};

const isPgJsonbColumn = (column: AnyColumn) =>
	(column as { columnType?: string }).columnType === 'PgJsonb';

/** Number of `.array()` dimensions declared on a PostgreSQL column. */
export const getPgArrayDimensions = (column: AnyColumn) =>
	(column as { dimensions?: number }).dimensions ?? 0;

export const isPgArrayColumn = (column: AnyColumn) =>
	getPgArrayDimensions(column) > 0;

const pgArrayElementColumns = new WeakMap<AnyColumn, AnyColumn[]>();

/**
 * Returns a view of an array column with fewer dimensions. Drizzle 1.x keeps
 * array columns as their element class, and codecs cast params from
 * `dimensions`, so element params must be encoded through this view to keep
 * the element's `toDriver()` without an array cast.
 */
export const getPgArrayElementColumn = (
	column: AnyColumn,
	dimensions = 0,
): AnyColumn => {
	let elements = pgArrayElementColumns.get(column);
	if (!elements) {
		elements = [];
		pgArrayElementColumns.set(column, elements);
	}
	let element = elements[dimensions];
	if (!element) {
		element = Object.create(column, {
			dimensions: { value: dimensions },
		}) as AnyColumn;
		elements[dimensions] = element;
	}
	return element;
};

const isArrayFilter = (value: unknown): value is Record<string, unknown> =>
	isPlainObject(value) &&
	('equals' in value ||
		'has' in value ||
		'hasEvery' in value ||
		'hasNone' in value ||
		'hasSome' in value ||
		'containedBy' in value ||
		'none' in value ||
		'some' in value ||
		'every' in value ||
		'isEmpty' in value ||
		'length' in value ||
		'not' in value);

type ArrayElementQuantifier = 'none' | 'some' | 'every';

const arrayElementPredicateError = (quantifier: ArrayElementQuantifier) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.InvalidArgs,
		message: `Array ${quantifier} predicate must be a non-empty scalar filter object.`,
	});

const validateArrayElementPredicate = (
	quantifier: ArrayElementQuantifier,
	value: unknown,
): Record<string, unknown> => {
	if (!isScalarFilter(value)) throw arrayElementPredicateError(quantifier);

	const filter = value;
	let predicates = 0;
	for (const key in filter) {
		const entry = filter[key];
		if (key === 'mode') {
			if (entry !== 'default' && entry !== 'insensitive')
				throw arrayElementPredicateError(quantifier);
			continue;
		}
		if (key === 'in' || key === 'notIn') {
			if (entry instanceof Placeholder) {
				predicates += 1;
				continue;
			}
			if (!Array.isArray(entry) || entry.some((item) => item == null))
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.InvalidArgs,
					message: `Array ${quantifier} predicate cannot compare against a NULL array element.`,
				});
			predicates += 1;
			continue;
		}
		if (key === 'contains' || key === 'startsWith' || key === 'endsWith') {
			if (!isPatternValue(entry))
				throw arrayElementPredicateError(quantifier);
			predicates += 1;
			continue;
		}
		if (key === 'not') {
			if (entry == null)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.InvalidArgs,
					message: `Array ${quantifier} predicate cannot compare against a NULL array element.`,
				});
			if (isScalarFilter(entry))
				validateArrayElementPredicate(quantifier, entry);
			predicates += 1;
			continue;
		}
		if (
			key === 'equals' ||
			key === 'lt' ||
			key === 'lte' ||
			key === 'gt' ||
			key === 'gte'
		) {
			if (entry == null)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.InvalidArgs,
					message: `Array ${quantifier} predicate cannot compare against a NULL array element.`,
				});
			predicates += 1;
		}
	}
	if (!predicates) throw arrayElementPredicateError(quantifier);
	return filter;
};

const isListValue = (value: unknown) =>
	Array.isArray(value) || value instanceof Placeholder;

/** One-element array param; a prepared element is wrapped when it is bound. */
const elementList = (value: unknown, encoder: AnyColumn) =>
	value instanceof Placeholder
		? sql.param(
				value,
				Object.create(encoder, {
					mapToDriverValue: {
						value: (entry: unknown) =>
							encoder.mapToDriverValue([entry]),
					},
				}) as AnyColumn,
			)
		: sql.param([value], encoder);

const compileArrayElementScalarFilter = (
	column: AnyColumn,
	encoder: AnyColumn,
	value: Record<string, unknown>,
): SQL | undefined => {
	const conditions: SQL[] = [];
	const bind = (entry: unknown) => sql.param(entry, encoder);
	const pattern = (
		entry: string | Placeholder,
		mode: 'contains' | 'startsWith' | 'endsWith',
		insensitive: boolean,
	) => {
		const value =
			typeof entry !== 'string'
				? patternParam(entry, mode)
				: bind(
						mode === 'contains'
							? `%${escapePattern(entry)}%`
							: mode === 'startsWith'
								? `${escapePattern(entry)}%`
								: `%${entry}`,
					);
		const condition = insensitive
			? sql`${column} ilike ${value}`
			: sql`${column} like ${value}`;
		return mode === 'endsWith' ? condition : sql`${condition} escape '!'`;
	};

	const insensitive = value.mode === 'insensitive';
	const left = insensitive ? sql`lower(${column})` : column;
	const right: (entry: unknown) => SQLWrapper = insensitive
		? (entry) => sql`lower(${bind(entry)})`
		: bind;

	if ('equals' in value)
		conditions.push(sql`${left} = ${right(value.equals)}`);
	if (Array.isArray(value.in))
		conditions.push(
			value.in.length
				? sql`${left} in (${sql.join(value.in.map(right), sql`, `)})`
				: sql`false`,
		);
	else if (value.in instanceof Placeholder)
		conditions.push(
			compileListParam(column, value.in, 'pg', encoder, insensitive),
		);
	if (Array.isArray(value.notIn))
		conditions.push(
			value.notIn.length
				? sql`${left} not in (${sql.join(value.notIn.map(right), sql`, `)})`
				: sql`true`,
		);
	else if (value.notIn instanceof Placeholder)
		conditions.push(
			not(
				compileListParam(
					column,
					value.notIn,
					'pg',
					encoder,
					insensitive,
				),
			),
		);
	if (value.lt !== undefined)
		conditions.push(sql`${column} < ${bind(value.lt)}`);
	if (value.lte !== undefined)
		conditions.push(sql`${column} <= ${bind(value.lte)}`);
	if (value.gt !== undefined)
		conditions.push(sql`${column} > ${bind(value.gt)}`);
	if (value.gte !== undefined)
		conditions.push(sql`${column} >= ${bind(value.gte)}`);

	if (isPatternValue(value.contains))
		conditions.push(pattern(value.contains, 'contains', insensitive));
	if (isPatternValue(value.startsWith))
		conditions.push(pattern(value.startsWith, 'startsWith', insensitive));
	if (isPatternValue(value.endsWith))
		conditions.push(pattern(value.endsWith, 'endsWith', insensitive));
	if ('not' in value) {
		const nested = isScalarFilter(value.not)
			? compileArrayElementScalarFilter(column, encoder, value.not)
			: sql`${left} = ${right(value.not)}`;
		if (nested) conditions.push(not(nested));
	}

	return conditions.length ? and(...conditions) : undefined;
};

const compileArrayElementPredicate = (
	column: AnyColumn,
	encoder: AnyColumn,
	quantifier: ArrayElementQuantifier,
	value: unknown,
) => {
	const filter = validateArrayElementPredicate(quantifier, value);
	const keys = Object.keys(filter);
	const predicateKeys = keys.filter((key) => key !== 'mode');
	const only = predicateKeys.length === 1 ? predicateKeys[0] : undefined;
	const notNull = sql`${column} is not null`;
	const elementEncoder = getPgArrayElementColumn(encoder);
	const insensitive = filter.mode === 'insensitive';

	if (
		!insensitive &&
		only === 'equals' &&
		filter.equals !== null &&
		filter.equals !== undefined
	) {
		const values = elementList(filter.equals, encoder);
		const match = sql`${column} @> ${values}`;
		if (quantifier === 'some') return match;
		if (quantifier === 'every')
			return sql`${notNull} and ${column} <@ ${values}`;
		return sql`${notNull} and not (${match})`;
	}

	if (
		!insensitive &&
		only === 'in' &&
		(Array.isArray(filter.in) || filter.in instanceof Placeholder)
	) {
		const values = sql.param(filter.in, encoder);
		if (quantifier === 'some') return sql`${column} && ${values}`;
		if (quantifier === 'every')
			return sql`${notNull} and ${column} <@ ${values}`;
		return sql`${notNull} and not (${column} && ${values})`;
	}

	if (only === 'lt' || only === 'lte' || only === 'gt' || only === 'gte') {
		const comparison =
			only === 'lt'
				? sql`${sql.param(filter.lt, elementEncoder)} >`
				: only === 'lte'
					? sql`${sql.param(filter.lte, elementEncoder)} >=`
					: only === 'gt'
						? sql`${sql.param(filter.gt, elementEncoder)} <`
						: sql`${sql.param(filter.gte, elementEncoder)} <=`;
		const quantifierSql = quantifier === 'every' ? sql`all` : sql`any`;
		const matches = sql`${comparison} ${quantifierSql}(${column})`;
		if (quantifier === 'none')
			return sql`${notNull} and coalesce(not (${matches}), true)`;
		return sql`${notNull} and ${matches}`;
	}

	const element = sql.raw('array_element') as unknown as AnyColumn;
	const predicate = compileArrayElementScalarFilter(
		element,
		elementEncoder,
		filter,
	);
	if (!predicate) throw arrayElementPredicateError(quantifier);

	const source = sql`unnest(${column}) as array_element`;
	const matches = sql`(${predicate}) is true`;
	if (quantifier === 'some')
		return sql`${notNull} and exists (select 1 from ${source} where ${matches})`;
	if (quantifier === 'every')
		return sql`${notNull} and not exists (select 1 from ${source} where (${predicate}) is not true)`;
	return sql`${notNull} and not exists (select 1 from ${source} where ${matches})`;
};

const compileArrayFilter = (
	column: AnyColumn,
	value: Record<string, unknown>,
	encoder: AnyColumn = column,
): SQL | undefined => {
	const conditions: SQL[] = [];
	const needsCardinality =
		value.isEmpty !== undefined || value.length !== undefined;
	const cardinality = needsCardinality
		? sql`cardinality(${column})`
		: undefined;

	if ('equals' in value)
		conditions.push(
			value.equals === null
				? isNull(column)
				: eq(column, bind(encoder, value.equals)),
		);
	if (value.has !== undefined && value.has !== null)
		conditions.push(sql`${column} @> ${elementList(value.has, encoder)}`);
	if (isListValue(value.hasEvery))
		conditions.push(
			sql`${column} @> ${sql.param(value.hasEvery, encoder)}`,
		);
	if (isListValue(value.hasSome))
		conditions.push(sql`${column} && ${sql.param(value.hasSome, encoder)}`);
	if (isListValue(value.hasNone))
		conditions.push(
			sql`not (${column} && ${sql.param(value.hasNone, encoder)})`,
		);
	if (isListValue(value.containedBy))
		conditions.push(
			sql`${column} <@ ${sql.param(value.containedBy, encoder)}`,
		);
	if ('some' in value)
		conditions.push(
			compileArrayElementPredicate(column, encoder, 'some', value.some),
		);
	if ('every' in value)
		conditions.push(
			compileArrayElementPredicate(column, encoder, 'every', value.every),
		);
	if ('none' in value)
		conditions.push(
			compileArrayElementPredicate(column, encoder, 'none', value.none),
		);
	if (value.isEmpty === true && cardinality)
		conditions.push(eq(cardinality, 0));
	if (value.isEmpty === false && cardinality)
		conditions.push(gt(cardinality, 0));
	if (typeof value.length === 'number' || value.length instanceof Placeholder)
		conditions.push(eq(cardinality as SQL, value.length));
	else if (isPlainObject(value.length) && cardinality) {
		const lengthFilter = compileScalarFilter(
			cardinality as unknown as AnyColumn,
			value.length,
		);
		if (lengthFilter) conditions.push(lengthFilter);
	}
	if ('not' in value) {
		if (isPlainObject(value.not)) {
			const nested = compileArrayFilter(column, value.not, encoder);
			if (nested) conditions.push(not(nested));
		} else if (value.not === null) conditions.push(not(isNull(column)));
		else if (value.not !== undefined)
			conditions.push(not(eq(column, bind(encoder, value.not))));
	}

	return conditions.length ? and(...conditions) : undefined;
};

const compileJsonPathFilter = (
	column: AnyColumn,
	path: string,
	value: unknown,
) => {
	if (value === undefined) return;
	const parts = path.split('.');
	const pathSql = sql`ARRAY[${sql.join(
		parts.map((part) => sql`${part}`),
		sql`, `,
	)}]::text[]`;
	const jsonValue = sql`${column} #> ${pathSql}`;
	const textValue = sql`${column} #>> ${pathSql}`;
	const jsonType = sql`jsonb_typeof(${jsonValue})`;
	const insensitive = isPlainObject(value) && value.mode === 'insensitive';
	const compare = (entry: unknown): SQL | undefined => {
		if (entry instanceof Placeholder)
			return insensitive
				? and(eq(jsonType, 'string'), lowerEq(textValue, entry))
				: sql`${jsonValue} = ${sql.param(entry, JSON_PARAM)}::jsonb`;
		if (entry === null) return eq(jsonType, 'null');
		if (typeof entry === 'string')
			return and(
				eq(jsonType, 'string'),
				insensitive ? lowerEq(textValue, entry) : eq(textValue, entry),
			);
		if (typeof entry === 'boolean')
			return and(
				eq(jsonType, 'boolean'),
				eq(sql`(${textValue})::boolean`, entry),
			);
		if (typeof entry === 'number' || typeof entry === 'bigint')
			return and(
				eq(jsonType, 'number'),
				eq(sql`(${textValue})::numeric`, entry),
			);
	};
	const numeric = sql`(${textValue})::numeric`;
	// Groups list values by JSON type so each type compiles to one guarded IN.
	const compareAny = (entries: unknown[]): SQL => {
		const strings: string[] = [];
		const numbers: (number | bigint)[] = [];
		const booleans: boolean[] = [];
		const branches: SQL[] = [];
		for (const entry of entries) {
			if (typeof entry === 'string') strings.push(entry);
			else if (typeof entry === 'number' || typeof entry === 'bigint')
				numbers.push(entry);
			else if (typeof entry === 'boolean') booleans.push(entry);
			else if (entry === null) branches.push(eq(jsonType, 'null'));
		}
		if (strings.length)
			branches.push(
				and(
					eq(jsonType, 'string'),
					insensitive
						? lowerIn(textValue as unknown as AnyColumn, strings)
						: inArray(textValue, strings),
				) as SQL,
			);
		if (numbers.length)
			branches.push(
				and(eq(jsonType, 'number'), inArray(numeric, numbers)) as SQL,
			);
		if (booleans.length)
			branches.push(
				and(
					eq(jsonType, 'boolean'),
					inArray(sql`(${textValue})::boolean`, booleans),
				) as SQL,
			);
		return branches.length ? (or(...branches) as SQL) : sql`false`;
	};
	const anyParam = (entry: Placeholder) =>
		insensitive
			? (and(eq(jsonType, 'string'), lowerAny(textValue, entry)) as SQL)
			: sql`${jsonValue} = any(${sql.param(entry, JSON_LIST_PARAM)}::jsonb[])`;
	const isNumber = (entry: unknown) =>
		typeof entry === 'number' || entry instanceof Placeholder;
	if (!isScalarFilter(value)) return compare(value);
	const conditions: SQL[] = [];
	if ('equals' in value) {
		const condition = compare(value.equals);
		if (condition) conditions.push(condition);
	}
	if (Array.isArray(value.in)) conditions.push(compareAny(value.in));
	else if (value.in instanceof Placeholder)
		conditions.push(anyParam(value.in));
	if (Array.isArray(value.notIn) && value.notIn.length)
		conditions.push(not(compareAny(value.notIn)));
	else if (value.notIn instanceof Placeholder)
		conditions.push(not(anyParam(value.notIn)));
	if (isNumber(value.lt))
		conditions.push(
			and(eq(jsonType, 'number'), lt(numeric, value.lt)) as SQL,
		);
	if (isNumber(value.lte))
		conditions.push(
			and(eq(jsonType, 'number'), lte(numeric, value.lte)) as SQL,
		);
	if (isNumber(value.gt))
		conditions.push(
			and(eq(jsonType, 'number'), gt(numeric, value.gt)) as SQL,
		);
	if (isNumber(value.gte))
		conditions.push(
			and(eq(jsonType, 'number'), gte(numeric, value.gte)) as SQL,
		);
	const text = textValue as unknown as AnyColumn;
	for (const mode of PATTERN_MODES) {
		const entry = value[mode];
		if (!isPatternValue(entry)) continue;
		conditions.push(
			and(
				eq(jsonType, 'string'),
				compilePattern(
					text,
					entry,
					mode,
					value.mode === 'insensitive',
					'pg',
				),
			) as SQL,
		);
	}
	if ('not' in value) {
		const nested =
			insensitive && isPatternValue(value.not)
				? compare(value.not)
				: compileJsonPathFilter(column, path, value.not);
		if (nested) conditions.push(not(nested));
	}
	return conditions.length ? and(...conditions) : undefined;
};

const makeJoinCondition = (
	fields: AnyColumn[],
	references: AnyColumn[],
	referencedTable: Parameters<DrizzleLikeDatabase['insert']>[0],
) => {
	const referencedColumns = getColumns(referencedTable);
	// getColumns() keys columns by their JS property name, while
	// reference.name holds the database column name. Those differ for any mapped
	// column (`authorId: integer('author_id')`), so resolve by database name too
	// and fall back to the reference itself, which normalizeRelation() already
	// resolved against this table. Dropping a condition here would silently emit
	// an uncorrelated subquery and match unrelated rows.
	const columnsByDatabaseName = new Map(
		Object.values(referencedColumns).map((column) => [column.name, column]),
	);
	const conditions: SQL[] = [];

	for (let index = 0; index < references.length; index += 1) {
		const sourceField = fields[index];
		const reference = references[index];
		if (!sourceField || !reference) continue;

		const referencedColumn =
			referencedColumns[reference.name] ??
			columnsByDatabaseName.get(reference.name) ??
			reference;

		conditions.push(eq(referencedColumn, sourceField));
	}

	return conditions.length ? and(...conditions) : undefined;
};

const compileRelationFilter = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	relationName: string,
	value: unknown,
) => {
	if (!isPlainObject(value)) return;

	const relationState = context.runtime.relations[relationName];
	if (!relationState) return;

	const relationRuntime = getTableRuntime(context, relationState.tableName);
	// Under the relational query builder the parent table is aliased to its
	// schema key (from "users" "users_alias"). The builder rewrites top-level
	// column references to that alias but not the ones inside this correlated
	// subquery, so a parent column referenced by its real table name would not
	// resolve. When rootAlias is set, reference the parent fields through it.
	const fields = context.rootAlias
		? relationState.fields.map((field) =>
				aliasedTableColumn(field, context.rootAlias as string),
			)
		: relationState.fields;
	// A self relation (categories.children, users.followers) queries the same
	// table as the parent, so the subquery's table is aliased; otherwise the
	// correlation would compare each row with itself. Nested levels get their
	// own alias so deeper filters correlate against the right level.
	const targetAlias =
		relationRuntime.table === context.runtime.table
			? `__better_self_${
					context.rootAlias?.startsWith('__better_self_')
						? Number(context.rootAlias.slice(14)) + 1
						: 0
				}`
			: undefined;
	const targetTable = targetAlias
		? (aliasedTable(relationRuntime.table, targetAlias) as Table)
		: relationRuntime.table;
	const references = targetAlias
		? relationState.references.map((reference) =>
				aliasedTableColumn(reference, targetAlias),
			)
		: relationState.references;
	const joinCondition = targetAlias
		? and(
				...references.map((reference, index) =>
					eq(reference, fields[index] as AnyColumn),
				),
			)
		: makeJoinCondition(fields, references, relationRuntime.table);
	const subquery = context.db.select({ one: sql`1` }).from(targetTable);
	const buildNestedWhere = (nestedWhere?: Record<string, unknown>) =>
		compileWhereInput(
			{
				...context,
				runtime: relationRuntime,
				tableName: relationState.tableName,
				// The subquery's own table is referenced by its real name (or its
				// self-relation alias), and a deeper filter correlates against it,
				// not the aliased root.
				rootAlias: targetAlias,
			},
			nestedWhere,
		);
	const canUseMembershipFilter =
		relationState.fields.length === 1 && references.length === 1;
	const sourceField = fields[0];
	const referenceField = references[0];
	const buildMembershipFilter = (
		nestedWhere: Record<string, unknown>,
		negated = false,
	) => {
		if (!canUseMembershipFilter || !sourceField || !referenceField) return;

		const predicate = buildNestedWhere(nestedWhere);
		const subquery = context.db
			.select({ value: referenceField })
			.from(targetTable);

		if (!negated)
			return inArray(
				sourceField,
				predicate ? subquery.where(predicate) : subquery,
			);

		// isNot keeps rows without a related record, like the NOT EXISTS path:
		// a NULL foreign key never satisfies NOT IN, and a NULL in the subquery
		// would make NOT IN unknown for every row.
		return or(
			isNull(sourceField),
			notInArray(
				sourceField,
				subquery.where(and(isNotNull(referenceField), predicate)),
			),
		);
	};

	if (relationState.kind === 'manyToMany') {
		const through = relationState.through;
		if (!through) return;
		const throughRuntime = getTableRuntime(context, through.tableName);
		const correlate: SQL[] = [];
		const link: SQL[] = [];
		for (let index = 0; index < fields.length; index += 1) {
			const field = fields[index];
			const sourceField = through.sourceFields[index];
			if (field && sourceField) correlate.push(eq(sourceField, field));
		}
		for (let index = 0; index < references.length; index += 1) {
			const reference = references[index];
			const targetField = through.targetFields[index];
			if (reference && targetField) link.push(eq(targetField, reference));
		}
		const linked = (predicate?: SQL) =>
			context.db
				.select({ one: sql`1` })
				.from(throughRuntime.table)
				.innerJoin(targetTable, and(...link))
				.where(and(...correlate, predicate));

		if ('some' in value)
			return exists(
				linked(buildNestedWhere(value.some as Record<string, unknown>)),
			);
		if ('none' in value)
			return notExists(
				linked(buildNestedWhere(value.none as Record<string, unknown>)),
			);
		if ('every' in value) {
			const nestedWhere = buildNestedWhere(
				value.every as Record<string, unknown>,
			);
			return notExists(
				linked(nestedWhere ? not(nestedWhere) : undefined),
			);
		}
		return;
	}

	if (relationState.kind === 'many') {
		if ('some' in value)
			return exists(
				subquery.where(
					and(
						joinCondition,
						buildNestedWhere(value.some as Record<string, unknown>),
					),
				),
			);

		if ('none' in value)
			return notExists(
				subquery.where(
					and(
						joinCondition,
						buildNestedWhere(value.none as Record<string, unknown>),
					),
				),
			);

		if ('every' in value) {
			const nestedWhere = buildNestedWhere(
				value.every as Record<string, unknown>,
			);
			return notExists(
				subquery.where(
					and(
						joinCondition,
						nestedWhere ? not(nestedWhere) : undefined,
					),
				),
			);
		}

		return;
	}

	if (relationState.kind === 'one') {
		if ('is' in value) {
			if (value.is === null)
				return notExists(subquery.where(joinCondition));

			const membership = buildMembershipFilter(
				value.is as Record<string, unknown>,
			);
			if (membership) return membership;

			return exists(
				subquery.where(
					and(
						joinCondition,
						buildNestedWhere(value.is as Record<string, unknown>),
					),
				),
			);
		}

		if ('isNot' in value) {
			if (value.isNot === null)
				return exists(subquery.where(joinCondition));

			const membership = buildMembershipFilter(
				value.isNot as Record<string, unknown>,
				true,
			);
			if (membership) return membership;

			return notExists(
				subquery.where(
					and(
						joinCondition,
						buildNestedWhere(
							value.isNot as Record<string, unknown>,
						),
					),
				),
			);
		}
	}
};

/**
 * Compiles a structured where-clause input into a Drizzle SQL expression.
 * Handles scalar equality, scalar filters (equals, in, lt, gt, contains, etc.),
 * logical combinators (AND, OR, NOT), nested relation filters, and raw
 * SQLWrapper values.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context - The where-compiler context (runtime, table, db, etc.).
 * @param where   - The structured where-clause input.
 * @returns A Drizzle SQL expression, or `undefined` when no filter is needed.
 */
export const compileWhereInput = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	where?: CompilableWhere,
): SQL | undefined => {
	if (!where) return;
	if (isSQLWrapper(where)) {
		const query = where.getSQL();
		return context.rootAlias
			? mapColumnsInSQLToAlias(query, context.rootAlias)
			: query;
	}
	if (!isPlainObject(where)) return;
	if (!('AND' in where || 'OR' in where || 'NOT' in where)) {
		const simple = compileSimpleWhere(
			context.runtime,
			where,
			context.rootAlias,
		);

		if (simple) return simple;
	}

	const conditions: SQL[] = [];

	for (const key in where) {
		const value = where[key];

		if (key === 'AND' && Array.isArray(value)) {
			const nested: SQL[] = [];

			for (const entry of value) {
				const clause = compileWhereInput(
					context,
					entry as Record<string, unknown>,
				);
				if (clause) nested.push(clause);
			}
			const clause = and(...nested);
			if (clause) conditions.push(clause);
			continue;
		}

		if (key === 'OR' && Array.isArray(value)) {
			const nested: SQL[] = [];

			for (const entry of value) {
				const clause = compileWhereInput(
					context,
					entry as Record<string, unknown>,
				);
				if (clause) nested.push(clause);
			}
			const clause = or(...nested);
			if (clause) conditions.push(clause);
			continue;
		}

		if (key === 'NOT') {
			const entries = Array.isArray(value) ? value : [value];
			const nested: SQL[] = [];

			for (const entry of entries) {
				const clause = compileWhereInput(
					context,
					entry as Record<string, unknown>,
				);
				if (clause) nested.push(not(clause));
			}
			const clause = and(...nested);
			if (clause) conditions.push(clause);
			continue;
		}

		if (context.runtime.relationNames.has(key)) {
			const relationFilter = compileRelationFilter(context, key, value);
			if (relationFilter) conditions.push(relationFilter);
			continue;
		}

		const column = context.runtime.columns[key];
		if (!column) {
			if (context.runtime.unsupportedRelations[key])
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.OperationError,
					details: { relation: key },
					message: `Relation "${key}" on "${context.runtime.dbName}" cannot be filtered: ${context.runtime.unsupportedRelations[key]}.`,
					operation: 'where',
					table: context.runtime.dbName,
				});
			continue;
		}

		const field = context.rootAlias
			? aliasedTableColumn(column, context.rootAlias)
			: column;

		if (
			(column as { columnType?: string }).columnType === 'PgJson' &&
			isJsonPathShorthand(value)
		)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.JsonbQueryUnsupported,
				column: key,
				dialect: context.dialect,
				message:
					'JSON path filters require a jsonb column; json columns only support whole-document filters.',
				table: context.tableName,
			});

		const jsonPaths = isJsonWhereFilter(value)
			? value.json
			: isPgJsonbColumn(column) && isJsonPathShorthand(value)
				? value
				: undefined;
		if (jsonPaths) {
			if (context.dialect !== 'pg')
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.JsonbQueryUnsupported,
					column: key,
					dialect: context.dialect,
					message:
						'JSONB path filters are only supported by PostgreSQL.',
					table: context.tableName,
				});
			for (const path in jsonPaths) {
				const clause = compileJsonPathFilter(
					field,
					path,
					jsonPaths[path],
				);
				if (clause) conditions.push(clause);
			}
			continue;
		}

		if (isPgArrayColumn(column) && isArrayFilter(value)) {
			if (context.dialect !== 'pg')
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.ArrayQueryUnsupported,
					column: key,
					dialect: context.dialect,
					message:
						'Native PostgreSQL array filters are only supported by PostgreSQL.',
					table: context.tableName,
				});
			const arrayFilter = compileArrayFilter(field, value, column);
			if (arrayFilter) conditions.push(arrayFilter);
			continue;
		}

		const scalarFilter = compileScalarFilter(field, value, context.dialect);
		if (scalarFilter) conditions.push(scalarFilter);
	}

	return conditions.length ? and(...conditions) : undefined;
};

/**
 * Compiles an `OrderByInput` into an array of Drizzle SQL order-by clauses.
 * Supports single or multi-column ordering with ascending/descending direction,
 * plus relation keys: a field map for one relations, `{ _count }` for to-many.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context - The where-compiler context.
 * @param orderBy - The sort specification (single object or array).
 * @returns An array of Drizzle SQL order-by clauses, or `undefined` when none is provided.
 */
export const compileOrderBy = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	orderBy?: OrderByInput<Schema, BetterTableKey<Schema>>,
) => {
	if (!orderBy) return;

	const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
	const clauses: SQL[] = [];

	for (const entry of entries)
		for (const key in entry as Record<string, unknown>) {
			const value = (entry as Record<string, unknown>)[key];
			const column = context.runtime.columns[key];

			if (column) pushOrder(clauses, context.dialect, column, value);
			else
				compileRelationOrder(
					context,
					context.runtime,
					context.rootAlias,
					key,
					value,
					0,
					undefined,
					clauses,
				);
		}

	return clauses.length ? clauses : undefined;
};

const pushOrder = (
	clauses: SQL[],
	dialect: string | undefined,
	expression: SQLWrapper | AnyColumn,
	value: unknown,
) => {
	const direction = orderDirection(value);
	const nulls = orderNulls(value);
	if (!nulls) {
		clauses.push(direction === 'desc' ? desc(expression) : asc(expression));
		return;
	}

	if (dialect === 'mysql') {
		// MySQL sorts NULL first ascending and last descending; emulate the rest.
		if ((nulls === 'first') !== (direction === 'asc'))
			clauses.push(
				nulls === 'first'
					? desc(isNull(expression))
					: asc(isNull(expression)),
			);
		clauses.push(direction === 'desc' ? desc(expression) : asc(expression));
		return;
	}

	clauses.push(
		sql`${expression} ${sql.raw(direction)} nulls ${sql.raw(nulls)}`,
	);
};

/** Cursor tokens hold scalar row values only, so relation sorts cannot page. */
export const relationCursorError = (runtime: TableRuntime, relation: string) =>
	invalidRelationOrder(
		runtime,
		relation,
		`Cursor pagination cannot sort by relation "${relation}" on "${runtime.dbName}"; sort by scalar columns instead.`,
	);

const invalidRelationOrder = (
	runtime: TableRuntime,
	relation: string,
	message: string,
) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.InvalidArgs,
		details: { relation },
		message,
		operation: 'orderBy',
		table: runtime.dbName,
	});

/**
 * Sorts by a relation through correlated scalar subqueries, so the outer
 * FROM clause and row count stay unchanged. A one relation selects the
 * related value (`limit 1`), wrapping deeper levels; a to-many relation sorts
 * by its row count. Each depth gets its own alias so self relations correlate.
 */
const compileRelationOrder = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	runtime: TableRuntime,
	sourceAlias: string | undefined,
	key: string,
	value: unknown,
	depth: number,
	wrap: ((expression: SQLWrapper | AnyColumn) => SQL) | undefined,
	clauses: SQL[],
) => {
	const relation = runtime.relations[key];
	if (!relation) {
		if (runtime.unsupportedRelations[key])
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				details: { relation: key },
				message: `Relation "${key}" on "${runtime.dbName}" cannot be sorted: ${runtime.unsupportedRelations[key]}.`,
				operation: 'orderBy',
				table: runtime.dbName,
			});
		return;
	}
	if (value === undefined) return;

	const alias = `__better_order_${depth}`;
	if (relation.kind !== 'one') {
		if (
			!isPlainObject(value) ||
			(value._count !== 'asc' && value._count !== 'desc') ||
			Object.keys(value).length !== 1
		)
			throw invalidRelationOrder(
				runtime,
				key,
				`Relation "${key}" on "${runtime.dbName}" is a to-many relation; sort it by { _count: 'asc' | 'desc' }.`,
			);
		const count = buildRelationCount(
			context,
			relation,
			alias,
			undefined,
			sourceAlias,
		);
		pushOrder(
			clauses,
			context.dialect,
			wrap ? wrap(count) : count,
			value._count,
		);
		return;
	}

	const target = getTableRuntime(context, relation.tableName);
	if (!isPlainObject(value) || ('_count' in value && !target.columns._count))
		throw invalidRelationOrder(
			runtime,
			key,
			`Relation "${key}" on "${runtime.dbName}" is a one relation; sort it by a field map of "${relation.tableName}".`,
		);

	const table = aliasedTable(target.table, alias) as Table;
	const links: SQL[] = [];
	for (let index = 0; index < relation.references.length; index += 1) {
		const reference = relation.references[index];
		const field = relation.fields[index];
		if (reference && field)
			links.push(
				eq(
					aliasedTableColumn(reference, alias),
					sourceAlias
						? aliasedTableColumn(field, sourceAlias)
						: field,
				),
			);
	}
	const select = (expression: SQLWrapper | AnyColumn) => {
		const subquery = sql`(${context.db
			.select({ value: expression as SQL })
			.from(table)
			.where(and(...links))
			.limit(1)})`;
		return wrap ? wrap(subquery) : subquery;
	};

	for (const nestedKey in value) {
		const column = target.columns[nestedKey];
		if (!column)
			compileRelationOrder(
				context,
				target,
				alias,
				nestedKey,
				value[nestedKey],
				depth + 1,
				select,
				clauses,
			);
		else if (value[nestedKey] !== undefined)
			pushOrder(
				clauses,
				context.dialect,
				select(aliasedTableColumn(column, alias)),
				value[nestedKey],
			);
	}
};

/**
 * Correlated `count(*)` subquery over a to-many relation, through the
 * junction for many-to-many. Shared by `include._count` and `_count` sorts.
 */
export const buildRelationCount = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	relation: TableRuntime['relations'][string],
	alias: string,
	where?: unknown,
	sourceAlias?: string,
) => {
	const targetRuntime = getTableRuntime(context, relation.tableName);
	const targetTable = aliasedTable(targetRuntime.table, alias);
	const nestedWhere =
		where === undefined
			? undefined
			: compileWhereInput(
					{
						...context,
						runtime: targetRuntime,
						tableName: relation.tableName,
						rootAlias: alias,
					} as WhereCompilerContext<Schema, Meta>,
					where as CompilableWhere,
				);
	const source = (field: AnyColumn) =>
		sourceAlias ? aliasedTableColumn(field, sourceAlias) : field;

	if (relation.kind !== 'manyToMany') {
		const links: SQL[] = [];
		for (let index = 0; index < relation.references.length; index += 1) {
			const reference = relation.references[index];
			const field = relation.fields[index];
			if (reference && field)
				links.push(
					eq(aliasedTableColumn(reference, alias), source(field)),
				);
		}
		return sql<number>`(${context.db
			.select({ value: sql<number>`count(*)` })
			.from(targetTable)
			.where(and(...links, nestedWhere))})`;
	}

	const through = relation.through as NonNullable<typeof relation.through>;
	const throughRuntime = getTableRuntime(context, through.tableName);
	const throughAlias = `${alias}_through`;
	const throughTable = aliasedTable(throughRuntime.table, throughAlias);
	const joins: SQL[] = [];
	const links: SQL[] = [];
	for (let index = 0; index < relation.references.length; index += 1) {
		const targetField = relation.references[index];
		const throughTarget = through.targetFields[index];
		if (targetField && throughTarget)
			joins.push(
				eq(
					aliasedTableColumn(throughTarget, throughAlias),
					aliasedTableColumn(targetField, alias),
				),
			);
	}
	for (let index = 0; index < relation.fields.length; index += 1) {
		const sourceField = relation.fields[index];
		const throughSource = through.sourceFields[index];
		if (sourceField && throughSource)
			links.push(
				eq(
					aliasedTableColumn(throughSource, throughAlias),
					source(sourceField),
				),
			);
	}
	return sql<number>`(${context.db
		.select({ value: sql<number>`count(*)` })
		.from(throughTable)
		.innerJoin(targetTable, and(...joins))
		.where(and(...links, nestedWhere))})`;
};

/**
 * Binds every field of a prepared cursor to the one cursor param. Each
 * field encoder reads its own key from the cursor object at execution time.
 */
export const cursorParam = (
	runtime: TableRuntime,
	cursor: Placeholder,
	key: string,
) => {
	const column = runtime.columns[key] as AnyColumn;
	return sql.param(
		cursor,
		Object.create(column, {
			mapToDriverValue: {
				value: (value: Record<string, unknown>) => {
					const field = value[key];
					if (field === null || field === undefined)
						throw new BetterDrizzleError({
							code: BetterDrizzleErrorCode.InvalidArgs,
							details: { cursorField: key },
							message: `Prepared cursor "${cursor.name}" must include a non-null "${key}" for table "${runtime.dbName}".`,
							operation: 'cursor',
							table: runtime.dbName,
						});
					return column.mapToDriverValue(field);
				},
			},
		}) as AnyColumn,
	);
};

const cursorParamValues = (
	runtime: TableRuntime,
	cursor: Placeholder,
	orderBy: unknown,
) => {
	const values = Object.create(null) as Record<string, unknown>;
	const entries = orderBy
		? Array.isArray(orderBy)
			? orderBy
			: [orderBy]
		: runtime.primaryKeyFields.map((key) => ({ [key]: 'asc' }));
	for (const entry of entries)
		for (const key in entry as Record<string, unknown>)
			if (runtime.columns[key])
				values[key] = cursorParam(runtime, cursor, key);
	return values;
};

/**
 * Compiles a cursor-based where-clause. Uses the cursor column and value
 * to generate a `gt` or `lt` condition based on the current sort direction.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context - The where-compiler context.
 * @param cursor  - The cursor position (column name and value).
 * @param orderBy - The sort specification used to determine direction.
 * @param take    - The take value; negative values reverse the cursor direction.
 * @returns A Drizzle SQL expression, or `undefined` when no cursor is provided.
 */
export const compileCursorWhere = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	cursor?: CursorInput<Schema, BetterTableKey<Schema>> | Placeholder,
	orderBy?: OrderByInput<Schema, BetterTableKey<Schema>>,
	take?: unknown,
) => {
	if (!cursor) return;

	const values =
		cursor instanceof Placeholder
			? cursorParamValues(context.runtime, cursor, orderBy)
			: (cursor as Record<string, unknown>);
	const orderedFields: Array<{
		column: (typeof context.runtime.columns)[string];
		value: unknown;
		direction: 'asc' | 'desc';
		nulls: 'first' | 'last' | undefined;
	}> = [];
	const entries = orderBy
		? Array.isArray(orderBy)
			? orderBy
			: [orderBy]
		: undefined;

	if (entries)
		for (const entry of entries)
			for (const key in entry as Record<string, unknown>) {
				const column = context.runtime.columns[key];
				if (!column) {
					if (context.runtime.relations[key])
						throw relationCursorError(context.runtime, key);
					continue;
				}
				if (!(key in values) || values[key] === undefined)
					throw new BetterDrizzleError({
						code: BetterDrizzleErrorCode.InvalidArgs,
						details: { cursorField: key },
						message: `Cursor must include orderBy field "${key}" for table "${context.runtime.dbName}".`,
						operation: 'cursor',
						table: context.runtime.dbName,
					});

				const value = (entry as Record<string, unknown>)[key];
				const direction = orderDirection(value);
				orderedFields.push({
					column,
					direction,
					nulls:
						orderNulls(value) ??
						(context.dialect === 'pg'
							? direction === 'asc'
								? 'last'
								: 'first'
							: direction === 'asc'
								? 'first'
								: 'last'),
					value: values[key],
				});
			}

	if (orderedFields.length === 0) {
		const [cursorField, value] =
			Object.entries(values).find(
				([key]) => context.runtime.columns[key],
			) ?? [];
		if (!cursorField) return;

		const column = context.runtime.columns[cursorField];
		if (!column) return;

		orderedFields.push({
			column,
			direction: typeof take === 'number' && take < 0 ? 'desc' : 'asc',
			nulls: undefined,
			value,
		});
	}

	const equalPrefix: SQL[] = [];
	const after: SQL[] = [];
	for (const field of orderedFields) {
		const comparison =
			field.direction === 'desc'
				? lt(field.column, field.value)
				: gt(field.column, field.value);
		let afterValue: SQL | undefined;
		if (field.value === null)
			afterValue =
				field.nulls === 'first' ? isNotNull(field.column) : undefined;
		else
			afterValue =
				field.nulls === 'last'
					? or(comparison, isNull(field.column))
					: comparison;

		if (afterValue)
			after.push(
				equalPrefix.length
					? and(...equalPrefix, afterValue)!
					: afterValue,
			);
		equalPrefix.push(
			field.value === null
				? isNull(field.column)
				: eq(field.column, field.value),
		);
	}

	return after.length ? or(...after) : sql`false`;
};

/**
 * Counts the number of rows matching an optional where-clause. Uses
 * Drizzle's `$count` method when available, otherwise falls back to
 * a `SELECT count()` query.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to count.
 * @param where     - Optional where-clause to filter by.
 * @returns A promise resolving to the row count.
 */
export const buildCountQuery = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	where?: WhereArg<Schema, BetterTableKey<Schema>>,
	cursor?: CursorInput<Schema, BetterTableKey<Schema>> | Placeholder,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const whereContext = {
		...context,
		runtime,
		tableName: tableName as string,
	} as WhereCompilerContext<Schema, Meta>;
	const predicate = compileWhereInput(
		whereContext,
		where as CompilableWhere | undefined,
	);
	const cursorPredicate = compileCursorWhere(whereContext, cursor);
	const mergedPredicate = and(predicate, cursorPredicate);

	return context.db
		.select({ count: count() })
		.from(runtime.table)
		.where(mergedPredicate);
};

export const countRows = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	where?: WhereArg<Schema, BetterTableKey<Schema>>,
	cursor?: CursorInput<Schema, BetterTableKey<Schema>> | Placeholder,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const whereContext = {
		...context,
		runtime,
		tableName: tableName as string,
	} as WhereCompilerContext<Schema, Meta>;
	const predicate = compileWhereInput(
		whereContext,
		where as CompilableWhere | undefined,
	);
	const cursorPredicate = compileCursorWhere(whereContext, cursor);
	const mergedPredicate = and(predicate, cursorPredicate);

	if (typeof context.db.$count === 'function')
		return context.db.$count(runtime.table, mergedPredicate);

	const result = await buildCountQuery(context, tableName, where, cursor);

	return Number(result[0]?.count ?? 0);
};

export const buildOffsetPaginationQuery = <Schema extends AnySchema, Meta>(
	args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	// Prepared params never reach here: prepared paginate resolves them itself.
	const take = (args.take ?? args.perPage ?? args.limit ?? 10) as number;
	const page = args.page as number | undefined;
	if (
		page !== undefined &&
		(args.skip !== undefined || !Number.isInteger(page) || page < 1)
	)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.InvalidArgs,
			details: { page, skip: args.skip },
			message:
				args.skip === undefined
					? 'paginate() page must be an integer greater than or equal to 1.'
					: 'paginate() accepts either page or skip, but not both.',
			operation: 'paginate',
		});
	return {
		take,
		query: {
			...args,
			take,
			skip: page === undefined ? (args.skip ?? 0) : (page - 1) * take,
		},
	};
};

const reverseOrderBy = <Schema extends AnySchema>(
	orderBy?: OrderByInput<Schema, BetterTableKey<Schema>>,
) => {
	if (!orderBy) return;

	const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
	const reversed = [];

	for (const entry of entries) {
		const reversedEntry = Object.create(null) as Record<string, unknown>;

		for (const key in entry as Record<string, unknown>) {
			const value = (entry as Record<string, unknown>)[key];
			const direction = orderDirection(value);
			const nulls = orderNulls(value);
			const reversedDirection = direction === 'asc' ? 'desc' : 'asc';

			reversedEntry[key] = nulls
				? {
						direction: reversedDirection,
						nulls: nulls === 'first' ? 'last' : 'first',
					}
				: reversedDirection;
		}

		reversed.push(reversedEntry);
	}

	return Array.isArray(orderBy)
		? (reversed as OrderByInput<Schema, BetterTableKey<Schema>>)
		: reversed[0];
};

const inferCursorOrderBy = <Schema extends AnySchema>(
	cursor: Record<string, unknown> | undefined,
	direction: 'asc' | 'desc',
) => {
	if (!cursor) return;

	const inferred = [];

	for (const key in cursor)
		inferred.push(
			Object.assign(Object.create(null), {
				[key]: direction,
			}) as Record<string, 'asc' | 'desc'>,
		);

	return inferred.length
		? (inferred as OrderByInput<Schema, BetterTableKey<Schema>>)
		: undefined;
};

export const buildCursorPaginationQuery = <Schema extends AnySchema, Meta>(
	args: CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
	limit: number,
) => {
	if (args.before && args.after)
		return { error: 'AMBIGUOUS_CURSOR' as const };

	if (args.before && typeof args.before !== 'object')
		return { error: 'INVALID_BEFORE_CURSOR' as const };
	if (args.after && typeof args.after !== 'object')
		return { error: 'INVALID_AFTER_CURSOR' as const };

	const inferredBeforeOrderBy =
		args.orderBy ??
		inferCursorOrderBy<Schema>(
			args.before as Record<string, unknown> | undefined,
			'asc',
		);
	const inferredAfterOrderBy =
		args.orderBy ??
		inferCursorOrderBy<Schema>(
			args.after as Record<string, unknown> | undefined,
			'asc',
		);

	if (args.before)
		return {
			direction: 'before' as const,
			query: {
				...args,
				after: undefined,
				before: undefined,
				cursor: args.before as CursorInput<
					Schema,
					BetterTableKey<Schema>
				>,
				orderBy: reverseOrderBy(inferredBeforeOrderBy),
				take: limit,
			},
		};

	return {
		direction: 'forward' as const,
		query: {
			...args,
			after: undefined,
			before: undefined,
			cursor: args.after as
				| CursorInput<Schema, BetterTableKey<Schema>>
				| undefined,
			orderBy: inferredAfterOrderBy,
			take: limit,
		},
	};
};
