import { and, eq, isNull, sql } from 'drizzle-orm';
import { One } from 'drizzle-orm/relations';

import type {
	AnySchema,
	BatchResult,
	BetterTableKey,
	CompilableWhere,
	CreateArgs,
	CreateManyArgs,
	DeleteArgs,
	DeleteManyArgs,
	PaginationArgs,
	QueryArgs,
	RuntimeContext,
	TableRuntime,
	UpdateArgs,
	UpdateManyArgs,
	UpsertArgs,
	WhereArg,
	WhereCompilerContext,
} from '../../types';
import { PaginationType } from '../../types';
import {
	buildPaginationQuery,
	buildQueryConfig,
	compileCursorWhere,
	compileOrderBy,
	compileWhereInput,
	countRows,
} from '../query';
import { getPrimaryKeyWhere, getTableRuntime, isSimpleRecord } from './context';

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

export const createRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CreateArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const builder = context.db.insert(runtime.table).values(args.data);

	if (typeof builder.returning === 'function') {
		const rows = await builder.returning();
		const created = rows[0] ?? null;
		if (!created) return null;
		if (!hasProjection(args)) return created;
		return reloadRecord(context, tableName, created, args);
	}

	await builder;
	return reloadRecord(
		context,
		tableName,
		args.data as Record<string, unknown>,
		args,
	);
};

export const createManyRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CreateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<Record<string, unknown>>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const builder = context.db.insert(runtime.table).values(args.data);

	if (typeof builder.returning !== 'function') {
		await builder;
		return { count: args.data.length };
	}

	const rows = await builder.returning();
	if (!rows.length) return { count: args.data.length };
	if (!hasProjection(args)) return { count: args.data.length, data: rows };

	const data = await reloadRecords(context, tableName, rows, args);
	return { count: args.data.length, data: data.length ? data : undefined };
};

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

export const paginateRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const { take, query } = buildPaginationQuery(args);
	const [data, total] = await Promise.all([
		findManyRecords(context, tableName, query),
		countRows(context, tableName, args.where),
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
