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
	AnySchema,
	BetterClientHooks,
	BetterClientOptions,
	BetterDrizzleClient,
	BetterRelationalConfig,
	BetterTableKey,
	CursorInput,
	DeleteArgs,
	OrderByInput,
	PaginationArgs,
	QueryArgs,
	UpdateArgs,
	UpsertArgs,
	WhereInput,
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

type RuntimeContext<Schema extends AnySchema> = {
	db: DrizzleLikeDatabase;
	options: BetterClientOptions<Schema>;
	fullSchema: Schema;
	relational: RuntimeSchema;
};

type WhereCompilerContext<Schema extends AnySchema> = RuntimeContext<Schema> & {
	tableName: string;
	table: Table;
	tableConfig: BetterRelationalConfig;
	rootArgs?: QueryArgs<Schema, BetterTableKey<Schema>>;
};

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

const getTableRuntime = <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
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

const compileRelationFilter = <Schema extends AnySchema>(
	context: WhereCompilerContext<Schema>,
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
		const nestedContext: WhereCompilerContext<Schema> = {
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

const compileWhereInput = <Schema extends AnySchema>(
	context: WhereCompilerContext<Schema>,
	where?: Record<string, unknown>,
): SQL | undefined => {
	if (!where) {
		return undefined;
	}

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

const compileOrderBy = <Schema extends AnySchema>(
	context: WhereCompilerContext<Schema>,
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

const compileCursorWhere = <Schema extends AnySchema>(
	context: WhereCompilerContext<Schema>,
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

const buildQueryConfig = <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const whereContext: WhereCompilerContext<Schema> = {
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
						value as QueryArgs<Schema, BetterTableKey<Schema>>,
					),
				];
			}),
	);

	if (Object.keys(withConfig).length > 0) {
		config.with = withConfig;
	}

	const where = compileWhereInput(
		whereContext,
		args?.where as Record<string, unknown> | undefined,
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

const applyCreateHooks = async (hooks?: BetterClientHooks) => {
	await hooks?.beforeCreate?.();
};

const applyAfterCreateHooks = async (hooks?: BetterClientHooks) => {
	await hooks?.afterCreate?.();
};

const reloadByRecord = async <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	tableName: BetterTableKey<Schema>,
	record: Record<string, unknown>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>>,
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
		where: where as WhereInput<Schema, BetterTableKey<Schema>>,
		take: 1,
	});

	const rows = await context.db.query[tableName].findMany(queryConfig);
	return (rows[0] ?? null) as Record<string, unknown> | null;
};

const findFirstInternal = async <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>>,
) => {
	const rows = await context.db.query[tableName].findMany(
		buildQueryConfig(context, tableName, {
			...args,
			take: args?.take ?? 1,
		}),
	);
	return (rows[0] ?? null) as Record<string, unknown> | null;
};

const createInternal = async <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	tableName: BetterTableKey<Schema>,
	args: { data: Record<string, unknown> } & QueryArgs<
		Schema,
		BetterTableKey<Schema>
	>,
) => {
	await applyCreateHooks(context.options.hooks);
	const runtime = getTableRuntime(context, tableName as string);
	const builder = context.db.insert(runtime.table).values(args.data);

	let created: Record<string, unknown> | null = null;

	if (typeof builder.returning === 'function') {
		const rows = await builder.returning();
		created = rows[0] ?? null;
	} else {
		await builder;
	}

	await applyAfterCreateHooks(context.options.hooks);

	return created
		? reloadByRecord(context, tableName, created, args)
		: reloadByRecord(context, tableName, args.data, args);
};

const updateInternal = async <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	tableName: BetterTableKey<Schema>,
	args: UpdateArgs<Schema, BetterTableKey<Schema>>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const existing = await findFirstInternal(context, tableName, {
		where: args.where,
	});
	if (!existing) {
		throw new Error(
			`No record found for update on "${String(tableName)}".`,
		);
	}

	const pkWhere = getPrimaryKeyWhere(runtime.tableConfig, existing);
	const whereContext: WhereCompilerContext<Schema> = {
		...context,
		tableName: tableName as string,
		table: runtime.table,
		tableConfig: runtime.tableConfig,
	};
	const predicate = compileWhereInput(whereContext, pkWhere);

	await context.db.update(runtime.table).set(args.data).where(predicate);

	return reloadByRecord(context, tableName, existing, args);
};

const deleteInternal = async <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	tableName: BetterTableKey<Schema>,
	args: DeleteArgs<Schema, BetterTableKey<Schema>>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const existing = await findFirstInternal(context, tableName, args);
	if (!existing) {
		throw new Error(
			`No record found for delete on "${String(tableName)}".`,
		);
	}

	const pkWhere = getPrimaryKeyWhere(runtime.tableConfig, existing);
	const whereContext: WhereCompilerContext<Schema> = {
		...context,
		tableName: tableName as string,
		table: runtime.table,
		tableConfig: runtime.tableConfig,
	};
	const predicate = compileWhereInput(whereContext, pkWhere);

	await context.db.delete(runtime.table).where(predicate);
	return existing;
};

const countInternal = async <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	tableName: BetterTableKey<Schema>,
	where?: WhereInput<Schema, BetterTableKey<Schema>>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const whereContext: WhereCompilerContext<Schema> = {
		...context,
		tableName: tableName as string,
		table: runtime.table,
		tableConfig: runtime.tableConfig,
	};
	const predicate = compileWhereInput(
		whereContext,
		where as Record<string, unknown> | undefined,
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

const paginateInternal = async <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	tableName: BetterTableKey<Schema>,
	args: PaginationArgs<Schema, BetterTableKey<Schema>>,
) => {
	const limit = args.limit ?? args.take ?? 10;
	const take = args.take ?? limit;

	let cursorArgs: QueryArgs<Schema, BetterTableKey<Schema>> = {
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

const makeModelDelegate = <Schema extends AnySchema>(
	context: RuntimeContext<Schema>,
	tableName: BetterTableKey<Schema>,
) => {
	return {
		count: (args?: {
			where?: WhereInput<Schema, BetterTableKey<Schema>>;
		}) => countInternal(context, tableName, args?.where),
		exists: async (args?: {
			where?: WhereInput<Schema, BetterTableKey<Schema>>;
		}) => {
			const total = await countInternal(context, tableName, args?.where);
			return total > 0;
		},
		findMany: (args?: QueryArgs<Schema, BetterTableKey<Schema>>) =>
			context.db.query[tableName].findMany(
				buildQueryConfig(context, tableName, args),
			),
		findFirst: (args?: QueryArgs<Schema, BetterTableKey<Schema>>) =>
			findFirstInternal(context, tableName, args),
		findOne: (args?: QueryArgs<Schema, BetterTableKey<Schema>>) =>
			findFirstInternal(context, tableName, args),
		findUnique: (args: QueryArgs<Schema, BetterTableKey<Schema>>) =>
			findFirstInternal(context, tableName, args),
		create: (args: { data: Record<string, unknown> }) =>
			createInternal(context, tableName, args),
		update: (args: UpdateArgs<Schema, BetterTableKey<Schema>>) =>
			updateInternal(context, tableName, args),
		delete: (args: DeleteArgs<Schema, BetterTableKey<Schema>>) =>
			deleteInternal(context, tableName, args),
		upsert: async (args: UpsertArgs<Schema, BetterTableKey<Schema>>) => {
			const existing = await findFirstInternal(context, tableName, {
				where: args.where,
			});
			return existing
				? updateInternal(context, tableName, {
						where: args.where,
						data: args.update,
						select: args.select,
						include: args.include,
					})
				: createInternal(context, tableName, {
						data: args.create as Record<string, unknown>,
						select: args.select,
						include: args.include,
					});
		},
		paginate: (args: PaginationArgs<Schema, BetterTableKey<Schema>>) =>
			paginateInternal(context, tableName, args),
	};
};

export const createBetterClient = <Schema extends AnySchema>(
	drizzleDb: unknown,
	options: BetterClientOptions<Schema>,
) => {
	const db = drizzleDb as DrizzleLikeDatabase;
	const relational = extractTablesRelationalConfig(
		options.schema,
		createTableRelationsHelpers,
	);
	const context: RuntimeContext<Schema> = {
		db,
		options,
		fullSchema: options.schema,
		relational,
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

	client.repository = (name: string) => {
		const repository = repositories[name];

		if (!repository) throw new Error(`Repository "${name}" not found.`);

		return repository;
	};

	return client as BetterDrizzleClient<Schema>;
};
