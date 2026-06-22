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
import { Many, normalizeRelation, One } from 'drizzle-orm/relations';
import type {
	AnySchema,
	BetterTableKey,
	CompilableWhere,
	CursorInput,
	DrizzleLikeDatabase,
	OrderByInput,
	PaginationArgs,
	PaginationType,
	QueryArgs,
	RuntimeContext,
	WhereArg,
	WhereCompilerContext,
} from '../../types';
import { PaginationType as PaginationKind } from '../../types';
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

	const relation = context.tableConfig.relations[relationName];
	if (!relation) return;

	const normalized = normalizeRelation(
		context.relational.tables,
		context.relational.tableNamesMap,
		relation,
	);
	const relationTableKey =
		context.relational.tableNamesMap[
			`${relation.referencedTable._.schema ?? 'public'}.${relation.referencedTable._.name}`
		] ?? relation.referencedTable._.name;
	const relationRuntime = getTableRuntime(context, relationTableKey);
	const joinCondition = makeJoinCondition(
		normalized.fields,
		normalized.references,
		relationRuntime.table,
	);
	const subquery = context.db
		.select({ one: sql`1` })
		.from(relationRuntime.table);
	const buildNestedWhere = (nestedWhere?: Record<string, unknown>) =>
		compileWhereInput(
			{
				...context,
				tableName: relationTableKey,
				table: relationRuntime.table,
				tableConfig: relationRuntime.tableConfig,
			},
			nestedWhere,
		);

	if (relation instanceof Many) {
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

	if (relation instanceof One) {
		if ('is' in value) {
			if (value.is === null)
				return notExists(subquery.where(joinCondition));

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

export const compileWhereInput = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	where?: CompilableWhere,
): SQL | undefined => {
	if (!where) return;
	if (isSQLWrapper(where)) return where.getSQL();

	const tableColumns = getTableColumns(context.table);
	const conditions: SQL[] = [];

	for (const [key, value] of Object.entries(where)) {
		if (key === 'AND' && Array.isArray(value)) {
			const nested = value
				.map((entry) =>
					compileWhereInput(
						context,
						entry as Record<string, unknown>,
					),
				)
				.filter((entry): entry is SQL => Boolean(entry));
			const clause = and(...nested);
			if (clause) conditions.push(clause);
			continue;
		}

		if (key === 'OR' && Array.isArray(value)) {
			const nested = value
				.map((entry) =>
					compileWhereInput(
						context,
						entry as Record<string, unknown>,
					),
				)
				.filter((entry): entry is SQL => Boolean(entry));
			const clause = or(...nested);
			if (clause) conditions.push(clause);
			continue;
		}

		if (key === 'NOT') {
			const entries = Array.isArray(value) ? value : [value];
			const nested = entries
				.map((entry) => {
					const clause = compileWhereInput(
						context,
						entry as Record<string, unknown>,
					);
					return clause ? not(clause) : undefined;
				})
				.filter((entry): entry is SQL => Boolean(entry));
			const clause = and(...nested);
			if (clause) conditions.push(clause);
			continue;
		}

		if (key in context.tableConfig.relations) {
			const relationFilter = compileRelationFilter(context, key, value);
			if (relationFilter) conditions.push(relationFilter);
			continue;
		}

		const column = tableColumns[key];
		if (!column) continue;

		const scalarFilter = compileScalarFilter(column, value);
		if (scalarFilter) conditions.push(scalarFilter);
	}

	return conditions.length ? and(...conditions) : undefined;
};

export const compileOrderBy = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	orderBy?: OrderByInput<Schema, BetterTableKey<Schema>>,
) => {
	if (!orderBy) return;

	const tableColumns = getTableColumns(context.table);
	const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
	const clauses: SQL[] = [];

	for (const entry of entries)
		for (const [key, direction] of Object.entries(
			entry as Record<string, unknown>,
		)) {
			const column = tableColumns[key];
			if (!column) continue;
			clauses.push(direction === 'desc' ? desc(column) : asc(column));
		}

	return clauses.length ? clauses : undefined;
};

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

	const tableColumns = getTableColumns(context.table);
	const column = tableColumns[cursorField];
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

export const buildQueryConfig = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const whereContext: WhereCompilerContext<Schema, Meta> = {
		...context,
		tableName: tableName as string,
		table: runtime.table,
		tableConfig: runtime.tableConfig,
		rootArgs: args,
	};
	const config: Record<string, unknown> = {};
	const select = args?.select as Record<string, unknown> | undefined;
	const include = args?.include as Record<string, unknown> | undefined;

	if (select) {
		const columns: Record<string, true> = {};

		for (const [key, value] of Object.entries(select))
			if (!(key in runtime.tableConfig.relations) && value === true)
				columns[key] = true;

		if (Object.keys(columns).length) config.columns = columns;
	}

	const sourceRelations = select ?? include;
	if (sourceRelations) {
		const withConfig: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(sourceRelations)) {
			if (!(key in runtime.tableConfig.relations)) continue;

			withConfig[key] =
				value === true
					? true
					: buildQueryConfig(
							context,
							runtime.tableConfig.relations[key]
								.referencedTableName as BetterTableKey<Schema>,
							value as QueryArgs<
								Schema,
								BetterTableKey<Schema>,
								Meta
							>,
						);
		}

		if (Object.keys(withConfig).length) config.with = withConfig;
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

	if (mergedWhere) config.where = () => mergedWhere;

	const orderBy = compileOrderBy(
		whereContext,
		args?.orderBy as
			| OrderByInput<Schema, BetterTableKey<Schema>>
			| undefined,
	);
	if (orderBy) config.orderBy = () => orderBy;

	if (args?.take !== undefined) config.limit = Math.abs(args.take);
	if (args?.skip !== undefined) config.offset = args.skip;

	return config;
};

export const countRows = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	where?: WhereArg<Schema, BetterTableKey<Schema>>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const predicate = compileWhereInput(
		{
			...context,
			tableName: tableName as string,
			table: runtime.table,
			tableConfig: runtime.tableConfig,
		},
		where as CompilableWhere | undefined,
	);

	if (typeof context.db.$count === 'function')
		return context.db.$count(runtime.table, predicate);

	const result = await context.db
		.select({ count: count() })
		.from(runtime.table)
		.where(predicate);

	return Number(result[0]?.count ?? 0);
};

export const buildPaginationQuery = <Schema extends AnySchema, Meta>(
	args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const limit = args.limit ?? args.take ?? 10;
	const take = args.take ?? limit;
	const cursorArgs = args as PaginationArgs<
		Schema,
		BetterTableKey<Schema>,
		Meta
	> & {
		after?: unknown;
		before?: unknown;
		type?: PaginationType;
	};

	if (cursorArgs.type !== PaginationKind.Cursor)
		return {
			take,
			query: {
				...cursorArgs,
				take,
				skip: cursorArgs.skip ?? 0,
			},
		};

	if (cursorArgs.before && typeof cursorArgs.before === 'object')
		return {
			take,
			query: {
				...cursorArgs,
				cursor: cursorArgs.before as CursorInput<
					Schema,
					BetterTableKey<Schema>
				>,
				take: -Math.abs(take),
			},
		};

	if (cursorArgs.after && typeof cursorArgs.after === 'object')
		return {
			take,
			query: {
				...cursorArgs,
				cursor: cursorArgs.after as CursorInput<
					Schema,
					BetterTableKey<Schema>
				>,
				take,
			},
		};

	return { take, query: { ...cursorArgs, take } };
};
