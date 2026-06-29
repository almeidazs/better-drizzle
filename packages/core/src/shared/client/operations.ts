import { type AnyColumn, and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { One } from 'drizzle-orm/relations';
import { isSQLWrapper } from 'drizzle-orm/sql';

import type {
	AnySchema,
	BatchResult,
	BetterTableKey,
	CompilableWhere,
	CreateArgs,
	CreateManyArgs,
	CursorArgs,
	DeleteArgs,
	DeleteManyArgs,
	PaginationArgs,
	QueryArgs,
	RuntimeContext,
	SkipDuplicatesOption,
	TableRuntime,
	UpdateArgs,
	UpdateEachArgs,
	UpdateManyArgs,
	UpsertArgs,
	UpsertManyArgs,
	UpsertManyUpdateValue,
	WhereArg,
	WhereCompilerContext,
} from '../../types';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';
import {
	buildCursorPaginationQuery,
	buildOffsetPaginationQuery,
	buildQueryConfig,
	compileCursorWhere,
	compileOrderBy,
	compileWhereInput,
	countRows,
} from '../query';
import { getPrimaryKeyWhere, getTableRuntime, isSimpleRecord } from './context';

type ResolvedSkipDuplicates = {
	enabled: boolean;
	targets?: string[];
};

const getSkipDuplicatesConfig = <Schema extends AnySchema>(
	skipDuplicates?: SkipDuplicatesOption<Schema, BetterTableKey<Schema>>,
): ResolvedSkipDuplicates => {
	if (!skipDuplicates) return { enabled: false };
	if (skipDuplicates === true) return { enabled: true };

	return { enabled: true, targets: [...skipDuplicates] };
};

const getSkipDuplicateTargetColumns = (
	runtime: TableRuntime,
	targets: string[] | undefined,
) => {
	if (!targets?.length) return;

	const columns = [];

	for (const target of targets) {
		const column = runtime.columns[target];

		if (column) {
			columns.push(column);
			continue;
		}

		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			details: { target },
			message: `Invalid skipDuplicates target "${target}" for table "${runtime.dbName}"`,
			operation: 'create',
			table: runtime.dbName,
		});
	}

	return columns;
};

const getConflictTarget = (columns: AnyColumn[] | undefined) => {
	if (!columns?.length) return;
	return columns.length === 1 ? columns[0] : columns;
};

const getBatchSize = (batchSize: number | undefined) => {
	if (batchSize === undefined) return;
	if (!Number.isInteger(batchSize) || batchSize <= 0)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			details: { batchSize },
			message: 'batchSize must be a positive integer.',
			operation: 'upsertMany',
		});

	return batchSize;
};

const getTargetColumns = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	target: UpsertManyArgs<Schema, BetterTableKey<Schema>, Meta>['target'],
) => {
	const targets = Array.isArray(target) ? [...target] : [target];
	if (!targets.length)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message: 'upsertMany requires at least one target column.',
			operation: 'upsertMany',
			table: runtime.dbName,
		});

	const columns = [];

	for (const targetName of targets) {
		const column = runtime.columns[targetName];
		if (column) {
			columns.push(column);
			continue;
		}

		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			details: { target: targetName },
			message: `Invalid upsertMany target "${targetName}" for table "${runtime.dbName}"`,
			operation: 'upsertMany',
			table: runtime.dbName,
		});
	}

	if (context.dialect === 'mysql')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			details: { target: targets },
			message: 'upsertMany is only supported on PostgreSQL and SQLite.',
			operation: 'upsertMany',
			table: runtime.dbName,
		});

	return columns;
};

const getExcludedReference = (column: AnyColumn) =>
	sql`${sql.identifier('excluded')}.${sql.identifier(column.name)}`;

const getUpsertManyUpdateContext = <Schema extends AnySchema>(
	runtime: TableRuntime,
) => {
	const excluded = Object.create(null) as Record<string, SQL>;
	const table = Object.create(null) as Record<string, AnyColumn>;

	for (const key in runtime.columns) {
		const column = runtime.columns[key];
		if (!column) continue;

		excluded[key] = getExcludedReference(column);
		table[key] = column;
	}

	return {
		excluded,
		sql,
		table,
	} as unknown as import('../../types').UpsertManyUpdateContext<
		Schema,
		BetterTableKey<Schema>
	>;
};

const isPlainUpdateObject = (value: unknown) =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const validateUpsertManyUpdateObject = (
	runtime: TableRuntime,
	update: unknown,
) => {
	if (!isPlainUpdateObject(update))
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message: 'upsertMany update must resolve to an object.',
			operation: 'upsertMany',
			table: runtime.dbName,
		});

	const source = update as Record<string, unknown>;
	const result = Object.create(null) as Record<string, unknown>;

	for (const key in source) {
		const column = runtime.columns[key];
		if (!column)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				details: { column: key },
				message: `Invalid upsertMany update column "${key}" for table "${runtime.dbName}"`,
				operation: 'upsertMany',
				table: runtime.dbName,
			});

		const value = source[key];
		if (value !== undefined) result[key] = value;
	}

	return result;
};

const buildUpsertManySet = <Schema extends AnySchema, Meta>(
	runtime: TableRuntime,
	args: UpsertManyArgs<Schema, BetterTableKey<Schema>, Meta>,
	targetColumns: AnyColumn[],
) => {
	const targetNames = new Set(targetColumns.map((column) => column.name));

	if (args.update === 'all') {
		const result = Object.create(null) as Record<string, unknown>;

		for (const key in runtime.columns) {
			const column = runtime.columns[key];
			if (!column || targetNames.has(column.name)) continue;

			result[key] = getExcludedReference(column);
		}

		return result;
	}

	if (Array.isArray(args.update)) {
		const result = Object.create(null) as Record<string, unknown>;

		for (const key of args.update) {
			const column = runtime.columns[key];
			if (!column)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.OperationError,
					details: { column: key },
					message: `Invalid upsertMany update column "${key}" for table "${runtime.dbName}"`,
					operation: 'upsertMany',
					table: runtime.dbName,
				});

			result[key] = getExcludedReference(column);
		}

		return result;
	}

	if (typeof args.update === 'function')
		return validateUpsertManyUpdateObject(
			runtime,
			args.update(getUpsertManyUpdateContext<Schema>(runtime)),
		);

	return validateUpsertManyUpdateObject(
		runtime,
		args.update as UpsertManyUpdateValue<Schema, BetterTableKey<Schema>>,
	);
};

const getReturningSelection = (
	runtime: TableRuntime,
	select?: Record<string, unknown>,
	operation = 'upsertMany',
) => {
	if (!select) return;
	if (hasRelationSelection(runtime, select))
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message: `${operation} does not support relation selects.`,
			operation,
			table: runtime.dbName,
		});

	return getDirectSelection(runtime, select);
};

const getColumnKeyByInstance = (
	runtime: TableRuntime,
	column: AnyColumn,
	operation: string,
) => {
	for (const key in runtime.columns)
		if (runtime.columns[key] === column) return key;

	for (const key in runtime.columns)
		if (runtime.columns[key]?.name === column.name) return key;

	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.OperationError,
		details: { column: column.name },
		message: `Invalid ${operation} "by" column for table "${runtime.dbName}"`,
		operation,
		table: runtime.dbName,
	});
};

const getUpdateEachWhere = <Schema extends AnySchema>(
	byKey: string,
	values: unknown[],
	where?: WhereArg<Schema, BetterTableKey<Schema>>,
) =>
	(where
		? {
				AND: [
					where,
					{
						[byKey]: {
							in: values,
						},
					},
				],
			}
		: {
				[byKey]: {
					in: values,
				},
			}) as WhereArg<Schema, BetterTableKey<Schema>>;

const getUpdateEachRows = <Schema extends AnySchema, Meta>(
	runtime: TableRuntime,
	args: UpdateEachArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	if (!args.data.length) {
		if (args.onEmpty === 'throw')
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				message: 'updateEach requires at least one input row.',
				operation: 'updateEach',
				table: runtime.dbName,
			});

		return;
	}

	const byKey = getColumnKeyByInstance(runtime, args.by, 'updateEach');
	const values = new Array(args.data.length);
	const seen = new Set<unknown>();

	for (let index = 0; index < args.data.length; index += 1) {
		const row = args.data[index] as Record<string, unknown>;
		const byValue = row[byKey];

		if (byValue === undefined)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				details: { by: byKey, index },
				message: `updateEach row at index ${index} is missing "${byKey}".`,
				operation: 'updateEach',
				table: runtime.dbName,
			});

		if (seen.has(byValue))
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				details: { by: byKey, value: byValue },
				message: `updateEach received duplicate "${byKey}" values.`,
				operation: 'updateEach',
				table: runtime.dbName,
			});

		seen.add(byValue);
		values[index] = byValue;
	}

	return { byKey, values };
};

const buildUpdateEachSet = <Schema extends AnySchema, Meta>(
	runtime: TableRuntime,
	byKey: string,
	args: UpdateEachArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const byColumn = runtime.columns[byKey];
	const updates = args.update as Record<string, unknown>;
	const set = Object.create(null) as Record<string, unknown>;
	let hasColumns = false;

	for (const key in updates) {
		const resolve = updates[key];
		if (typeof resolve !== 'function') continue;

		const column = runtime.columns[key];
		if (!column)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				details: { column: key },
				message: `Invalid updateEach update column "${key}" for table "${runtime.dbName}"`,
				operation: 'updateEach',
				table: runtime.dbName,
			});

		const branches = new Array<SQL>(args.data.length);
		for (let index = 0; index < args.data.length; index += 1) {
			const row = args.data[index] as Record<string, unknown>;
			const nextValue = resolve(row as never);
			if (nextValue === undefined)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.OperationError,
					details: { column: key, index },
					message: `updateEach "${key}" resolver returned undefined at row ${index}.`,
					operation: 'updateEach',
					table: runtime.dbName,
				});

			branches[index] = sql`when ${byColumn} = ${row[byKey]} then ${
				isSQLWrapper(nextValue)
					? nextValue
					: sql.param(nextValue, column)
			}`;
		}

		set[key] = sql.join(
			[
				sql.raw('case'),
				sql.join(branches, sql.raw(' ')),
				sql.raw('else'),
				sql`${column}`,
				sql.raw('end'),
			],
			sql.raw(' '),
		);
		hasColumns = true;
	}

	if (!hasColumns)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message: 'updateEach update must affect at least one column.',
			operation: 'updateEach',
			table: runtime.dbName,
		});

	return set;
};

const getAffectedCount = (result: unknown) => {
	if (typeof result !== 'object' || result === null) return;

	for (const key of ['affectedRows', 'changes', 'rowCount']) {
		const value = (result as Record<string, unknown>)[key];
		if (typeof value === 'number' && Number.isFinite(value)) return value;
	}

	const rowsAffected = (result as Record<string, unknown>).rowsAffected;
	if (typeof rowsAffected === 'number' && Number.isFinite(rowsAffected))
		return rowsAffected;
	if (Array.isArray(rowsAffected)) {
		let total = 0;
		let hasValue = false;

		for (const value of rowsAffected) {
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			total += value;
			hasValue = true;
		}

		if (hasValue) return total;
	}
};

const getCreateOperationName = (
	args:
		| CreateArgs<AnySchema, BetterTableKey<AnySchema>, unknown>
		| CreateManyArgs<AnySchema, BetterTableKey<AnySchema>, unknown>,
) => (Array.isArray(args.data) ? 'createMany' : 'create');

const applyInsertOnConflict = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	args:
		| CreateArgs<Schema, BetterTableKey<Schema>, Meta>
		| CreateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const operation = getCreateOperationName(
		args as CreateArgs<AnySchema, BetterTableKey<AnySchema>, unknown>,
	);
	const skipDuplicates = getSkipDuplicatesConfig(args.skipDuplicates);
	const baseBuilder = context.db.insert(runtime.table);
	const targetColumns = getSkipDuplicateTargetColumns(
		runtime,
		skipDuplicates.targets,
	);

	if (!skipDuplicates.enabled)
		return {
			builder: baseBuilder.values(args.data),
			skipDuplicates,
		};

	if (targetColumns?.length && context.dialect === 'mysql')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			details: { targets: skipDuplicates.targets },
			message: `skipDuplicates targets are not supported on ${context.dialect}`,
			operation,
			table: runtime.dbName,
		});

	if (typeof baseBuilder.ignore === 'function' && !targetColumns?.length)
		return {
			builder: baseBuilder.ignore().values(args.data),
			skipDuplicates,
		};

	const builder = baseBuilder.values(args.data);
	if (typeof builder.onConflictDoNothing === 'function')
		return {
			builder: builder.onConflictDoNothing({
				target: getConflictTarget(targetColumns),
			}),
			skipDuplicates,
		};

	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.OperationError,
		details: { targets: skipDuplicates.targets },
		message: `skipDuplicates is not supported for ${context.dialect}`,
		operation,
		table: runtime.dbName,
	});
};

const hasProjection = (
	args: { include?: unknown; select?: unknown } | undefined,
) => Boolean(args?.select || args?.include);

const canUsePrimaryKeyConflict = (
	runtime: TableRuntime,
	where: unknown,
	create: Record<string, unknown>,
) => {
	if (!runtime.primaryKeyFields.length || !isSimpleRecord(where))
		return false;

	for (const field of runtime.primaryKeyFields)
		if (where[field] !== create[field]) return false;

	return true;
};

const getPrimaryKeyTarget = (runtime: TableRuntime) =>
	runtime.primaryKeyFields
		.map((field) => runtime.columns[field])
		.filter(Boolean);

const hasRelationSelection = (
	runtime: TableRuntime,
	select?: Record<string, unknown>,
) => {
	if (!select) return false;

	for (const key in select) if (runtime.relationNames.has(key)) return true;

	return false;
};

const getDirectSelection = (
	runtime: TableRuntime,
	select?: Record<string, unknown>,
) => {
	if (!select) return;

	const selection = Object.create(null) as Record<string, unknown>;
	let hasSelection = false;

	for (const key in select) {
		if (select[key] !== true || runtime.relationNames.has(key)) continue;

		const column = runtime.columns[key];
		if (!column) continue;

		selection[key] = column;
		hasSelection = true;
	}

	return hasSelection ? selection : undefined;
};

const canUseDirectRead = (
	runtime: TableRuntime,
	args?: { include?: unknown; select?: unknown },
) =>
	!args?.include &&
	!hasRelationSelection(
		runtime,
		args?.select as Record<string, unknown> | undefined,
	);

const compileFastWhere = (runtime: TableRuntime, where: unknown) => {
	if (!isSimpleRecord(where)) return;

	const conditions = [];

	for (const key in where) {
		const value = where[key];
		if (value === undefined || runtime.relationNames.has(key)) return;

		const column = runtime.columns[key];
		if (!column || isSimpleRecord(value) || Array.isArray(value)) return;

		conditions.push(value === null ? isNull(column) : eq(column, value));
	}

	return conditions.length ? and(...conditions) : undefined;
};

const getPredicate = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	tableName: BetterTableKey<Schema>,
	where: unknown,
) =>
	compileFastWhere(runtime, where) ??
	compileWhereInput(
		{
			...context,
			runtime,
			tableName: tableName as string,
		},
		where as CompilableWhere | undefined,
	);

const buildReadState = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const where = getPredicate(context, runtime, tableName, args?.where);
	const whereContext = {
		...context,
		runtime,
		tableName: tableName as string,
		rootArgs: args,
	} as WhereCompilerContext<Schema, Meta>;
	const cursorWhere = compileCursorWhere(
		whereContext,
		args?.cursor,
		args?.orderBy,
		args?.take,
	);

	return {
		limit: args?.take === undefined ? undefined : Math.abs(args.take),
		offset: args?.skip,
		orderBy: compileOrderBy(whereContext, args?.orderBy),
		runtime,
		select: getDirectSelection(
			runtime,
			args?.select as Record<string, unknown> | undefined,
		),
		where: and(where, cursorWhere),
	};
};

const buildDirectReadQuery = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const state = buildReadState(context, tableName, args);
	let query = context.db.select(state.select).from(state.runtime.table);

	if (state.where) query = query.where(state.where);
	if (state.orderBy?.length) query = query.orderBy(...state.orderBy);
	if (state.limit !== undefined) query = query.limit(state.limit);
	if (state.offset !== undefined) query = query.offset(state.offset);

	return query;
};

const getJoinedRelation = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const include = args?.include as Record<string, unknown> | undefined;
	if (!include || args?.select) return;

	const relationNames = Object.keys(include);
	if (relationNames.length !== 1) return;

	const relationName = relationNames[0];
	if (!relationName || include[relationName] !== true) return;

	const relationState = runtime.relations[relationName];
	if (!relationState || !(relationState.relation instanceof One)) return;

	return {
		relationName,
		relationRuntime: getTableRuntime(context, relationState.tableName),
		relationState,
	};
};

const getJoinedRelationWhere = (
	runtime: TableRuntime,
	relationName: string,
	where: unknown,
) => {
	if (!isSimpleRecord(where)) return;

	const baseWhere = Object.create(null) as Record<string, unknown>;
	let hasBaseWhere = false;
	let relationWhere: Record<string, unknown> | undefined;

	for (const key in where) {
		const value = where[key];

		if (key === relationName) {
			if (
				!isSimpleRecord(value) ||
				value.is === null ||
				!isSimpleRecord(value.is)
			)
				return;

			for (const relationKey in value) if (relationKey !== 'is') return;

			relationWhere = value.is;
			continue;
		}

		if (runtime.relationNames.has(key)) return;
		baseWhere[key] = value;
		hasBaseWhere = true;
	}

	if (!relationWhere) return;

	return {
		baseWhere: hasBaseWhere ? baseWhere : undefined,
		relationWhere,
	};
};

const buildJoinedOneRelationQuery = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const joinedRelation = getJoinedRelation(context, runtime, args);
	if (!joinedRelation) return;

	const relationWhere = getJoinedRelationWhere(
		runtime,
		joinedRelation.relationName,
		args?.where,
	);
	if (!relationWhere) return;

	const selection = {
		...runtime.columns,
		[joinedRelation.relationName]: joinedRelation.relationRuntime.columns,
	};
	const joinConditions = [];

	for (
		let index = 0;
		index < joinedRelation.relationState.fields.length;
		index += 1
	) {
		const sourceField = joinedRelation.relationState.fields[index];
		const referenceField = joinedRelation.relationState.references[index];
		if (!sourceField || !referenceField) continue;
		joinConditions.push(eq(sourceField, referenceField));
	}

	const baseWhere = getPredicate(
		context,
		runtime,
		tableName,
		relationWhere.baseWhere,
	);
	const relationPredicate = compileWhereInput(
		{
			...context,
			runtime: joinedRelation.relationRuntime,
			tableName: joinedRelation.relationState.tableName,
		},
		relationWhere.relationWhere,
	);
	const whereContext = {
		...context,
		runtime,
		tableName: tableName as string,
		rootArgs: args,
	} as WhereCompilerContext<Schema, Meta>;
	const cursorWhere = compileCursorWhere(
		whereContext,
		args?.cursor,
		args?.orderBy,
		args?.take,
	);
	const orderBy = compileOrderBy(whereContext, args?.orderBy);
	let query = context.db
		.select(selection)
		.from(runtime.table)
		.innerJoin(
			joinedRelation.relationRuntime.table,
			and(...joinConditions),
		);
	const where = and(baseWhere, relationPredicate, cursorWhere);

	if (where) query = query.where(where);
	if (orderBy?.length) query = query.orderBy(...orderBy);
	if (args?.take !== undefined) query = query.limit(Math.abs(args.take));
	if (args?.skip !== undefined) query = query.offset(args.skip);

	return query;
};

/**
 * Finds multiple records matching the given query arguments. Uses a fast
 * direct-read path when no relation loading is needed, a joined single-relation
 * path for single `One` includes, and falls back to the relational query API.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to query.
 * @param args      - Query arguments (where, select, include, orderBy, take, skip, cursor).
 * @returns A promise resolving to an array of matching records.
 */
export const findManyRecords = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const joinedQuery = buildJoinedOneRelationQuery(context, tableName, args);
	if (joinedQuery) return joinedQuery;
	if (canUseDirectRead(runtime, args))
		return buildDirectReadQuery(context, tableName, args);

	return context.db.query[tableName].findMany(
		buildQueryConfig(context, tableName, args),
	);
};

/**
 * Finds a single record matching the given query arguments. Uses the same
 * fast-path strategy as {@link findManyRecords} but limits the result to
 * one row and returns `null` when no match is found.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to query.
 * @param args      - Query arguments.
 * @returns A promise resolving to the first matching record or `null`.
 */
export const findFirstRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const joinedQuery = buildJoinedOneRelationQuery(context, tableName, {
		...args,
		take: args?.take ?? 1,
	});

	if (joinedQuery) {
		const rows = await joinedQuery;
		return (rows[0] ?? null) as Record<string, unknown> | null;
	}

	if (canUseDirectRead(runtime, args)) {
		const rows = await buildDirectReadQuery(context, tableName, {
			...args,
			take: args?.take ?? 1,
		});

		return (rows[0] ?? null) as Record<string, unknown> | null;
	}

	if (context.db.query[tableName].findFirst) {
		const row = await context.db.query[tableName].findFirst(
			buildQueryConfig(context, tableName, args),
		);

		return (row ?? null) as Record<string, unknown> | null;
	}

	const rows = await context.db.query[tableName].findMany(
		buildQueryConfig(context, tableName, {
			...args,
			take: args?.take ?? 1,
		}),
	);

	return (rows[0] ?? null) as Record<string, unknown> | null;
};

/**
 * Checks whether at least one record matches the given where-clause.
 * Performs a `SELECT 1 … LIMIT 1` query for efficiency.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to check.
 * @param args      - Optional where-clause to filter by.
 * @returns A promise resolving to `true` if a matching record exists.
 */
export const existsRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: { where?: WhereArg<Schema, BetterTableKey<Schema>> },
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const predicate = getPredicate(context, runtime, tableName, args?.where);
	let query = context.db.select({ one: sql`1` }).from(runtime.table);

	if (predicate) query = query.where(predicate);

	const rows = await query.limit(1);

	return rows.length > 0;
};

/**
 * Reloads a single record from the database using its primary key values.
 * Falls back to all non-undefined fields when primary keys are not available.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to reload from.
 * @param record    - The record whose primary key values are used for lookup.
 * @param args      - Optional query arguments for projection and relation loading.
 * @returns A promise resolving to the reloaded record or `null`.
 */
export const reloadRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	record: Record<string, unknown>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const primaryKeyWhere = getPrimaryKeyWhere(runtime, record);
	const where =
		Object.keys(primaryKeyWhere).length > 0
			? primaryKeyWhere
			: Object.fromEntries(
					Object.entries(record).filter(
						([, value]) => value !== undefined,
					),
				);

	const rows = await findManyRecords(context, tableName, {
		...args,
		take: 1,
		where: where as WhereArg<Schema, BetterTableKey<Schema>>,
	});

	return (rows[0] ?? null) as Record<string, unknown> | null;
};

/**
 * Reloads multiple records in parallel using their primary key values.
 * Filters out any records that could not be found after reload.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to reload from.
 * @param records   - The records to reload.
 * @param args      - Optional query arguments for projection and relation loading.
 * @returns A promise resolving to an array of successfully reloaded records.
 */
export const reloadRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	records: Record<string, unknown>[],
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const rows = await Promise.all(
		records.map((record) => reloadRecord(context, tableName, record, args)),
	);

	return rows.filter((row): row is Record<string, unknown> => row !== null);
};

/**
 * Inserts a single record and returns the created row. When the database
 * supports `RETURNING`, the row is returned directly; otherwise it is
 * reloaded from the database. When `select` or `include` is specified,
 * the record is reloaded with the requested projection.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to insert into.
 * @param args      - Create arguments including `data` and optional projection.
 * @returns A promise resolving to the created record or `null`.
 */
export const createRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CreateArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const { builder, skipDuplicates } = applyInsertOnConflict(
		context,
		runtime,
		args,
	);

	if (typeof builder.returning === 'function') {
		const rows = await builder.returning();
		const created = rows[0] ?? null;
		if (!created) return null;
		if (!hasProjection(args)) return created;
		return reloadRecord(context, tableName, created, args);
	}

	const result = await builder;
	if (skipDuplicates.enabled && (getAffectedCount(result) ?? 0) === 0)
		return null;

	return reloadRecord(
		context,
		tableName,
		args.data as Record<string, unknown>,
		args,
	);
};

/**
 * Inserts multiple records in a single query. Returns a `BatchResult`
 * containing the count of inserted rows and, when supported, the
 * inserted data. When `select` or `include` is specified, the
 * inserted records are reloaded with the requested projection.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to insert into.
 * @param args      - CreateMany arguments including `data` array and optional projection.
 * @returns A promise resolving to a `BatchResult` with count and optional data.
 */
export const createManyRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CreateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<Record<string, unknown>>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const { builder, skipDuplicates } = applyInsertOnConflict(
		context,
		runtime,
		args,
	);

	if (typeof builder.returning !== 'function') {
		const result = await builder;
		const count =
			getAffectedCount(result) ??
			(skipDuplicates.enabled ? 0 : args.data.length);
		return { count };
	}

	const rows = await builder.returning();
	if (!rows.length) return { count: 0 };
	if (!hasProjection(args)) return { count: rows.length, data: rows };

	const data = await reloadRecords(context, tableName, rows, args);
	return { count: rows.length, data: data.length ? data : undefined };
};

const upsertManyChunk = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpsertManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<Record<string, unknown>>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const targetColumns = getTargetColumns(context, runtime, args.target);
	const selection = getReturningSelection(
		runtime,
		args.select as Record<string, unknown> | undefined,
	);
	const set = buildUpsertManySet(runtime, args, targetColumns);

	if (!Object.keys(set).length)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			details: { target: args.target, update: args.update },
			message: 'upsertMany update must affect at least one column.',
			operation: 'upsertMany',
			table: runtime.dbName,
		});

	const builder = context.db.insert(runtime.table).values(args.data);
	if (typeof builder.onConflictDoUpdate !== 'function')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message: `upsertMany is not supported for ${context.dialect}.`,
			operation: 'upsertMany',
			table: runtime.dbName,
		});

	const query = builder.onConflictDoUpdate({
		set,
		setWhere: args.where,
		target: getConflictTarget(targetColumns) ?? targetColumns,
	});

	if (typeof query.returning === 'function') {
		const rows = await query.returning(selection);
		return {
			count: rows.length,
			data: rows.length ? rows : undefined,
		};
	}

	const result = await query;
	return {
		count: getAffectedCount(result) ?? args.data.length,
	};
};

/**
 * Upserts multiple records in a native batch statement using an explicit
 * conflict target. Designed for the fastest supported path and intentionally
 * fails early when the request cannot be expressed efficiently.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to upsert into.
 * @param args      - Batch upsert arguments including `data`, `target`,
 *   `update`, and optional `select`, `batchSize`, and `where`.
 * @returns A promise resolving to a `BatchResult` with affected count and
 *   optional returned rows.
 */
export const upsertManyRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpsertManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<Record<string, unknown>>> => {
	if (!args.data.length) return { count: 0 };

	const batchSize = getBatchSize(args.batchSize);
	if (!batchSize || args.data.length <= batchSize)
		return upsertManyChunk(context, tableName, args);

	let count = 0;
	let data: Record<string, unknown>[] | undefined;

	for (let start = 0; start < args.data.length; start += batchSize) {
		const chunk = await upsertManyChunk(context, tableName, {
			...args,
			batchSize: undefined,
			data: args.data.slice(start, start + batchSize),
		});

		count += chunk.count;
		if (chunk.data?.length) {
			if (!data) data = [];
			data.push(...chunk.data);
		}
	}

	return { count, data };
};

/**
 * Updates a single record matching the where-clause and returns the updated row.
 * Uses `RETURNING` when available; otherwise reloads from the database. When
 * `select` or `include` is specified, the record is reloaded with the
 * requested projection.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to update.
 * @param args      - Update arguments including `data` and `where`.
 * @returns A promise resolving to the updated record or `null` if not found.
 */
export const updateRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpdateArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const predicate = getPredicate(context, runtime, tableName, args.where);
	if (!predicate) return null;

	const builder = context.db
		.update(runtime.table)
		.set(args.data)
		.where(predicate);

	if (typeof builder.returning === 'function') {
		const rows = await builder.returning();
		const updated = rows[0] ?? null;
		if (!updated) return null;
		if (!hasProjection(args)) return updated;
		return reloadRecord(context, tableName, updated, args);
	}

	const existing = await findFirstRecord(context, tableName, {
		where: args.where,
	});
	if (!existing) return null;

	await builder;
	return reloadRecord(context, tableName, existing, args);
};

/**
 * Deletes a single record matching the where-clause and returns the deleted row.
 * Uses `RETURNING` when available; otherwise reloads before deletion. When
 * `select` or `include` is specified, the record is reloaded with the
 * requested projection.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to delete from.
 * @param args      - Delete arguments including `where`.
 * @returns A promise resolving to the deleted record or `null` if not found.
 */
export const deleteRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: DeleteArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const predicate = getPredicate(context, runtime, tableName, args.where);
	if (!predicate) return null;

	const builder = context.db.delete(runtime.table).where(predicate);

	if (typeof builder.returning === 'function') {
		const rows = await builder.returning();
		const deleted = rows[0] ?? null;
		if (!deleted) return null;
		if (!hasProjection(args)) return deleted;
		return reloadRecord(context, tableName, deleted, args);
	}

	const existing = await findFirstRecord(context, tableName, args);
	if (!existing) return null;

	await builder;
	return existing;
};

/**
 * Updates all records matching the where-clause. First counts the
 * affected rows, then performs the update. Returns a `BatchResult`
 * with the count of updated rows.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to update.
 * @param args      - UpdateMany arguments including `data` and optional `where`.
 * @returns A promise resolving to a `BatchResult` with the affected count.
 */
export const updateManyRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpdateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<never>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const predicate = getPredicate(context, runtime, tableName, args.where);
	if (!predicate) return { count: 0 };

	const affectedCount = await countRows(context, tableName, args.where);
	if (affectedCount > 0)
		await context.db.update(runtime.table).set(args.data).where(predicate);

	return { count: affectedCount };
};

export const updateEachRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpdateEachArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<Record<string, unknown>>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const rows = getUpdateEachRows(runtime, args);
	if (!rows) return { count: 0 };

	const where = getUpdateEachWhere<Schema>(
		rows.byKey,
		rows.values,
		args.where,
	);
	const predicate = getPredicate(context, runtime, tableName, where);
	if (!predicate) return { count: 0 };

	const affectedCount = await countRows(context, tableName, where);
	if (affectedCount === 0) return { count: 0 };

	const set = buildUpdateEachSet(runtime, rows.byKey, args);
	const selection = getReturningSelection(
		runtime,
		args.select as Record<string, unknown> | undefined,
		'updateEach',
	);
	const builder = context.db.update(runtime.table).set(set).where(predicate);

	if (selection && typeof builder.returning === 'function') {
		const data = await builder.returning(selection);
		return { count: affectedCount, data };
	}

	await builder;
	if (!args.select) return { count: affectedCount };

	const data = await findManyRecords(context, tableName, {
		select: args.select,
		where,
	});

	return {
		count: affectedCount,
		data: data.length ? (data as Record<string, unknown>[]) : undefined,
	};
};

/**
 * Deletes all records matching the where-clause. First counts the
 * affected rows, then performs the delete. Returns a `BatchResult`
 * with the count of deleted rows.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to delete from.
 * @param args      - DeleteMany arguments including optional `where`.
 * @returns A promise resolving to a `BatchResult` with the affected count.
 */
export const deleteManyRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: DeleteManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<never>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const predicate = getPredicate(context, runtime, tableName, args?.where);
	if (!predicate) return { count: 0 };

	const affectedCount = await countRows(context, tableName, args?.where);
	if (affectedCount > 0)
		await context.db.delete(runtime.table).where(predicate);

	return { count: affectedCount };
};

/**
 * Upserts a record: inserts it if it does not exist, or updates it if
 * it does. When the database supports `ON CONFLICT DO UPDATE` and the
 * where-clause targets the primary key, a native conflict-update is used.
 * Otherwise falls back to a read-then-write flow.
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to upsert into.
 * @param args      - Upsert arguments including `create`, `update`, and `where`.
 * @returns A promise resolving to the upserted record or `null`.
 */
export const upsertRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpsertArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const createData = args.create as Record<string, unknown>;
	const updateData = args.update as Record<string, unknown>;
	const insertBuilder = context.db.insert(runtime.table).values(createData);

	if (
		typeof insertBuilder.onConflictDoUpdate === 'function' &&
		canUsePrimaryKeyConflict(runtime, args.where, createData)
	) {
		const target = getPrimaryKeyTarget(runtime);
		const conflictTarget = target.length === 1 ? target[0] : target;
		if (!conflictTarget)
			return createRecord(context, tableName, {
				data: args.create,
				include: args.include,
				meta: args.meta,
				select: args.select,
			});

		const builder = insertBuilder.onConflictDoUpdate({
			set: updateData,
			target: conflictTarget,
		});

		if (typeof builder.returning === 'function') {
			const rows = await builder.returning();
			const record = rows[0] ?? null;
			if (!record) return null;
			if (!hasProjection(args)) return record;
			return reloadRecord(context, tableName, record, args);
		}

		await builder;
		return reloadRecord(context, tableName, createData, args);
	}

	const existing = await findFirstRecord(context, tableName, {
		where: args.where,
	});

	if (existing)
		return updateRecord(context, tableName, {
			data: args.update,
			include: args.include,
			meta: args.meta,
			select: args.select,
			where: args.where,
		});

	return createRecord(context, tableName, {
		data: args.create,
		include: args.include,
		meta: args.meta,
		select: args.select,
	});
};

/**
 * Executes an offset paginated query, returning the data slice alongside
 * page metadata (`page`, `perPage`, `total`, `pageCount`, `hasNext`,
 * `hasPrevious`).
 *
 * @typeParam Schema - The Drizzle schema type.
 * @typeParam Meta   - Custom metadata type.
 * @param context   - The runtime context.
 * @param tableName - The table to paginate.
 * @param args      - Pagination arguments (`limit`, `take`, `skip`, `where`, `orderBy`).
 * @returns A promise resolving to `{ data, pagination }`.
 */
export const paginateRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const { take, query } = buildOffsetPaginationQuery(args);
	const [data, total] = await Promise.all([
		findManyRecords(context, tableName, query),
		countRows(context, tableName, args.where),
	]);
	const skip = query.skip ?? 0;
	const page = Math.floor(skip / take) + 1;
	const pageCount = total === 0 ? 0 : Math.ceil(total / take);

	return {
		data,
		pagination: {
			type: 'offset' as const,
			page,
			perPage: take,
			total,
			pageCount,
			hasNext: skip + data.length < total,
			hasPrevious: skip > 0,
		},
	};
};

const getCursorField = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const cursorToken = (
		args.after && typeof args.after === 'object'
			? args.after
			: args.before && typeof args.before === 'object'
				? args.before
				: undefined
	) as Record<string, unknown> | undefined;

	if (cursorToken)
		for (const key in cursorToken) if (runtime.columns[key]) return key;

	const entries = args.orderBy
		? Array.isArray(args.orderBy)
			? args.orderBy
			: [args.orderBy]
		: undefined;

	if (entries)
		for (const entry of entries)
			for (const key in entry as Record<string, unknown>)
				if (runtime.columns[key]) return key;

	return runtime.primaryKeyFields[0];
};

const getCursorToken = (
	row: Record<string, unknown> | undefined,
	field: string | undefined,
	tableName: string,
	operation: 'cursor',
) => {
	if (!row || !field) return null;
	if (!(field in row))
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			details: { cursorField: field },
			message: `Cursor field "${field}" must be selected when using cursor pagination on table "${tableName}"`,
			operation,
			table: tableName,
		});

	return { [field]: row[field] };
};

const hasCursorPage = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const result = buildCursorPaginationQuery(args, 1);
	if ('error' in result)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message:
				result.error === 'AMBIGUOUS_CURSOR'
					? 'cursor() accepts either before or after, but not both.'
					: result.error === 'INVALID_BEFORE_CURSOR'
						? 'cursor() before must be a cursor object.'
						: 'cursor() after must be a cursor object.',
			operation: 'cursor',
			table: getTableRuntime(context, tableName as string).dbName,
		});

	const rows = await findManyRecords(context, tableName, result.query);
	return rows.length > 0;
};

export const cursorRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const limit = Math.abs(args.limit ?? args.take ?? 10) || 10;
	const runtime = getTableRuntime(context, tableName as string);
	const built = buildCursorPaginationQuery(args, limit + 1);

	if ('error' in built)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			message:
				built.error === 'AMBIGUOUS_CURSOR'
					? 'cursor() accepts either before or after, but not both.'
					: built.error === 'INVALID_BEFORE_CURSOR'
						? 'cursor() before must be a cursor object.'
						: 'cursor() after must be a cursor object.',
			operation: 'cursor',
			table: runtime.dbName,
		});

	const rows = await findManyRecords(context, tableName, built.query);
	const hasOverflow = rows.length > limit;
	const slice = hasOverflow ? rows.slice(0, limit) : rows;
	const data = built.direction === 'before' ? [...slice].reverse() : slice;
	const cursorField = getCursorField(context, tableName, args);
	const firstRow = data[0] as Record<string, unknown> | undefined;
	const lastRow = data[data.length - 1] as
		| Record<string, unknown>
		| undefined;
	const previousToken = (getCursorToken(
		firstRow,
		cursorField,
		runtime.dbName,
		'cursor',
	) ?? undefined) as CursorArgs<
		Schema,
		BetterTableKey<Schema>,
		Meta
	>['before'];
	const nextToken = (getCursorToken(
		lastRow,
		cursorField,
		runtime.dbName,
		'cursor',
	) ?? undefined) as CursorArgs<
		Schema,
		BetterTableKey<Schema>,
		Meta
	>['after'];
	const hasPrevious =
		built.direction === 'before'
			? hasOverflow
			: args.after
				? await hasCursorPage(context, tableName, {
						...args,
						after: undefined,
						before: previousToken,
						limit: 1,
					})
				: false;
	const hasNext =
		built.direction === 'before'
			? args.before
				? await hasCursorPage(context, tableName, {
						...args,
						before: undefined,
						after: nextToken,
						limit: 1,
					})
				: false
			: hasOverflow;

	return {
		data,
		pagination: {
			type: 'cursor' as const,
			hasNext,
			hasPrevious,
			nextCursor: hasNext ? (nextToken ?? null) : null,
			previousCursor: hasPrevious ? (previousToken ?? null) : null,
		},
	};
};
