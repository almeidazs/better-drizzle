import { is, Param, Placeholder, SQL, sql } from 'drizzle-orm';

import type {
	AnySchema,
	BetterTableKey,
	CursorArgs,
	PaginationArgs,
	PreparedParam,
	QueryArgs,
	RuntimeContext,
	SelectQueryLike,
	TableRuntime,
} from '../../types';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';
import { buildCountQuery, buildCursorPaginationQuery } from '../query';
import { getTableRuntime } from './context';
import {
	buildCursorPage,
	buildExistsQuery,
	buildFindFirstQuery,
	buildFindManyQuery,
	finishCursorPage,
	normalizeLockError,
	projectCursorProbe,
} from './operations';
import { hydrateRelations, prepareRelationalRead } from './relations';

type Values = Record<string, unknown>;
type Rows = Record<string, unknown>[];
type Run = (values: Values) => Promise<unknown>;

export type PreparedReadKind =
	| 'count'
	| 'cursor'
	| 'exists'
	| 'findFirst'
	| 'findMany'
	| 'findOne'
	| 'findUnique'
	| 'paginate';

// Internal values derived from user params right before execution.
const TAKE_PARAM = '__betterDrizzleTake';
const OFFSET_PARAM = '__betterDrizzleOffset';
const CURSOR_PARAM = '__betterDrizzleCursor';

/**
 * Declares a named value of a prepared statement. Use it anywhere a read
 * accepts a value (`where` filters, `take`, `skip`, `page`, `perPage`,
 * `after`, `before`), then supply it to `execute()`.
 *
 * @example
 * ```ts
 * const byEmail = db.user
 *   .findUnique({ where: { email: param('email') } })
 *   .prepare('user-by-email');
 *
 * await byEmail.execute({ email: 'alice@example.com' });
 * ```
 */
export const param = <const Name extends string, Value = never>(name: Name) =>
	sql.placeholder(name) as unknown as PreparedParam<Name, Value>;

const isPlainValue = (value: object) => {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null || Array.isArray(value);
};

/** Appends the param names found in `value` to `names`, once each. */
const collectParams = (value: unknown, names: string[]) => {
	if (typeof value !== 'object' || value === null) return;
	if (value instanceof Placeholder) {
		if (!names.includes(value.name)) names.push(value.name);
		return;
	}
	if (is(value, SQL)) {
		for (const chunk of value.queryChunks) collectParams(chunk, names);
		return;
	}
	if (is(value, Param)) return collectParams(value.value, names);
	if (!isPlainValue(value)) return;
	for (const key in value) collectParams((value as Values)[key], names);
};

/** Copies `value` with every param replaced by its execution value. */
export const fillParams = (value: unknown, values: Values): unknown => {
	if (typeof value !== 'object' || value === null) return value;
	if (value instanceof Placeholder) return values[value.name];
	if (!isPlainValue(value)) return value;
	if (Array.isArray(value))
		return value.map((entry) => fillParams(entry, values));
	const copy = Object.create(Object.getPrototypeOf(value)) as Values;
	for (const key in value)
		copy[key] = fillParams((value as Values)[key], values);
	return copy;
};

const preparedError = (
	code: BetterDrizzleErrorCode,
	message: string,
	runtime: TableRuntime,
	operation: string,
	details?: Record<string, unknown>,
) =>
	new BetterDrizzleError({
		code,
		details,
		message,
		operation,
		table: runtime.dbName,
	});

/**
 * Rejects missing and unknown values. Counting keys first keeps the common
 * case to one pass over `values`.
 */
const checkParams = (
	names: readonly string[],
	values: Values | undefined,
	runtime: TableRuntime,
	operation: string,
) => {
	const input = values ?? {};
	for (const name of names)
		if (input[name] === undefined)
			throw preparedError(
				BetterDrizzleErrorCode.PreparedParamMissing,
				`Missing value for param "${name}" in prepared ${operation} on "${runtime.dbName}".`,
				runtime,
				operation,
				{ param: name },
			);

	let size = 0;
	for (const _ in input) size += 1;
	if (size === names.length) return;

	for (const key in input)
		if (!names.includes(key))
			throw preparedError(
				BetterDrizzleErrorCode.PreparedParamUnknown,
				`Unknown param "${key}" in prepared ${operation} on "${runtime.dbName}".`,
				runtime,
				operation,
				{ param: key, params: names },
			);
};

const prepareQuery = (
	context: RuntimeContext<AnySchema, unknown>,
	query: unknown,
	name: string | undefined,
): ((values: Values) => Rows | Promise<Rows>) => {
	const builder = query as {
		prepare(name?: string): {
			all(values: Values): Rows | Promise<Rows>;
			execute(values: Values): Promise<Rows>;
		};
	};
	if (context.dialect === 'sqlite') {
		const statement = builder.prepare();
		return (values) => statement.all(values);
	}
	const statement =
		context.dialect === 'pg' ? builder.prepare(name) : builder.prepare();
	return (values) => statement.execute(values);
};

const childName = (name: string | undefined, suffix: string) =>
	name === undefined ? undefined : `${name}:${suffix}`;

const prepareRows = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: QueryArgs<Schema, BetterTableKey<Schema>, Meta> | undefined,
	name: string | undefined,
	operation: string,
	single: boolean,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const relational = args?.lock
		? undefined
		: prepareRelationalRead(context, tableName, args);
	if (relational) {
		const nested: string[] = [];
		// `_count` compiles into the root query, so its params are prepared.
		for (const key in relational.source)
			if (key !== '_count') collectParams(relational.source[key], nested);
		if (nested.length)
			throw preparedError(
				BetterDrizzleErrorCode.PreparedUnsupported,
				`param() is not supported inside relation include/select on "${runtime.dbName}": relations load with their own queries on every execution.`,
				runtime,
				operation,
				{ params: nested },
			);
	}
	const query = single
		? buildFindFirstQuery(context, tableName, args, operation)
		: buildFindManyQuery(context, tableName, args, operation);
	const exec = prepareQuery(
		context as RuntimeContext<AnySchema, unknown>,
		query,
		name,
	);
	const lock = args?.lock;
	if (!lock && !relational) return exec;

	return async (values: Values): Promise<Rows> => {
		let rows: Rows;
		if (lock)
			try {
				rows = await exec(values);
			} catch (error) {
				throw normalizeLockError(error, runtime, operation, lock);
			}
		else rows = await exec(values);
		if (!relational) return rows;
		return hydrateRelations(
			context,
			runtime,
			rows,
			args as QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
			relational.source,
		);
	};
};

const prepareCount = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: { cursor?: unknown; where?: unknown } | undefined,
	name: string | undefined,
) => {
	const exec = prepareQuery(
		context as RuntimeContext<AnySchema, unknown>,
		buildCountQuery(
			context,
			tableName,
			args?.where as never,
			args?.cursor as never,
		),
		name,
	);
	return async (values: Values) =>
		Number((await exec(values))[0]?.count ?? 0);
};

const pageError = (runtime: TableRuntime, page: unknown, skip: unknown) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.InvalidArgs,
		details: { page, skip },
		message:
			skip === undefined
				? 'paginate() page must be an integer greater than or equal to 1.'
				: 'paginate() accepts either page or skip, but not both.',
		operation: 'paginate',
		table: runtime.dbName,
	});

const isPage = (page: unknown): page is number =>
	Number.isInteger(page) && (page as number) >= 1;

const paramName = (value: unknown) =>
	value instanceof Placeholder ? (value.name as string) : undefined;

const preparePaginate = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
	name: string | undefined,
	runtime: TableRuntime,
	check: (values: Values) => void,
): Run => {
	const take = args.take ?? args.perPage ?? args.limit ?? 10;
	const { page, skip } = args;
	if (
		page !== undefined &&
		(skip !== undefined || !(page instanceof Placeholder || isPage(page)))
	)
		throw pageError(runtime, page, skip);

	const takeName = paramName(take);
	const pageName = paramName(page);
	const skipName = paramName(skip);
	const offset =
		page === undefined
			? (skip ?? 0)
			: pageName || takeName
				? sql.placeholder(OFFSET_PARAM)
				: ((page as number) - 1) * (take as number);
	const data = prepareRows(
		context,
		tableName,
		{ ...args, skip: offset, take } as QueryArgs<
			Schema,
			BetterTableKey<Schema>,
			Meta
		>,
		name,
		'paginate',
		false,
	);
	const count = prepareCount(
		context,
		tableName,
		{ where: args.where },
		childName(name, 'count'),
	);

	return async (values) => {
		check(values);
		const perPage = (takeName ? values[takeName] : take) as number;
		const pageValue = pageName ? values[pageName] : page;
		if (pageName && !isPage(pageValue))
			throw pageError(runtime, pageValue, undefined);
		const skipValue = (
			pageValue === undefined
				? skipName
					? values[skipName]
					: (skip ?? 0)
				: ((pageValue as number) - 1) * perPage
		) as number;
		const [rows, total] = await Promise.all([
			data(
				page !== undefined && (pageName || takeName)
					? { ...values, [OFFSET_PARAM]: skipValue }
					: values,
			),
			count(values),
		]);

		return {
			data: rows,
			pagination: {
				type: 'offset' as const,
				page: Math.floor(skipValue / perPage) + 1,
				perPage,
				total,
				pageCount: total === 0 ? 0 : Math.ceil(total / perPage),
				hasNext: skipValue + rows.length < total,
				hasPrevious: skipValue > 0,
			},
		};
	};
};

const prepareCursor = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	cursorArgs: CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
	name: string | undefined,
	runtime: TableRuntime,
	check: (values: Values) => void,
): Run => {
	const limitInput = cursorArgs.limit ?? cursorArgs.take;
	const limitName = paramName(limitInput);
	const limit = limitName ? 0 : Math.abs((limitInput as number) ?? 10) || 10;
	const cursor = cursorArgs.after ?? cursorArgs.before;
	const cursorName = paramName(cursor);
	const primaryKey = runtime.primaryKeyFields[0];
	// A prepared cursor carries no keys to infer the order from.
	const args =
		cursorName && !cursorArgs.orderBy && primaryKey
			? ({
					...cursorArgs,
					orderBy: { [primaryKey]: 'asc' },
				} as typeof cursorArgs)
			: cursorArgs;
	const page = buildCursorPage(
		context,
		tableName,
		args,
		limitName ? sql.placeholder(TAKE_PARAM) : limit + 1,
	);
	const data = page.fastQuery
		? prepareQuery(
				context as RuntimeContext<AnySchema, unknown>,
				page.fastQuery,
				name,
			)
		: prepareRows(
				context,
				tableName,
				page.queryArgs,
				name,
				'cursor',
				false,
			);

	// Probes resolve hasPrevious / hasNext from a row of the current page.
	const probeKey = args.after ? 'before' : args.before ? 'after' : undefined;
	const prepareProbe = (value: unknown, suffix: string) =>
		prepareRows(
			context,
			tableName,
			projectCursorProbe(
				context,
				tableName,
				buildCursorPaginationQuery(
					{
						...page.args,
						after: undefined,
						before: undefined,
						limit: 1,
						[probeKey as string]: value,
					},
					1,
				).query as QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
			),
			childName(name, suffix),
			'cursor',
			false,
		);
	const probe = probeKey
		? prepareProbe(sql.placeholder(CURSOR_PARAM), 'probe')
		: undefined;
	const probeAll = probeKey
		? prepareProbe(undefined, 'probe-all')
		: undefined;
	const fields = page.fields;
	const hasPage = async (
		_context: unknown,
		_tableName: unknown,
		next: { after?: unknown; before?: unknown },
		values?: Values,
	) => {
		const token = next.before ?? next.after;
		const rows = await (token === undefined
			? (probeAll as (values: Values) => Promise<Rows>)(values as Values)
			: (probe as (values: Values) => Promise<Rows>)({
					...values,
					[CURSOR_PARAM]: token,
				}));
		return rows.length > 0;
	};

	return async (values) => {
		check(values);
		if (cursorName) {
			const token = values[cursorName];
			if (
				typeof token !== 'object' ||
				token === null ||
				Array.isArray(token)
			)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.InvalidArgs,
					details: { param: cursorName },
					message: `cursor() ${cursorArgs.after ? 'after' : 'before'} must be a cursor object.`,
					operation: 'cursor',
					table: runtime.dbName,
				});
		}
		const size = limitName
			? Math.abs(values[limitName] as number) || 10
			: limit;
		const rows = (await data(
			limitName ? { ...values, [TAKE_PARAM]: size + 1 } : values,
		)) as Rows;

		return finishCursorPage(
			context,
			tableName,
			page.args,
			page.direction,
			rows,
			size,
			Boolean(page.fastQuery),
			hasPage as never,
			values,
			fields,
		);
	};
};

/**
 * Compiles a read once into Drizzle prepared statements. The returned
 * runner checks the execution values, runs the statements, and applies the
 * same result shaping as the regular read.
 */
export const prepareRead = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	kind: PreparedReadKind,
	args: Record<string, unknown>,
	name: string | undefined,
): {
	check: (values: Values) => void;
	names: readonly string[];
	run: Run;
} => {
	const runtime = getTableRuntime(context, tableName as string);
	const names: string[] = [];
	collectParams(args, names);
	const check = (values: Values) => checkParams(names, values, runtime, kind);

	if (kind === 'paginate')
		return {
			check,
			names,
			run: preparePaginate(
				context,
				tableName,
				args as PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
				name,
				runtime,
				check,
			),
		};
	if (kind === 'cursor')
		return {
			check,
			names,
			run: prepareCursor(
				context,
				tableName,
				args as CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
				name,
				runtime,
				check,
			),
		};
	if (kind === 'count') {
		const count = prepareCount(context, tableName, args, name);
		return {
			check,
			names,
			run: async (values) => {
				check(values);
				return count(values);
			},
		};
	}
	if (kind === 'exists') {
		const exec = prepareQuery(
			context as RuntimeContext<AnySchema, unknown>,
			(
				buildExistsQuery(
					context,
					tableName,
					args,
				) as unknown as SelectQueryLike
			).limit(1),
			name,
		);
		return {
			check,
			names,
			run: async (values) => {
				check(values);
				return (await exec(values)).length > 0;
			},
		};
	}

	const single = kind !== 'findMany';
	const rows = prepareRows(
		context,
		tableName,
		args as QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
		name,
		kind,
		single,
	);
	return {
		check,
		names,
		run: single
			? async (values) => {
					check(values);
					return (await rows(values))[0] ?? null;
				}
			: async (values) => {
					check(values);
					return rows(values);
				},
	};
};
