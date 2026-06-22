import type {
	AnySchema,
	BatchResult,
	BetterTableKey,
	CompilableWhere,
	CreateManyArgs,
	DeleteArgs,
	DeleteManyArgs,
	PaginationArgs,
	QueryArgs,
	RuntimeContext,
	UpdateArgs,
	UpdateManyArgs,
	WhereArg,
	WhereCompilerContext,
} from '../../types';
import { PaginationType } from '../../types';
import {
	buildPaginationQuery,
	buildQueryConfig,
	compileWhereInput,
	countRows,
} from '../query';
import { getPrimaryKeyWhere, getTableRuntime } from './context';

const makeWhereContext = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
) => {
	const runtime = getTableRuntime(context, tableName as string);

	return {
		runtime,
		whereContext: {
			...context,
			tableName: tableName as string,
			table: runtime.table,
			tableConfig: runtime.tableConfig,
		} as WhereCompilerContext<Schema, Meta>,
	};
};

export const findFirstRecord = async <Schema extends AnySchema, Meta>(
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

export const reloadRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	record: Record<string, unknown>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const { runtime } = makeWhereContext(context, tableName);
	const primaryKeyWhere = getPrimaryKeyWhere(runtime.tableConfig, record);
	const where =
		Object.keys(primaryKeyWhere).length > 0
			? primaryKeyWhere
			: Object.fromEntries(
					Object.entries(record).filter(
						([, value]) => value !== undefined,
					),
				);
	const rows = await context.db.query[tableName].findMany(
		buildQueryConfig(context, tableName, {
			...args,
			where: where as WhereArg<Schema, BetterTableKey<Schema>>,
			take: 1,
		}),
	);

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
	args: { data: Record<string, unknown> } & QueryArgs<
		Schema,
		BetterTableKey<Schema>,
		Meta
	>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const builder = context.db.insert(runtime.table).values(args.data);

	if (typeof builder.returning === 'function') {
		const rows = await builder.returning();
		const created = rows[0];
		if (created) return reloadRecord(context, tableName, created, args);
	}

	await builder;
	return reloadRecord(context, tableName, args.data, args);
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
	const data = rows.length
		? await reloadRecords(context, tableName, rows, args)
		: undefined;

	return {
		count: args.data.length,
		data: data?.length ? data : undefined,
	};
};

export const updateRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpdateArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const existing = await findFirstRecord(context, tableName, {
		where: args.where,
	});
	if (!existing) return null;

	const { runtime, whereContext } = makeWhereContext(context, tableName);
	const predicate = compileWhereInput(
		whereContext,
		getPrimaryKeyWhere(runtime.tableConfig, existing),
	);

	await context.db.update(runtime.table).set(args.data).where(predicate);
	return reloadRecord(context, tableName, existing, args);
};

export const deleteRecord = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: DeleteArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const existing = await findFirstRecord(context, tableName, args);
	if (!existing) return null;

	const { runtime, whereContext } = makeWhereContext(context, tableName);
	const predicate = compileWhereInput(
		whereContext,
		getPrimaryKeyWhere(runtime.tableConfig, existing),
	);

	await context.db.delete(runtime.table).where(predicate);
	return existing;
};

export const updateManyRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: UpdateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
): Promise<BatchResult<never>> => {
	const { runtime, whereContext } = makeWhereContext(context, tableName);
	const predicate = compileWhereInput(
		whereContext,
		args.where as CompilableWhere | undefined,
	);
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
	const { runtime, whereContext } = makeWhereContext(context, tableName);
	const predicate = compileWhereInput(
		whereContext,
		args?.where as CompilableWhere | undefined,
	);
	const affectedCount = await countRows(context, tableName, args?.where);

	if (affectedCount > 0)
		await context.db.delete(runtime.table).where(predicate);

	return { count: affectedCount };
};

export const paginateRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const { take, query } = buildPaginationQuery(args);
	const [data, total] = await Promise.all([
		context.db.query[tableName].findMany(
			buildQueryConfig(context, tableName, query),
		),
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
