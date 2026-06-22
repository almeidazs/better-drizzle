import type { AnyColumn, SQL, Table } from 'drizzle-orm';
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
	isTable,
	like,
	lt,
	lte,
	not,
	notExists,
	notInArray,
	or,
	sql,
} from 'drizzle-orm';
import {
	createTableRelationsHelpers,
	extractTablesRelationalConfig,
	Many,
	normalizeRelation,
	One,
} from 'drizzle-orm/relations';
import type {
	AfterCreateHookContext,
	AfterDeleteHookContext,
	AfterQueryHookContext,
	AfterUpdateHookContext,
	AnySchema,
	BatchResult,
	BeforeCreateHookContext,
	BeforeDeleteHookContext,
	BeforeQueryHookContext,
	BeforeUpdateHookContext,
	BetterClientHooks,
	BetterClientOptions,
	BetterDrizzleClient,
	BetterMeta,
	BetterRelationalConfig,
	BetterTableKey,
	CountArgs,
	CreateArgs,
	CreateManyArgs,
	CursorInput,
	DeleteArgs,
	DeleteManyArgs,
	ErrorHookContext,
	ExistsArgs,
	OrderByInput,
	PaginationArgs,
	QueryArgs,
	ThrowFactory,
	ThrowingResult,
	UpdateArgs,
	UpdateManyArgs,
	UpsertArgs,
	WhereArg,
} from '../types/client';
import { PaginationType } from '../types/database';

type DrizzleQueryDelegate = {
	findMany(config?: unknown): Promise<unknown[]>;
};

type InsertBuilderLike = {
	returning?: () => Promise<Record<string, unknown>[]>;
};

type SelectQueryLike = SQL &
	Promise<Record<string, unknown>[]> & {
		where(where?: unknown): SelectQueryLike;
	};

type DrizzleLikeDatabase = {
	query: Record<string, DrizzleQueryDelegate>;
	insert(table: Table): {
		values(data: unknown): Promise<unknown> & InsertBuilderLike;
	};
	update(table: Table): {
		set(data: unknown): {
			where(where: unknown): Promise<unknown>;
		};
	};
	delete(table: Table): {
		where(where: unknown): Promise<unknown>;
	};
	select(selection?: Record<string, unknown>): {
		from(table: Table): SelectQueryLike;
	};
	$count?(table: Table, filters?: unknown): Promise<number>;
};

type RuntimeSchema = ReturnType<
	typeof extractTablesRelationalConfig<Record<string, BetterRelationalConfig>>
>;

type RuntimeContext<Schema extends AnySchema, Meta = BetterMeta> = {
	db: DrizzleLikeDatabase;
	options: BetterClientOptions<Schema, Meta>;
	fullSchema: Schema;
	relational: RuntimeSchema;
	repositories: Record<string, unknown>;
};

type WhereCompilerContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> = RuntimeContext<Schema, Meta> & {
	tableName: string;
	table: Table;
	tableConfig: BetterRelationalConfig;
	rootArgs?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>;
};

type CompilableWhere = Record<string, unknown> | SQL;
type NullableResult<T> = Promise<T | null>;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		!(value instanceof Date)
	);
};

const isScalarOperatorObject = (value: unknown) => {
	if (!isPlainObject(value)) {
		return false;
	}

	const scalarOperators = new Set([
		'equals',
		'in',
		'notIn',
		'lt',
		'lte',
		'gt',
		'gte',
		'contains',
		'startsWith',
		'endsWith',
		'mode',
		'not',
	]);

	return Object.keys(value).some((key) => scalarOperators.has(key));
};

const buildLikeValue = (
	value: string,
	mode: 'contains' | 'startsWith' | 'endsWith',
) => {
	switch (mode) {
		case 'contains':
			return `%${value}%`;
		case 'startsWith':
			return `${value}%`;
		case 'endsWith':
			return `%${value}`;
	}
};

const buildPatternCondition = (
	column: AnyColumn,
	value: string,
	mode: 'contains' | 'startsWith' | 'endsWith',
	insensitive?: boolean,
) => {
	const pattern = buildLikeValue(value, mode);
	return insensitive ? ilike(column, pattern) : like(column, pattern);
};

const HOOK_ERROR_REPORTED = Symbol('better-drizzle-hook-error-reported');

const markErrorReported = (error: unknown) => {
	if (typeof error === 'object' && error !== null) {
		Reflect.set(error, HOOK_ERROR_REPORTED, true);
	}
};

const wasErrorReported = (error: unknown) =>
	typeof error === 'object' &&
	error !== null &&
	Boolean(Reflect.get(error, HOOK_ERROR_REPORTED));

const buildErrorContext = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	action: string,
	args: unknown,
	error: unknown,
	stage: ErrorHookContext<Schema, Meta>['stage'],
	hookName?: keyof BetterClientHooks<Schema, Meta>,
): ErrorHookContext<Schema, Meta> => {
	const runtime = getTableRuntime(context, tableName as string);
	return {
		action: action as ErrorHookContext<Schema, Meta>['action'],
		args,
		db: context.db,
		error,
		hookName,
		meta:
			typeof args === 'object' && args !== null && 'meta' in args
				? (args as { meta?: Meta }).meta
				: undefined,
		options: context.options,
		schema: context.fullSchema,
		stage,
		table: tableName,
		tableConfig: runtime.tableConfig,
		tableInstance: runtime.table,
	};
};

const reportError = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	action: string,
	args: unknown,
	error: unknown,
	stage: ErrorHookContext<Schema, Meta>['stage'],
	hookName?: keyof BetterClientHooks<Schema, Meta>,
) => {
	try {
		await context.options.hooks?.onError?.(
			buildErrorContext(
				context,
				tableName,
				action,
				args,
				error,
				stage,
				hookName,
			),
		);
	} catch {
		// Keep onError observational; never replace the original error.
	}
};

const createHookContext = <Schema extends AnySchema, Meta, Args>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	action: string,
	args: Args,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	return {
		action,
		args,
		db: context.db,
		meta:
			typeof args === 'object' && args !== null && 'meta' in args
				? (args as { meta?: Meta }).meta
				: undefined,
		options: context.options,
		repository: context.repositories[tableName as string],
		schema: context.fullSchema,
		table: tableName,
		tableConfig: runtime.tableConfig,
		tableInstance: runtime.table,
	};
};

const runHook = async <Schema extends AnySchema, Meta, Payload>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	action: string,
	args: unknown,
	hookName: keyof BetterClientHooks<Schema, Meta>,
	payload: Payload,
) => {
	const hook = context.options.hooks?.[hookName] as
		| ((payload: Payload) => unknown)
		| undefined;
	if (!hook) {
		return;
	}

	try {
		await hook(payload);
	} catch (error) {
		await reportError(
			context,
			tableName,
			action,
			args,
			error,
			hookName.startsWith('after') ? 'afterHook' : 'beforeHook',
			hookName,
		);
		markErrorReported(error);
		throw error;
	}
};

const executeOperation = async <Schema extends AnySchema, Meta, Args, Result>({
	action,
	args,
	afterHookName,
	afterPayload,
	beforeHookName,
	beforePayload,
	context,
	operation,
	tableName,
}: {
	action: string;
	args: Args;
	afterHookName?: keyof BetterClientHooks<Schema, Meta>;
	afterPayload?: (result: Result) => unknown;
	beforeHookName?: keyof BetterClientHooks<Schema, Meta>;
	beforePayload?: unknown;
	context: RuntimeContext<Schema, Meta>;
	operation: () => Promise<Result>;
	tableName: BetterTableKey<Schema>;
}) => {
	try {
		if (beforeHookName && beforePayload) {
			await runHook(
				context,
				tableName,
				action,
				args,
				beforeHookName,
				beforePayload,
			);
		}

		const result = await operation();

		if (afterHookName && afterPayload) {
			await runHook(
				context,
				tableName,
				action,
				args,
				afterHookName,
				afterPayload(result),
			);
		}

		return result;
	} catch (error) {
		if (!wasErrorReported(error)) {
			await reportError(
				context,
				tableName,
				action,
				args,
				error,
				'operation',
			);
		}
		throw error;
	}
};

const attachThrow = <Schema extends AnySchema, Meta, Args, T>(
	promise: NullableResult<T>,
	context: RuntimeContext<Schema, Meta>,
	action: string,
	args: Args,
	methodName: string,
	tableName: BetterTableKey<Schema>,
): ThrowingResult<T> => {
	const wrapped = promise as ThrowingResult<T>;
	wrapped.throw = async (factory?: ThrowFactory) => {
		const result = await promise;

		if (result === null) {
			const error =
				factory?.() ??
				new Error(
					`No record found for ${methodName} on "${String(tableName)}".`,
				);
			await reportError(
				context,
				tableName,
				action,
				args,
				error,
				'operation',
			);
			throw error;
		}

		return result as Exclude<T, null | undefined>;
	};

	return wrapped;
};

const getTableRuntime = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: string,
) => {
	const table = context.fullSchema[tableName];
	if (!isTable(table)) {
		throw new Error(`Schema key "${tableName}" is not a Drizzle table.`);
	}

	const tableConfig = context.relational.tables[tableName];
	if (!tableConfig) {
		throw new Error(`No relational config found for table "${tableName}".`);
	}

	return {
		table,
		tableConfig,
	};
};

const getPrimaryKeyFieldNames = (tableConfig: BetterRelationalConfig) => {
	return tableConfig.primaryKey.map((column) => column.name);
};

const getPrimaryKeyWhere = (
	tableConfig: BetterRelationalConfig,
	record: Record<string, unknown>,
) => {
	const primaryKeyFields = getPrimaryKeyFieldNames(tableConfig);
	return Object.fromEntries(
		primaryKeyFields
			.filter((field) => record[field] !== undefined)
			.map((field) => [field, record[field]]),
	);
};

const makeJoinCondition = (
	fields: AnyColumn[],
	references: AnyColumn[],
	referencedTable: Table,
) => {
	const referencedColumns = getTableColumns(referencedTable);
	const clauses = references.map((reference, index) => {
		const sourceField = fields[index];
		const referencedColumn = referencedColumns[reference.name];
		return eq(referencedColumn, sourceField);
	});

	return and(...clauses);
};

const compileScalarFilter = (
	column: AnyColumn,
	value: unknown,
): SQL | undefined => {
	if (value === undefined) {
		return undefined;
	}

	if (value === null) {
		return isNull(column);
	}

	if (!isScalarOperatorObject(value)) {
		return eq(column, value);
	}

	const filter = value as Record<string, unknown>;
	const conditions: (SQL | undefined)[] = [];

	if ('equals' in filter) {
		conditions.push(
			filter.equals === null ? isNull(column) : eq(column, filter.equals),
		);
	}

	if (Array.isArray(filter.in)) {
		conditions.push(inArray(column, filter.in));
	}

	if (Array.isArray(filter.notIn)) {
		conditions.push(notInArray(column, filter.notIn));
	}

	if (filter.lt !== undefined) {
		conditions.push(lt(column, filter.lt));
	}

	if (filter.lte !== undefined) {
		conditions.push(lte(column, filter.lte));
	}

	if (filter.gt !== undefined) {
		conditions.push(gt(column, filter.gt));
	}

	if (filter.gte !== undefined) {
		conditions.push(gte(column, filter.gte));
	}

	const insensitive = filter.mode === 'insensitive';

	if (typeof filter.contains === 'string') {
		conditions.push(
			buildPatternCondition(
				column,
				filter.contains,
				'contains',
				insensitive,
			),
		);
	}

	if (typeof filter.startsWith === 'string') {
		conditions.push(
			buildPatternCondition(
				column,
				filter.startsWith,
				'startsWith',
				insensitive,
			),
		);
	}

	if (typeof filter.endsWith === 'string') {
		conditions.push(
			buildPatternCondition(
				column,
				filter.endsWith,
				'endsWith',
				insensitive,
			),
		);
	}

	if ('not' in filter) {
		const nested = compileScalarFilter(column, filter.not);
		if (nested) {
			conditions.push(not(nested));
		}
	}

	return and(...conditions);
};

const compileRelationFilter = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	relationName: string,
	value: unknown,
) => {
	if (!isPlainObject(value)) {
		return undefined;
	}

	const relation = context.tableConfig.relations[relationName];
	if (!relation) {
		return undefined;
	}

	const normalized = normalizeRelation(
		context.relational.tables,
		context.relational.tableNamesMap,
		relation,
	);

	const referencedTableTsName =
		context.relational.tableNamesMap[
			`${relation.referencedTable._.schema ?? 'public'}.${relation.referencedTable._.name}`
		] ?? relation.referencedTable._.name;

	const referencedRuntime = getTableRuntime(context, referencedTableTsName);
	const joinCondition = makeJoinCondition(
		normalized.fields,
		normalized.references,
		referencedRuntime.table,
	);

	const subqueryBase = context.db
		.select({ one: sql`1` })
		.from(referencedRuntime.table);

	const buildNestedWhere = (nestedWhere?: Record<string, unknown>) => {
		const nestedContext: WhereCompilerContext<Schema, Meta> = {
			...context,
			tableName: referencedTableTsName,
			table: referencedRuntime.table,
			tableConfig: referencedRuntime.tableConfig,
		};

		return compileWhereInput(nestedContext, nestedWhere);
	};

	if (relation instanceof Many) {
		const manyFilter = value as Record<string, unknown>;

		if ('some' in manyFilter) {
			return exists(
				subqueryBase.where(
					and(
						joinCondition,
						buildNestedWhere(
							manyFilter.some as Record<string, unknown>,
						),
					),
				),
			);
		}

		if ('none' in manyFilter) {
			return notExists(
				subqueryBase.where(
					and(
						joinCondition,
						buildNestedWhere(
							manyFilter.none as Record<string, unknown>,
						),
					),
				),
			);
		}

		if ('every' in manyFilter) {
			const everyWhere = buildNestedWhere(
				manyFilter.every as Record<string, unknown>,
			);
			return notExists(
				subqueryBase.where(
					and(
						joinCondition,
						everyWhere ? not(everyWhere) : undefined,
					),
				),
			);
		}

		return undefined;
	}

	if (relation instanceof One) {
		const oneFilter = value as Record<string, unknown>;

		if ('is' in oneFilter) {
			if (oneFilter.is === null) {
				return notExists(subqueryBase.where(joinCondition));
			}

			return exists(
				subqueryBase.where(
					and(
						joinCondition,
						buildNestedWhere(
							oneFilter.is as Record<string, unknown>,
						),
					),
				),
			);
		}

		if ('isNot' in oneFilter) {
			if (oneFilter.isNot === null) {
				return exists(subqueryBase.where(joinCondition));
			}

			return notExists(
				subqueryBase.where(
					and(
						joinCondition,
						buildNestedWhere(
							oneFilter.isNot as Record<string, unknown>,
						),
					),
				),
			);
		}
	}

	return undefined;
};

const compileWhereInput = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	where?: CompilableWhere,
): SQL | undefined => {
	if (!where) return;

	if (isSQLWrapper(where)) return where.getSQL();

	const tableColumns = getTableColumns(context.table);
	const conditions: (SQL | undefined)[] = [];

	for (const [key, value] of Object.entries(where)) {
		if (key === 'AND' && Array.isArray(value)) {
			conditions.push(
				and(
					...value.map((entry) =>
						compileWhereInput(
							context,
							entry as Record<string, unknown>,
						),
					),
				),
			);
			continue;
		}

		if (key === 'OR' && Array.isArray(value)) {
			conditions.push(
				or(
					...value.map((entry) =>
						compileWhereInput(
							context,
							entry as Record<string, unknown>,
						),
					),
				),
			);
			continue;
		}

		if (key === 'NOT') {
			const entries = Array.isArray(value) ? value : [value];
			conditions.push(
				and(
					...entries.map((entry) => {
						const nested = compileWhereInput(
							context,
							entry as Record<string, unknown>,
						);
						return nested ? not(nested) : undefined;
					}),
				),
			);
			continue;
		}

		if (key in context.tableConfig.relations) {
			conditions.push(compileRelationFilter(context, key, value));
			continue;
		}

		const column = tableColumns[key];
		if (!column) {
			continue;
		}

		conditions.push(compileScalarFilter(column, value));
	}

	return and(...conditions);
};

const compileOrderBy = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	orderBy?: OrderByInput<Schema, BetterTableKey<Schema>>,
) => {
	if (!orderBy) {
		return undefined;
	}

	const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
	const tableColumns = getTableColumns(context.table);
	const clauses = entries.flatMap((entry) =>
		Object.entries(entry as Record<string, unknown>).flatMap(
			([key, direction]) => {
				const column = tableColumns[key];
				if (!column) {
					return [];
				}
				return [direction === 'desc' ? desc(column) : asc(column)];
			},
		),
	);

	return clauses.length > 0 ? clauses : undefined;
};

const compileCursorWhere = <Schema extends AnySchema, Meta>(
	context: WhereCompilerContext<Schema, Meta>,
	cursor?: CursorInput<Schema, BetterTableKey<Schema>>,
	orderBy?: OrderByInput<Schema, BetterTableKey<Schema>>,
	take?: number,
) => {
	if (!cursor || Object.keys(cursor).length === 0) {
		return undefined;
	}

	const tableColumns = getTableColumns(context.table);
	const cursorEntries = Object.entries(cursor as Record<string, unknown>);
	const [cursorField, cursorValue] = cursorEntries[0] ?? [];

	if (!cursorField) {
		return undefined;
	}

	const column = tableColumns[cursorField];
	if (!column) {
		return undefined;
	}

	let direction: 'asc' | 'desc' =
		take !== undefined && take < 0 ? 'desc' : 'asc';
	const orderEntries = Array.isArray(orderBy)
		? orderBy
		: orderBy
			? [orderBy]
			: [];
	const firstOrderEntry = orderEntries[0];
	if (firstOrderEntry && cursorField in firstOrderEntry) {
		direction = (firstOrderEntry as Record<string, 'asc' | 'desc'>)[
			cursorField
		];
	}

	return direction === 'desc'
		? lt(column, cursorValue)
		: gt(column, cursorValue);
};

const buildQueryConfig = <Schema extends AnySchema, Meta>(
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
	const relationNames = new Set(Object.keys(runtime.tableConfig.relations));

	if (select) {
		const columns = Object.fromEntries(
			Object.entries(select)
				.filter(
					([key, value]) => !relationNames.has(key) && value === true,
				)
				.map(([key]) => [key, true]),
		);
		if (Object.keys(columns).length > 0) {
			config.columns = columns;
		}
	}

	const withConfig = Object.fromEntries(
		Object.entries(select ?? include ?? {})
			.filter(([key]) => relationNames.has(key))
			.map(([key, value]) => {
				if (value === true) {
					return [key, true];
				}

				return [
					key,
					buildQueryConfig(
						context,
						runtime.tableConfig.relations[key]
							.referencedTableName as BetterTableKey<Schema>,
						value as QueryArgs<
							Schema,
							BetterTableKey<Schema>,
							Meta
						>,
					),
				];
			}),
	);

	if (Object.keys(withConfig).length > 0) {
		config.with = withConfig;
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
	}

	const orderBy = compileOrderBy(
		whereContext,
		args?.orderBy as
			| OrderByInput<Schema, BetterTableKey<Schema>>
			| undefined,
	);
	if (orderBy) {
		config.orderBy = () => orderBy;
	}

	if (args?.take !== undefined) {
		config.limit = Math.abs(args.take);
	}

	if (args?.skip !== undefined) {
		config.offset = args.skip;
	}

	return config;
};

const reloadByRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	record: Record<string, unknown>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const primaryKeyWhere = getPrimaryKeyWhere(runtime.tableConfig, record);
	const where =
		Object.keys(primaryKeyWhere).length > 0
			? primaryKeyWhere
			: Object.fromEntries(
					Object.entries(record).filter(
						([, value]) => value !== undefined,
					),
				);

	const queryConfig = buildQueryConfig(context, tableName, {
		...args,
		where: where as WhereArg<Schema, BetterTableKey<Schema>>,
		take: 1,
	});

	const rows = await context.db.query[tableName].findMany(queryConfig);
	return (rows[0] ?? null) as Record<string, unknown> | null;
};

const reloadByRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	records: Record<string, unknown>[],
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const rows = await Promise.all(
		records.map((record) =>
			reloadByRecord(context, tableName, record, args),
		),
	);

	return rows.filter((row): row is Record<string, unknown> => row !== null);
};

const findFirstInternal = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const rows = await context.db.query[tableName].findMany(
		buildQueryConfig(context, tableName, {
			...args,
			take: args?.take ?? 1,
		}),
	);
	return (rows[0] ?? null) as Record<string, unknown> | null;
};

const createInternal = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: { data: Record<string, unknown> } & QueryArgs<
		Schema,
		BetterTableKey<Schema>,
		Meta
	>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const builder = context.db.insert(runtime.table).values(args.data);

	let created: Record<string, unknown> | null = null;

	if (typeof builder.returning === 'function') {
		const rows = await builder.returning();
		created = rows[0] ?? null;
	} else {
		await builder;
	}

	return created
		? reloadByRecord(context, tableName, created, args)
		: reloadByRecord(context, tableName, args.data, args);
};

const createManyInternal = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CreateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<Record<string, unknown>>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const builder = context.db.insert(runtime.table).values(args.data);
	let data: Record<string, unknown>[] | undefined;

	if (typeof builder.returning === 'function') {
		const rows = await builder.returning();
		data = await reloadByRecords(context, tableName, rows, args);
	} else {
		await builder;
	}

	return {
		count: args.data.length,
		data: data && data.length > 0 ? data : undefined,
	};
};

const updateInternal = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpdateArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const existing = await findFirstInternal(context, tableName, {
		where: args.where,
	});
	if (!existing) {
		return null;
	}

	const pkWhere = getPrimaryKeyWhere(runtime.tableConfig, existing);
	const whereContext: WhereCompilerContext<Schema, Meta> = {
		...context,
		tableName: tableName as string,
		table: runtime.table,
		tableConfig: runtime.tableConfig,
	};
	const predicate = compileWhereInput(whereContext, pkWhere);

	await context.db.update(runtime.table).set(args.data).where(predicate);

	return reloadByRecord(context, tableName, existing, args);
};

const deleteInternal = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: DeleteArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const existing = await findFirstInternal(context, tableName, args);
	if (!existing) {
		return null;
	}

	const pkWhere = getPrimaryKeyWhere(runtime.tableConfig, existing);
	const whereContext: WhereCompilerContext<Schema, Meta> = {
		...context,
		tableName: tableName as string,
		table: runtime.table,
		tableConfig: runtime.tableConfig,
	};
	const predicate = compileWhereInput(whereContext, pkWhere);

	await context.db.delete(runtime.table).where(predicate);
	return existing;
};

const updateManyInternal = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpdateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<never>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const whereContext: WhereCompilerContext<Schema, Meta> = {
		...context,
		tableName: tableName as string,
		table: runtime.table,
		tableConfig: runtime.tableConfig,
	};
	const predicate = compileWhereInput(
		whereContext,
		args.where as CompilableWhere | undefined,
	);
	const affectedCount = await countInternal(context, tableName, args.where);

	if (affectedCount > 0) {
		await context.db.update(runtime.table).set(args.data).where(predicate);
	}

	return { count: affectedCount };
};

const deleteManyInternal = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: DeleteManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<never>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const whereContext: WhereCompilerContext<Schema, Meta> = {
		...context,
		tableName: tableName as string,
		table: runtime.table,
		tableConfig: runtime.tableConfig,
	};
	const predicate = compileWhereInput(
		whereContext,
		args?.where as CompilableWhere | undefined,
	);
	const affectedCount = await countInternal(context, tableName, args?.where);

	if (affectedCount > 0) {
		await context.db.delete(runtime.table).where(predicate);
	}

	return { count: affectedCount };
};

const countInternal = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	where?: WhereArg<Schema, BetterTableKey<Schema>>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const whereContext: WhereCompilerContext<Schema, Meta> = {
		...context,
		tableName: tableName as string,
		table: runtime.table,
		tableConfig: runtime.tableConfig,
	};
	const predicate = compileWhereInput(
		whereContext,
		where as CompilableWhere | undefined,
	);

	if (typeof context.db.$count === 'function') {
		return context.db.$count(runtime.table, predicate);
	}

	const result = await context.db
		.select({ count: count() })
		.from(runtime.table)
		.where(predicate);

	return Number(result[0]?.count ?? 0);
};

const paginateInternal = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const limit = args.limit ?? args.take ?? 10;
	const take = args.take ?? limit;

	let cursorArgs: QueryArgs<Schema, BetterTableKey<Schema>, Meta> = {
		...args,
		take,
	};

	if (args.type === PaginationType.Cursor) {
		if (args.after && typeof args.after === 'object') {
			cursorArgs = {
				...cursorArgs,
				cursor: args.after as CursorInput<
					Schema,
					BetterTableKey<Schema>
				>,
			};
		}
		if (args.before && typeof args.before === 'object') {
			cursorArgs = {
				...cursorArgs,
				cursor: args.before as CursorInput<
					Schema,
					BetterTableKey<Schema>
				>,
				take: -Math.abs(take),
			};
		}
	} else {
		cursorArgs = {
			...cursorArgs,
			skip: args.skip ?? 0,
		};
	}

	const [data, total] = await Promise.all([
		context.db.query[tableName].findMany(
			buildQueryConfig(context, tableName, cursorArgs),
		),
		countInternal(context, tableName, args.where),
	]);

	return {
		data,
		pagination: {
			count: total,
			hasNext: data.length >= take,
			hasPrevious:
				args.type === PaginationType.Cursor
					? Boolean(args.after || args.before)
					: Boolean((args.skip ?? 0) > 0),
		},
	};
};

const makeModelDelegate = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
) => {
	return {
		count: (args?: CountArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ?? ({} as CountArgs<Schema, BetterTableKey<Schema>, Meta>);
			return executeOperation({
				action: 'count',
				args: operationArgs,
				afterHookName: 'afterQuery',
				afterPayload: (result) =>
					({
						...createHookContext(
							context,
							tableName,
							'count',
							operationArgs,
						),
						result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: createHookContext(
					context,
					tableName,
					'count',
					operationArgs,
				) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: () =>
					countInternal(context, tableName, operationArgs.where),
				tableName,
			});
		},
		exists: (args?: ExistsArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ??
				({} as ExistsArgs<Schema, BetterTableKey<Schema>, Meta>);
			return executeOperation({
				action: 'exists',
				args: operationArgs,
				afterHookName: 'afterQuery',
				afterPayload: (result) =>
					({
						...createHookContext(
							context,
							tableName,
							'exists',
							operationArgs,
						),
						result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: createHookContext(
					context,
					tableName,
					'exists',
					operationArgs,
				) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: async () =>
					(await countInternal(
						context,
						tableName,
						operationArgs.where,
					)) > 0,
				tableName,
			});
		},
		createMany: (
			args: CreateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
		) =>
			executeOperation({
				action: 'createMany',
				args,
				afterHookName: 'afterCreate',
				afterPayload: (result) =>
					({
						...createHookContext(
							context,
							tableName,
							'createMany',
							args,
						),
						result,
					}) as AfterCreateHookContext<Schema, Meta>,
				beforeHookName: 'beforeCreate',
				beforePayload: createHookContext(
					context,
					tableName,
					'createMany',
					args,
				) as BeforeCreateHookContext<Schema, Meta>,
				context,
				operation: () => createManyInternal(context, tableName, args),
				tableName,
			}),
		findMany: (args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ?? ({} as QueryArgs<Schema, BetterTableKey<Schema>, Meta>);
			return executeOperation({
				action: 'findMany',
				args: operationArgs,
				afterHookName: 'afterQuery',
				afterPayload: (result) =>
					({
						...createHookContext(
							context,
							tableName,
							'findMany',
							operationArgs,
						),
						result,
						rows: result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: createHookContext(
					context,
					tableName,
					'findMany',
					operationArgs,
				) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: () =>
					context.db.query[tableName].findMany(
						buildQueryConfig(context, tableName, operationArgs),
					),
				tableName,
			});
		},
		findFirst: (args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ?? ({} as QueryArgs<Schema, BetterTableKey<Schema>, Meta>);
			return attachThrow(
				executeOperation({
					action: 'findFirst',
					args: operationArgs,
					afterHookName: 'afterQuery',
					afterPayload: (result) =>
						({
							...createHookContext(
								context,
								tableName,
								'findFirst',
								operationArgs,
							),
							result,
							row: result,
						}) as AfterQueryHookContext<Schema, Meta>,
					beforeHookName: 'beforeQuery',
					beforePayload: createHookContext(
						context,
						tableName,
						'findFirst',
						operationArgs,
					) as BeforeQueryHookContext<Schema, Meta>,
					context,
					operation: () =>
						findFirstInternal(context, tableName, operationArgs),
					tableName,
				}),
				context,
				'findFirst',
				operationArgs,
				'findFirst',
				tableName,
			);
		},
		findOne: (args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ?? ({} as QueryArgs<Schema, BetterTableKey<Schema>, Meta>);
			return attachThrow(
				executeOperation({
					action: 'findOne',
					args: operationArgs,
					afterHookName: 'afterQuery',
					afterPayload: (result) =>
						({
							...createHookContext(
								context,
								tableName,
								'findOne',
								operationArgs,
							),
							result,
							row: result,
						}) as AfterQueryHookContext<Schema, Meta>,
					beforeHookName: 'beforeQuery',
					beforePayload: createHookContext(
						context,
						tableName,
						'findOne',
						operationArgs,
					) as BeforeQueryHookContext<Schema, Meta>,
					context,
					operation: () =>
						findFirstInternal(context, tableName, operationArgs),
					tableName,
				}),
				context,
				'findOne',
				operationArgs,
				'findOne',
				tableName,
			);
		},
		findUnique: (args: QueryArgs<Schema, BetterTableKey<Schema>, Meta>) =>
			attachThrow(
				executeOperation({
					action: 'findUnique',
					args,
					afterHookName: 'afterQuery',
					afterPayload: (result) =>
						({
							...createHookContext(
								context,
								tableName,
								'findUnique',
								args,
							),
							result,
							row: result,
						}) as AfterQueryHookContext<Schema, Meta>,
					beforeHookName: 'beforeQuery',
					beforePayload: createHookContext(
						context,
						tableName,
						'findUnique',
						args,
					) as BeforeQueryHookContext<Schema, Meta>,
					context,
					operation: () =>
						findFirstInternal(context, tableName, args),
					tableName,
				}),
				context,
				'findUnique',
				args,
				'findUnique',
				tableName,
			),
		create: (args: CreateArgs<Schema, BetterTableKey<Schema>, Meta>) =>
			executeOperation({
				action: 'create',
				args,
				afterHookName: 'afterCreate',
				afterPayload: (result) =>
					({
						...createHookContext(
							context,
							tableName,
							'create',
							args,
						),
						result,
						row: result,
					}) as AfterCreateHookContext<Schema, Meta>,
				beforeHookName: 'beforeCreate',
				beforePayload: createHookContext(
					context,
					tableName,
					'create',
					args,
				) as BeforeCreateHookContext<Schema, Meta>,
				context,
				operation: () =>
					createInternal(context, tableName, {
						...args,
						data: args.data as Record<string, unknown>,
					}),
				tableName,
			}),
		update: (args: UpdateArgs<Schema, BetterTableKey<Schema>, Meta>) =>
			attachThrow(
				executeOperation({
					action: 'update',
					args,
					afterHookName: 'afterUpdate',
					afterPayload: (result) =>
						({
							...createHookContext(
								context,
								tableName,
								'update',
								args,
							),
							result,
							row: result,
						}) as AfterUpdateHookContext<Schema, Meta>,
					beforeHookName: 'beforeUpdate',
					beforePayload: createHookContext(
						context,
						tableName,
						'update',
						args,
					) as BeforeUpdateHookContext<Schema, Meta>,
					context,
					operation: () => updateInternal(context, tableName, args),
					tableName,
				}),
				context,
				'update',
				args,
				'update',
				tableName,
			),
		updateMany: (
			args: UpdateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
		) =>
			executeOperation({
				action: 'updateMany',
				args,
				afterHookName: 'afterUpdate',
				afterPayload: (result) =>
					({
						...createHookContext(
							context,
							tableName,
							'updateMany',
							args,
						),
						result,
					}) as AfterUpdateHookContext<Schema, Meta>,
				beforeHookName: 'beforeUpdate',
				beforePayload: createHookContext(
					context,
					tableName,
					'updateMany',
					args,
				) as BeforeUpdateHookContext<Schema, Meta>,
				context,
				operation: () => updateManyInternal(context, tableName, args),
				tableName,
			}),
		delete: (args: DeleteArgs<Schema, BetterTableKey<Schema>, Meta>) =>
			attachThrow(
				executeOperation({
					action: 'delete',
					args,
					afterHookName: 'afterDelete',
					afterPayload: (result) =>
						({
							...createHookContext(
								context,
								tableName,
								'delete',
								args,
							),
							result,
							row: result,
						}) as AfterDeleteHookContext<Schema, Meta>,
					beforeHookName: 'beforeDelete',
					beforePayload: createHookContext(
						context,
						tableName,
						'delete',
						args,
					) as BeforeDeleteHookContext<Schema, Meta>,
					context,
					operation: () => deleteInternal(context, tableName, args),
					tableName,
				}),
				context,
				'delete',
				args,
				'delete',
				tableName,
			),
		deleteMany: (
			args: DeleteManyArgs<Schema, BetterTableKey<Schema>, Meta>,
		) =>
			executeOperation({
				action: 'deleteMany',
				args,
				afterHookName: 'afterDelete',
				afterPayload: (result) =>
					({
						...createHookContext(
							context,
							tableName,
							'deleteMany',
							args,
						),
						result,
					}) as AfterDeleteHookContext<Schema, Meta>,
				beforeHookName: 'beforeDelete',
				beforePayload: createHookContext(
					context,
					tableName,
					'deleteMany',
					args,
				) as BeforeDeleteHookContext<Schema, Meta>,
				context,
				operation: () => deleteManyInternal(context, tableName, args),
				tableName,
			}),
		upsert: async (
			args: UpsertArgs<Schema, BetterTableKey<Schema>, Meta>,
		) => {
			const existing = await findFirstInternal(context, tableName, {
				where: args.where,
			});
			return existing
				? (() => {
						const updateArgs: UpdateArgs<
							Schema,
							BetterTableKey<Schema>,
							Meta
						> = {
							where: args.where,
							data: args.update,
							select: args.select,
							include: args.include,
							meta: args.meta,
						};
						return executeOperation({
							action: 'upsert',
							args: updateArgs,
							afterHookName: 'afterUpdate',
							afterPayload: (result) =>
								({
									...createHookContext(
										context,
										tableName,
										'upsert',
										updateArgs,
									),
									result,
									row: result,
								}) as AfterUpdateHookContext<Schema, Meta>,
							beforeHookName: 'beforeUpdate',
							beforePayload: createHookContext(
								context,
								tableName,
								'upsert',
								updateArgs,
							) as BeforeUpdateHookContext<Schema, Meta>,
							context,
							operation: () =>
								updateInternal(context, tableName, updateArgs),
							tableName,
						});
					})()
				: (() => {
						const createArgs: CreateArgs<
							Schema,
							BetterTableKey<Schema>,
							Meta
						> = {
							data: args.create,
							select: args.select,
							include: args.include,
							meta: args.meta,
						};
						return executeOperation({
							action: 'upsert',
							args: createArgs,
							afterHookName: 'afterCreate',
							afterPayload: (result) =>
								({
									...createHookContext(
										context,
										tableName,
										'upsert',
										createArgs,
									),
									result,
									row: result,
								}) as AfterCreateHookContext<Schema, Meta>,
							beforeHookName: 'beforeCreate',
							beforePayload: createHookContext(
								context,
								tableName,
								'upsert',
								createArgs,
							) as BeforeCreateHookContext<Schema, Meta>,
							context,
							operation: () =>
								createInternal(context, tableName, {
									...createArgs,
									data: createArgs.data as Record<
										string,
										unknown
									>,
								}),
							tableName,
						});
					})();
		},
		paginate: (
			args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
		) =>
			executeOperation({
				action: 'paginate',
				args,
				afterHookName: 'afterQuery',
				afterPayload: (result) =>
					({
						...createHookContext(
							context,
							tableName,
							'paginate',
							args,
						),
						result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: createHookContext(
					context,
					tableName,
					'paginate',
					args,
				) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: () => paginateInternal(context, tableName, args),
				tableName,
			}),
	};
};

/**
 * Internal factory that builds a {@link BetterDrizzleClient} from a raw
 * Drizzle database instance and a configuration object. This is the runtime
 * implementation behind the public {@link better} helper.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta - Custom metadata type. Defaults to {@link BetterMeta}.
 * @param drizzleDb - The raw Drizzle database instance.
 * @param options - Client configuration (schema, plugins, hooks).
 * @returns A fully typed client with delegates for every table.
 */
export const createBetterClient = <Schema extends AnySchema, Meta = BetterMeta>(
	drizzleDb: unknown,
	options: BetterClientOptions<Schema, Meta>,
) => {
	const db = drizzleDb as DrizzleLikeDatabase;
	const relational = extractTablesRelationalConfig(
		options.schema,
		createTableRelationsHelpers,
	);
	const context: RuntimeContext<Schema, Meta> = {
		db,
		options,
		fullSchema: options.schema,
		relational,
		repositories: {},
	};

	const client = {} as Record<string, unknown>;
	const repositories = {} as Record<string, unknown>;

	for (const [tableName, table] of Object.entries(options.schema)) {
		if (!isTable(table)) {
			continue;
		}

		const delegate = makeModelDelegate(
			context,
			tableName as BetterTableKey<Schema>,
		);
		client[tableName] = delegate;
		repositories[tableName] = delegate;
		repositories[table._.name] = delegate;
	}

	context.repositories = repositories;

	client.repository = (name: string) => {
		const repository = repositories[name];

		if (!repository) throw new Error(`Repository "${name}" not found.`);

		return repository;
	};

	return client as BetterDrizzleClient<Schema, Meta>;
};
