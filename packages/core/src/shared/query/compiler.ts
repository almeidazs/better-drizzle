import type { AnyColumn, SQL } from 'drizzle-orm';
import {
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

const compileSimpleWhere = (
	runtime: TableRuntime,
	where: Record<string, unknown>,
): SQL | undefined => {
	const conditions: SQL[] = [];

	for (const key in where) {
		const value = where[key];
		if (value === undefined || runtime.relationNames.has(key)) return;

		const column = runtime.columns[key];
		if (!column || isScalarFilter(value) || isPlainObject(value)) return;

		conditions.push(value === null ? isNull(column) : eq(column, value));
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

const makeJoinCondition = (
	fields: AnyColumn[],
	references: AnyColumn[],
	referencedTable: Parameters<DrizzleLikeDatabase['insert']>[0],
) => {
	const referencedColumns = getTableColumns(referencedTable);
	const conditions: SQL[] = [];

	for (let index = 0; index < references.length; index += 1) {
		const sourceField = fields[index];
		const reference = references[index];
		if (!sourceField || !reference) continue;

		const referencedColumn = referencedColumns[reference.name];
		if (referencedColumn)
			conditions.push(eq(referencedColumn, sourceField));
	}

	return and(...conditions);
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
	const joinCondition = makeJoinCondition(
		relationState.fields,
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
			},
			nestedWhere,
		);
	const canUseMembershipFilter =
		relationState.fields.length === 1 &&
		relationState.references.length === 1;
	const sourceField = relationState.fields[0];
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
	if (isSQLWrapper(where)) return where.getSQL();
	if (!isPlainObject(where)) return;
	if (!('AND' in where || 'OR' in where || 'NOT' in where)) {
		const simple = compileSimpleWhere(context.runtime, where);

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

		const scalarFilter = compileScalarFilter(column, value);
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
			const direction = (entry as Record<string, unknown>)[key];
			const column = context.runtime.columns[key];

			if (!column) continue;

			clauses.push(direction === 'desc' ? desc(column) : asc(column));
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
		direction = (orderEntry as Record<string, 'asc' | 'desc'>)[cursorField];

	return direction === 'desc'
		? lt(column, cursorValue)
		: gt(column, cursorValue);
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

	const result = await context.db
		.select({ count: count() })
		.from(runtime.table)
		.where(mergedPredicate);

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
		const reversedEntry = Object.create(null) as Record<
			string,
			'asc' | 'desc'
		>;

		for (const key in entry as Record<string, unknown>) {
			const direction = (entry as Record<string, unknown>)[key];
			if (direction !== 'asc' && direction !== 'desc') continue;
			reversedEntry[key] = direction === 'asc' ? 'desc' : 'asc';
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
			'desc',
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
