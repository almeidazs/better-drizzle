import type { AnyColumn, SQL } from 'drizzle-orm';
import {
	aliasedTableColumn,
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	getTableColumns,
	gt,
	gte,
	ilike,
	inArray,
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
	sql,
} from 'drizzle-orm';
import { mapColumnsInSQLToAlias } from 'drizzle-orm/alias';
import { Many, One } from 'drizzle-orm/relations';

import type {
	AnySchema,
	BetterTableKey,
	CompilableWhere,
	CursorArgs,
	CursorInput,
	DrizzleLikeDatabase,
	OrderByInput,
	PaginationArgs,
	QueryArgs,
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
	!(value instanceof Date);

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

const compilePattern = (
	column: AnyColumn,
	value: string,
	mode: 'contains' | 'startsWith' | 'endsWith',
	insensitive?: boolean,
) => {
	const pattern =
		mode === 'contains'
			? `%${value}%`
			: mode === 'startsWith'
				? `${value}%`
				: `%${value}`;

	return insensitive ? ilike(column, pattern) : like(column, pattern);
};

const compileScalarFilter = (
	column: AnyColumn,
	value: unknown,
): SQL | undefined => {
	if (value === undefined) return;
	if (value === null) return isNull(column);
	if (!isScalarFilter(value)) return eq(column, value);

	const filter = value;
	const conditions: SQL[] = [];

	if ('equals' in filter)
		conditions.push(
			filter.equals === null ? isNull(column) : eq(column, filter.equals),
		);

	if (Array.isArray(filter.in)) conditions.push(inArray(column, filter.in));
	if (Array.isArray(filter.notIn))
		conditions.push(notInArray(column, filter.notIn));
	if (filter.lt !== undefined) conditions.push(lt(column, filter.lt));
	if (filter.lte !== undefined) conditions.push(lte(column, filter.lte));
	if (filter.gt !== undefined) conditions.push(gt(column, filter.gt));
	if (filter.gte !== undefined) conditions.push(gte(column, filter.gte));

	const insensitive = filter.mode === 'insensitive';

	if (typeof filter.contains === 'string')
		conditions.push(
			compilePattern(column, filter.contains, 'contains', insensitive),
		);

	if (typeof filter.startsWith === 'string')
		conditions.push(
			compilePattern(
				column,
				filter.startsWith,
				'startsWith',
				insensitive,
			),
		);

	if (typeof filter.endsWith === 'string')
		conditions.push(
			compilePattern(column, filter.endsWith, 'endsWith', insensitive),
		);

	if ('not' in filter) {
		const nested = compileScalarFilter(column, filter.not);
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

const isPgJsonbColumn = (column: AnyColumn) =>
	(column as { columnType?: string }).columnType === 'PgJsonb';

const isPgArrayColumn = (column: AnyColumn) =>
	(column as { columnType?: string }).columnType === 'PgArray';

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
		code: BetterDrizzleErrorCode.OperationError,
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
			if (!Array.isArray(entry) || entry.some((item) => item == null))
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.OperationError,
					message: `Array ${quantifier} predicate cannot compare against a NULL array element.`,
				});
			predicates += 1;
			continue;
		}
		if (key === 'contains' || key === 'startsWith' || key === 'endsWith') {
			if (typeof entry !== 'string')
				throw arrayElementPredicateError(quantifier);
			predicates += 1;
			continue;
		}
		if (key === 'not') {
			if (entry == null)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.OperationError,
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
					code: BetterDrizzleErrorCode.OperationError,
					message: `Array ${quantifier} predicate cannot compare against a NULL array element.`,
				});
			predicates += 1;
		}
	}
	if (!predicates) throw arrayElementPredicateError(quantifier);
	return filter;
};

const compileArrayElementScalarFilter = (
	column: AnyColumn,
	encoder: AnyColumn,
	value: Record<string, unknown>,
): SQL | undefined => {
	const conditions: SQL[] = [];
	const bind = (entry: unknown) => sql.param(entry, encoder);
	const pattern = (
		entry: string,
		mode: 'contains' | 'startsWith' | 'endsWith',
		insensitive: boolean,
	) => {
		const value =
			mode === 'contains'
				? `%${entry}%`
				: mode === 'startsWith'
					? `${entry}%`
					: `%${entry}`;
		return insensitive
			? sql`${column} ilike ${bind(value)}`
			: sql`${column} like ${bind(value)}`;
	};

	if ('equals' in value)
		conditions.push(sql`${column} = ${bind(value.equals)}`);
	if (Array.isArray(value.in))
		conditions.push(
			value.in.length
				? sql`${column} in (${sql.join(value.in.map(bind), sql`, `)})`
				: sql`false`,
		);
	if (Array.isArray(value.notIn))
		conditions.push(
			value.notIn.length
				? sql`${column} not in (${sql.join(value.notIn.map(bind), sql`, `)})`
				: sql`true`,
		);
	if (value.lt !== undefined)
		conditions.push(sql`${column} < ${bind(value.lt)}`);
	if (value.lte !== undefined)
		conditions.push(sql`${column} <= ${bind(value.lte)}`);
	if (value.gt !== undefined)
		conditions.push(sql`${column} > ${bind(value.gt)}`);
	if (value.gte !== undefined)
		conditions.push(sql`${column} >= ${bind(value.gte)}`);

	const insensitive = value.mode === 'insensitive';
	if (typeof value.contains === 'string')
		conditions.push(pattern(value.contains, 'contains', insensitive));
	if (typeof value.startsWith === 'string')
		conditions.push(pattern(value.startsWith, 'startsWith', insensitive));
	if (typeof value.endsWith === 'string')
		conditions.push(pattern(value.endsWith, 'endsWith', insensitive));
	if ('not' in value) {
		const nested = isScalarFilter(value.not)
			? compileArrayElementScalarFilter(column, encoder, value.not)
			: sql`${column} = ${bind(value.not)}`;
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
	let elementEncoder = encoder;
	while ((elementEncoder as { columnType?: string }).columnType === 'PgArray')
		elementEncoder = (
			elementEncoder as unknown as { baseColumn: AnyColumn }
		).baseColumn;

	if (
		only === 'equals' &&
		filter.equals !== null &&
		filter.equals !== undefined
	) {
		const match = sql`${column} @> ${sql.param([filter.equals], encoder)}`;
		if (quantifier === 'some') return match;
		if (quantifier === 'every')
			return sql`${notNull} and ${column} <@ ${sql.param([filter.equals], encoder)}`;
		return sql`${notNull} and not (${match})`;
	}

	if (only === 'in' && Array.isArray(filter.in)) {
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
			value.equals === null ? isNull(column) : eq(column, value.equals),
		);
	if (value.has !== undefined && value.has !== null)
		conditions.push(sql`${column} @> ${sql.param([value.has], encoder)}`);
	if (Array.isArray(value.hasEvery))
		conditions.push(
			sql`${column} @> ${sql.param(value.hasEvery, encoder)}`,
		);
	if (Array.isArray(value.hasSome))
		conditions.push(sql`${column} && ${sql.param(value.hasSome, encoder)}`);
	if (Array.isArray(value.hasNone))
		conditions.push(
			sql`not (${column} && ${sql.param(value.hasNone, encoder)})`,
		);
	if (Array.isArray(value.containedBy))
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
	if (typeof value.length === 'number')
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
			conditions.push(not(eq(column, value.not)));
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
	const compare = (entry: unknown): SQL | undefined => {
		if (entry === null) return eq(jsonType, 'null');
		if (typeof entry === 'string')
			return and(eq(jsonType, 'string'), eq(textValue, entry));
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
				and(eq(jsonType, 'string'), inArray(textValue, strings)) as SQL,
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
	if (!isScalarFilter(value)) return compare(value);
	const conditions: SQL[] = [];
	if ('equals' in value) {
		const condition = compare(value.equals);
		if (condition) conditions.push(condition);
	}
	if (Array.isArray(value.in)) conditions.push(compareAny(value.in));
	if (Array.isArray(value.notIn) && value.notIn.length)
		conditions.push(not(compareAny(value.notIn)));
	if (typeof value.lt === 'number')
		conditions.push(
			and(eq(jsonType, 'number'), lt(numeric, value.lt)) as SQL,
		);
	if (typeof value.lte === 'number')
		conditions.push(
			and(eq(jsonType, 'number'), lte(numeric, value.lte)) as SQL,
		);
	if (typeof value.gt === 'number')
		conditions.push(
			and(eq(jsonType, 'number'), gt(numeric, value.gt)) as SQL,
		);
	if (typeof value.gte === 'number')
		conditions.push(
			and(eq(jsonType, 'number'), gte(numeric, value.gte)) as SQL,
		);
	const pattern = value.mode === 'insensitive' ? ilike : like;
	if (typeof value.contains === 'string')
		conditions.push(
			and(
				eq(jsonType, 'string'),
				pattern(
					textValue as unknown as AnyColumn,
					`%${value.contains}%`,
				),
			) as SQL,
		);
	if (typeof value.startsWith === 'string')
		conditions.push(
			and(
				eq(jsonType, 'string'),
				pattern(
					textValue as unknown as AnyColumn,
					`${value.startsWith}%`,
				),
			) as SQL,
		);
	if (typeof value.endsWith === 'string')
		conditions.push(
			and(
				eq(jsonType, 'string'),
				pattern(
					textValue as unknown as AnyColumn,
					`%${value.endsWith}`,
				),
			) as SQL,
		);
	if ('not' in value) {
		const nested = compileJsonPathFilter(column, path, value.not);
		if (nested) conditions.push(not(nested));
	}
	return conditions.length ? and(...conditions) : undefined;
};

const makeJoinCondition = (
	fields: AnyColumn[],
	references: AnyColumn[],
	referencedTable: Parameters<DrizzleLikeDatabase['insert']>[0],
) => {
	const referencedColumns = getTableColumns(referencedTable);
	// getTableColumns() keys columns by their JS property name, while
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
	const joinCondition = makeJoinCondition(
		fields,
		relationState.references,
		relationRuntime.table,
	);
	const subquery = context.db
		.select({ one: sql`1` })
		.from(relationRuntime.table);
	const buildNestedWhere = (nestedWhere?: Record<string, unknown>) =>
		compileWhereInput(
			{
				...context,
				runtime: relationRuntime,
				tableName: relationState.tableName,
				// The subquery's own table is referenced by its real name, and a
				// deeper filter correlates against it, not the aliased root.
				rootAlias: undefined,
			},
			nestedWhere,
		);
	const canUseMembershipFilter =
		relationState.fields.length === 1 &&
		relationState.references.length === 1;
	const sourceField = fields[0];
	const referenceField = relationState.references[0];
	const buildMembershipFilter = (
		nestedWhere: Record<string, unknown>,
		negated = false,
	) => {
		if (!canUseMembershipFilter || !sourceField || !referenceField) return;

		const predicate = buildNestedWhere(nestedWhere);
		const subquery = context.db
			.select({ value: referenceField })
			.from(relationRuntime.table);

		return negated
			? notInArray(
					sourceField,
					predicate ? subquery.where(predicate) : subquery,
				)
			: inArray(
					sourceField,
					predicate ? subquery.where(predicate) : subquery,
				);
	};

	if (relationState.relation instanceof Many) {
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

	if (relationState.relation instanceof One) {
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
		if (!column) continue;

		const field = context.rootAlias
			? aliasedTableColumn(column, context.rootAlias)
			: column;

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

		const scalarFilter = compileScalarFilter(field, value);
		if (scalarFilter) conditions.push(scalarFilter);
	}

	return conditions.length ? and(...conditions) : undefined;
};

/**
 * Compiles an `OrderByInput` into an array of Drizzle SQL order-by clauses.
 * Supports single or multi-column ordering with ascending/descending direction.
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

			if (!column) continue;

			const direction = orderDirection(value);
			const nulls = orderNulls(value);
			if (!nulls) {
				clauses.push(direction === 'desc' ? desc(column) : asc(column));
				continue;
			}

			if (context.dialect === 'mysql') {
				if (
					(nulls === 'first' && direction === 'asc') ||
					(nulls === 'last' && direction === 'desc')
				) {
					clauses.push(
						direction === 'desc' ? desc(column) : asc(column),
					);
					continue;
				}

				clauses.push(
					nulls === 'first'
						? desc(isNull(column))
						: asc(isNull(column)),
				);
				clauses.push(direction === 'desc' ? desc(column) : asc(column));
				continue;
			}

			clauses.push(
				sql`${column} ${sql.raw(direction)} nulls ${sql.raw(nulls)}`,
			);
		}

	return clauses.length ? clauses : undefined;
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
	cursor?: CursorInput<Schema, BetterTableKey<Schema>>,
	orderBy?: OrderByInput<Schema, BetterTableKey<Schema>>,
	take?: number,
) => {
	if (!cursor) return;

	const cursorEntries = Object.entries(cursor as Record<string, unknown>);
	const [cursorField, cursorValue] = cursorEntries[0] ?? [];

	if (!cursorField) return;

	const column = context.runtime.columns[cursorField];

	if (!column) return;

	let direction: 'asc' | 'desc' =
		take !== undefined && take < 0 ? 'desc' : 'asc';

	const orderEntry = Array.isArray(orderBy) ? orderBy[0] : orderBy;

	if (orderEntry && cursorField in orderEntry)
		direction = orderDirection(
			(orderEntry as Record<string, unknown>)[cursorField],
		);

	const nulls = orderEntry
		? orderNulls((orderEntry as Record<string, unknown>)[cursorField])
		: undefined;
	const comparison =
		direction === 'desc'
			? lt(column, cursorValue)
			: gt(column, cursorValue);
	if (!nulls) return comparison;
	if (cursorValue === null)
		return nulls === 'first' ? isNotNull(column) : sql`false`;
	return nulls === 'last' ? or(comparison, isNull(column)) : comparison;
};

/**
 * Builds a Drizzle relational query config object from typed `QueryArgs`.
 * Compiles where-clauses, order-by, cursor, pagination, select/include
 * projections, and nested relation configs into the shape expected by
 * `db.query[tableName].findMany()` / `findFirst()`.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to build the config for.
 * @param args      - The query arguments.
 * @returns A Drizzle query config object, or `undefined` when no config is needed.
 */
export const buildQueryConfig = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const whereContext: WhereCompilerContext<Schema, Meta> = {
		...context,
		runtime,
		tableName: tableName as string,
		rootArgs: args,
		// The relational query builder aliases this table to its schema key, which
		// is the same key used for db.query[tableName]. A correlated relation
		// filter reads this to reference the parent through that alias.
		rootAlias: tableName as string,
	};
	const config = Object.create(null) as Record<string, unknown>;
	const select = args?.select as Record<string, unknown> | undefined;
	const include = args?.include as Record<string, unknown> | undefined;
	let hasConfig = false;

	if (select) {
		const columns = Object.create(null) as Record<string, true>;
		let hasColumns = false;

		for (const key in select)
			if (!runtime.relationNames.has(key) && select[key] === true) {
				columns[key] = true;
				hasColumns = true;
			}

		if (hasColumns) {
			config.columns = columns;
			hasConfig = true;
		}
	}

	const sourceRelations = select ?? include;
	if (sourceRelations) {
		const withConfig = Object.create(null) as Record<string, unknown>;
		let hasWith = false;

		for (const key in sourceRelations) {
			const value = sourceRelations[key];
			if (!runtime.relationNames.has(key)) continue;

			withConfig[key] =
				value === true
					? true
					: buildQueryConfig(
							context,
							runtime.relations[key]
								.tableName as BetterTableKey<Schema>,
							value as QueryArgs<
								Schema,
								BetterTableKey<Schema>,
								Meta
							>,
						);
			hasWith = true;
		}

		if (hasWith) {
			config.with = withConfig;
			hasConfig = true;
		}
	}

	const where = compileWhereInput(
		whereContext,
		args?.where as CompilableWhere | undefined,
	);
	const cursorWhere = compileCursorWhere(
		whereContext,
		args?.cursor as CursorInput<Schema, BetterTableKey<Schema>> | undefined,
		args?.orderBy as
			| OrderByInput<Schema, BetterTableKey<Schema>>
			| undefined,
		args?.take,
	);
	const mergedWhere = and(where, cursorWhere);

	if (mergedWhere) {
		config.where = () => mergedWhere;
		hasConfig = true;
	}

	const orderBy = compileOrderBy(
		whereContext,
		args?.orderBy as
			| OrderByInput<Schema, BetterTableKey<Schema>>
			| undefined,
	);
	if (orderBy) {
		config.orderBy = () => orderBy;
		hasConfig = true;
	}

	if (args?.take !== undefined) {
		config.limit = Math.abs(args.take);
		hasConfig = true;
	}
	if (args?.skip !== undefined) {
		config.offset = args.skip;
		hasConfig = true;
	}

	return hasConfig ? config : undefined;
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
	cursor?: CursorInput<Schema, BetterTableKey<Schema>>,
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
	cursor?: CursorInput<Schema, BetterTableKey<Schema>>,
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
	const limit = args.limit ?? args.take ?? 10;
	const take = args.take ?? limit;
	return {
		take,
		query: {
			...args,
			take,
			skip: args.skip ?? 0,
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
