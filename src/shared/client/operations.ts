import {
	type AnyColumn,
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	isNull,
	lt,
	lte,
	type SQL,
	sql,
} from 'drizzle-orm';
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
	SelectQueryLike,
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
import {
	applyRelationWrites,
	getRelationCountSelection,
	hasRelationWrites,
	hydrateRelations,
	prepareRelationalRead,
	prepareRelationWrite,
	splitRelationData,
} from './relations';

type ResolvedSkipDuplicates = {
	enabled: boolean;
	targets?: string[];
};

type LockStrength = 'update' | 'share' | 'no key update' | 'key share';

type ResolvedLockOption = {
	noWait?: true;
	skipLocked?: true;
	strength: LockStrength;
	tables?: TableRuntime[];
};

const LOCK_STRENGTH_MAP = {
	keyShare: 'key share',
	noKeyUpdate: 'no key update',
	share: 'share',
	update: 'update',
} as const satisfies Record<string, LockStrength>;

type PgArrayColumn = AnyColumn & {
	baseColumn: AnyColumn;
	columnType?: string;
	getSQLType(): string;
};

type ArrayMutationName =
	| 'addUnique'
	| 'append'
	| 'prepend'
	| 'remove'
	| 'replace';

const ARRAY_MUTATION_NAMES = new Set<ArrayMutationName>([
	'addUnique',
	'append',
	'prepend',
	'remove',
	'replace',
]);

const compiledUpdateSets = new WeakMap<
	object,
	Readonly<Record<string, unknown>>
>();

const rememberCompiledUpdate = <T extends Record<string, unknown>>(
	input: object,
	compiled: T,
	changed: boolean,
) => {
	if (changed) compiledUpdateSets.set(input, compiled);
	return compiled;
};

export const getCompiledUpdateSet = (input: unknown) =>
	typeof input === 'object' && input !== null
		? compiledUpdateSets.get(input)
		: undefined;

const isPgArrayColumn = (column: AnyColumn): column is PgArrayColumn =>
	(column as { columnType?: string }).columnType === 'PgArray';

const arrayMutationError = (
	runtime: TableRuntime,
	column: string,
	operation: string,
	message: string,
	details?: Record<string, unknown>,
) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.OperationError,
		column,
		details,
		message,
		operation,
		table: runtime.dbName,
	});

const getPgArrayDepth = (column: PgArrayColumn) => {
	let depth = 1;
	let current = column.baseColumn;

	while (isPgArrayColumn(current)) {
		depth += 1;
		current = current.baseColumn;
	}

	return depth;
};

const hasNullArrayElement = (value: unknown): boolean => {
	if (value === null || value === undefined) return true;
	if (!Array.isArray(value)) return false;

	for (const entry of value) if (hasNullArrayElement(entry)) return true;

	return false;
};

const getArrayMutationValues = (
	runtime: TableRuntime,
	columnName: string,
	column: PgArrayColumn,
	operation: string,
	name: ArrayMutationName,
	value: unknown,
) => {
	const elementDepth = getPgArrayDepth(column) - 1;
	let current = value;

	for (let index = 0; index < elementDepth; index += 1) {
		if (!Array.isArray(current)) break;
		current = current[0];
	}

	const values: unknown[] = Array.isArray(current)
		? (value as unknown[])
		: [value];
	if (!values.length)
		throw arrayMutationError(
			runtime,
			columnName,
			operation,
			`${name} requires at least one array element.`,
		);
	if (values.some(hasNullArrayElement))
		throw arrayMutationError(
			runtime,
			columnName,
			operation,
			`${name} does not support null array elements.`,
		);

	return values;
};

const getArrayMutationPairs = (
	runtime: TableRuntime,
	columnName: string,
	operation: string,
	value: unknown,
) => {
	const pairs = Array.isArray(value) ? value : [value];
	if (!pairs.length)
		throw arrayMutationError(
			runtime,
			columnName,
			operation,
			'replace requires at least one { from, to } pair.',
		);

	const result = new Array<{ from: unknown; to: unknown }>(pairs.length);
	for (let index = 0; index < pairs.length; index += 1) {
		const pair = pairs[index];
		if (
			!isSimpleRecord(pair) ||
			Object.keys(pair).length !== 2 ||
			!('from' in pair) ||
			!('to' in pair) ||
			hasNullArrayElement(pair.from) ||
			hasNullArrayElement(pair.to)
		)
			throw arrayMutationError(
				runtime,
				columnName,
				operation,
				'replace requires non-null { from, to } pairs.',
				{ index },
			);

		result[index] = { from: pair.from, to: pair.to };
	}

	return result;
};

const compileArrayMutation = (
	runtime: TableRuntime,
	columnName: string,
	column: PgArrayColumn,
	dialect: string,
	operation: string,
	value: Record<string, unknown>,
) => {
	const keys = Object.keys(value);
	const name = keys.find((key): key is ArrayMutationName =>
		ARRAY_MUTATION_NAMES.has(key as ArrayMutationName),
	);

	if (!name)
		throw arrayMutationError(
			runtime,
			columnName,
			operation,
			`Invalid PostgreSQL array mutation for column "${columnName}".`,
		);
	if (keys.length !== 1)
		throw arrayMutationError(
			runtime,
			columnName,
			operation,
			'PostgreSQL array mutations must specify exactly one operation.',
		);
	if (dialect !== 'pg')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.ArrayMutationUnsupported,
			column: columnName,
			dialect,
			message:
				'Native PostgreSQL array mutations are only supported by PostgreSQL.',
			operation,
			table: runtime.dbName,
		});

	const input = value[name];
	const baseColumn = column.baseColumn;
	if (name === 'replace') {
		let expression = sql`${column}`;
		for (const pair of getArrayMutationPairs(
			runtime,
			columnName,
			operation,
			input,
		))
			expression = sql`array_replace(${expression}, ${sql.param(
				pair.from,
				baseColumn,
			)}, ${sql.param(pair.to, baseColumn)})`;
		return expression;
	}

	const values = getArrayMutationValues(
		runtime,
		columnName,
		column,
		operation,
		name,
		input,
	);
	if (name === 'append')
		return values.length === 1
			? sql`array_append(${column}, ${sql.param(values[0], baseColumn)})`
			: sql`array_cat(${column}, ${sql.param(values, column)})`;
	if (name === 'prepend')
		return values.length === 1
			? sql`array_prepend(${sql.param(values[0], baseColumn)}, ${column})`
			: sql`array_cat(${sql.param(values, column)}, ${column})`;

	if (name === 'addUnique') {
		const items = sql.raw('array_mutation_item');
		const positions = sql.raw('array_mutation_position');
		const input = sql.raw('array_mutation_input');
		const missing = sql.raw('array_mutation_missing');
		const empty = sql`${column}[0:0]`;
		const parameter = sql`${sql.param(values, column)}::${sql.raw(column.getSQLType())}`;
		const additions = sql`(select array_agg(${items} order by ${positions}) from (select ${items}, min(${positions}) as ${positions} from unnest(${parameter}) with ordinality as ${input}(${items}, ${positions}) where not (${column} @> array[${items}]) group by ${items}) as ${missing})`;

		return sql`case when ${column} is null then ${column} else array_cat(${column}, coalesce(${additions}, ${empty})) end`;
	}

	let expression = sql`${column}`;
	for (const entry of values) {
		expression = sql`array_remove(${expression}, ${sql.param(
			entry,
			baseColumn,
		)})`;
	}

	return expression;
};

const compilePgArrayMutations = (
	runtime: TableRuntime,
	dialect: string,
	operation: string,
	data: Record<string, unknown>,
) => {
	let result: Record<string, unknown> | undefined;

	for (const key in data) {
		const value = data[key];
		if (!isSimpleRecord(value) || isSQLWrapper(value)) continue;

		const column = runtime.columns[key];
		if (!column || !isPgArrayColumn(column)) continue;

		const mutation = compileArrayMutation(
			runtime,
			key,
			column,
			dialect,
			operation,
			value,
		);
		if (!result) result = { ...data };
		result[key] = mutation;
	}

	return result ?? data;
};

const NUMERIC_MUTATION_NAMES = [
	'set',
	'increment',
	'decrement',
	'multiply',
	'divide',
] as const;

const numericMutationError = (
	runtime: TableRuntime,
	column: string,
	operation: string,
	message: string,
) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.OperationError,
		column,
		message,
		operation,
		table: runtime.dbName,
	});

const compileScalarMutation = (
	runtime: TableRuntime,
	columnName: string,
	column: AnyColumn,
	operation: string,
	value: Record<string, unknown>,
) => {
	if (column.dataType === 'boolean') {
		const keys = Object.keys(value);
		if (keys.length !== 1 || value.toggle !== true)
			throw numericMutationError(
				runtime,
				columnName,
				operation,
				'Boolean mutations must specify only toggle: true.',
			);
		return sql`not ${column}`;
	}

	const keys = Object.keys(value);
	if (!keys.length)
		throw numericMutationError(
			runtime,
			columnName,
			operation,
			'Numeric mutations must specify at least one operation.',
		);
	for (const key of keys)
		if (!NUMERIC_MUTATION_NAMES.includes(key as never))
			throw numericMutationError(
				runtime,
				columnName,
				operation,
				`Invalid numeric mutation operation "${key}".`,
			);

	let expression: SQL = sql`${column}`;
	let hasOperation = false;
	for (const name of NUMERIC_MUTATION_NAMES) {
		const input = value[name];
		if (input === undefined) continue;
		hasOperation = true;
		if (typeof input !== 'number' || !Number.isFinite(input))
			throw numericMutationError(
				runtime,
				columnName,
				operation,
				`${name} must be a finite number.`,
			);
		if (name === 'divide' && input === 0)
			throw numericMutationError(
				runtime,
				columnName,
				operation,
				'divide cannot be zero.',
			);

		const parameter = sql.param(input, column);
		if (name === 'set') expression = sql`${parameter}`;
		else if (name === 'increment')
			expression = sql`${expression} + ${parameter}`;
		else if (name === 'decrement')
			expression = sql`${expression} - ${parameter}`;
		else if (name === 'multiply')
			expression = sql`${expression} * ${parameter}`;
		else expression = sql`${expression} / ${parameter}`;
	}
	if (!hasOperation)
		throw numericMutationError(
			runtime,
			columnName,
			operation,
			'Numeric mutations must specify at least one operation.',
		);

	return expression;
};

export const compileUpdateMutations = (
	runtime: TableRuntime,
	dialect: string,
	operation: string,
	data: Record<string, unknown>,
) => {
	const arrayMutations = compilePgArrayMutations(
		runtime,
		dialect,
		operation,
		data,
	);
	let result = arrayMutations === data ? undefined : arrayMutations;

	for (const key in data) {
		const value = data[key];
		if (!isSimpleRecord(value) || isSQLWrapper(value)) continue;
		const column = runtime.columns[key];
		if (!column || isPgArrayColumn(column)) continue;
		if (column.dataType !== 'number' && column.dataType !== 'boolean')
			continue;

		const mutation = compileScalarMutation(
			runtime,
			key,
			column,
			operation,
			value,
		);
		if (!result) result = { ...data };
		result[key] = mutation;
	}

	return rememberCompiledUpdate(data, result ?? data, Boolean(result));
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

	for (const targetName of targets as readonly string[]) {
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
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	byKey: string,
	args: UpdateEachArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const byColumn = runtime.columns[byKey];
	const updates = args.update as Record<string, unknown>;
	const set = Object.create(null) as Record<string, unknown>;
	let hasColumns = false;
	let hasMutations = false;

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

			const arrayMutation =
				isPgArrayColumn(column) &&
				isSimpleRecord(nextValue) &&
				!isSQLWrapper(nextValue)
					? compileArrayMutation(
							runtime,
							key,
							column,
							context.dialect,
							'updateEach',
							nextValue,
						)
					: undefined;
			const scalarMutation =
				!arrayMutation &&
				isSimpleRecord(nextValue) &&
				!isSQLWrapper(nextValue) &&
				!isPgArrayColumn(column) &&
				(column.dataType === 'number' || column.dataType === 'boolean')
					? compileScalarMutation(
							runtime,
							key,
							column,
							'updateEach',
							nextValue,
						)
					: undefined;
			if (arrayMutation || scalarMutation) hasMutations = true;
			branches[index] = sql`when ${byColumn} = ${row[byKey]} then ${
				arrayMutation ??
				scalarMutation ??
				(isSQLWrapper(nextValue)
					? nextValue
					: sql.param(nextValue, column))
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

	return rememberCompiledUpdate(args.update as object, set, hasMutations);
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
	context?: RuntimeContext<AnySchema, unknown>,
	include?: unknown,
) => {
	const counts = context
		? getRelationCountSelection(context, runtime, { include })
		: undefined;
	if (!select && !counts) return;

	const selection = Object.create(null) as Record<string, unknown>;
	let hasSelection = false;
	if (!select)
		for (const key in runtime.columns) {
			selection[key] = runtime.columns[key];
			hasSelection = true;
		}

	if (select)
		for (const key in select) {
			if (select[key] !== true || runtime.relationNames.has(key))
				continue;

			const column = runtime.columns[key];
			if (!column) continue;

			selection[key] = column;
			hasSelection = true;
		}

	if (counts) {
		selection._count = counts;
		hasSelection = true;
	}

	return hasSelection ? selection : undefined;
};

const canUseDirectRead = (
	runtime: TableRuntime,
	args?: { include?: unknown; select?: unknown },
) =>
	(!args?.include ||
		Object.keys(args.include as Record<string, unknown>).every(
			(key) => key === '_count',
		)) &&
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
			context as RuntimeContext<AnySchema, unknown>,
			args?.include,
		),
		where: and(where, cursorWhere),
	};
};

const resolveLockTables = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	operation: string,
	targets: readonly string[] | undefined,
) => {
	if (!targets?.length) return;

	const resolved: TableRuntime[] = [];
	const seen = new Set<string>();

	for (const target of targets) {
		let tableRuntime = context.tables[target];

		if (!tableRuntime)
			for (const key in context.tables)
				if (context.tables[key]?.dbName === target) {
					tableRuntime = context.tables[key];
					break;
				}

		if (!tableRuntime)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				details: { target },
				message: `Invalid lock table "${target}" for table "${runtime.dbName}"`,
				operation,
				table: runtime.dbName,
			});

		if (seen.has(tableRuntime.dbName)) continue;

		seen.add(tableRuntime.dbName);
		resolved.push(tableRuntime);
	}

	return resolved;
};

const resolveReadLock = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	operation: string,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const lock = args?.lock;
	if (!lock) return;

	if (context.options.locks?.transactionsOnly && !context.transaction)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.LockRequiresTransaction,
			details: {
				lock,
				transactionsOnly: true,
			},
			message: 'Row locks can only be used inside a transaction.',
			operation,
			table: runtime.dbName,
		});

	if (context.dialect === 'sqlite')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.LockNotSupported,
			details: { dialect: context.dialect, lock },
			dialect: context.dialect,
			message: 'Row locks are not supported on SQLite.',
			operation,
			table: runtime.dbName,
		});

	const normalized =
		typeof lock === 'string'
			? {
					mode: lock,
					noWait: undefined,
					skipLocked: undefined,
					tables: undefined,
				}
			: lock;

	if (normalized.noWait && normalized.skipLocked)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			details: { lock },
			message: 'lock cannot enable both noWait and skipLocked.',
			operation,
			table: runtime.dbName,
		});

	if (
		context.dialect === 'mysql' &&
		(normalized.mode === 'keyShare' || normalized.mode === 'noKeyUpdate')
	)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.LockNotSupported,
			details: { dialect: context.dialect, lock },
			dialect: context.dialect,
			message: `Lock mode "${normalized.mode}" is not supported on MySQL.`,
			operation,
			table: runtime.dbName,
		});

	if (normalized.tables?.length && context.dialect !== 'pg')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.LockNotSupported,
			details: { dialect: context.dialect, lock },
			dialect: context.dialect,
			message: 'lock.tables is only supported on PostgreSQL.',
			operation,
			table: runtime.dbName,
		});

	return {
		noWait: normalized.noWait ? true : undefined,
		skipLocked: normalized.skipLocked ? true : undefined,
		strength: LOCK_STRENGTH_MAP[normalized.mode],
		tables: resolveLockTables(
			context,
			runtime,
			operation,
			normalized.tables,
		),
	} satisfies ResolvedLockOption;
};

const applyReadLock = (
	query: SelectQueryLike,
	runtime: TableRuntime,
	operation: string,
	lock: ResolvedLockOption,
) => {
	if (typeof query.for !== 'function')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.LockNotSupported,
			details: { lock: lock.strength },
			message:
				'The current Drizzle select builder does not support row locks.',
			operation,
			table: runtime.dbName,
		});

	const config = Object.create(null) as Record<string, unknown>;
	if (lock.noWait) config.noWait = true;
	if (lock.skipLocked) config.skipLocked = true;
	if (lock.tables?.length)
		config.of = lock.tables.map((table) => table.table);

	return query.for(
		lock.strength,
		Object.keys(config).length ? config : undefined,
	);
};

const normalizeLockError = (
	error: unknown,
	runtime: TableRuntime,
	operation: string,
	lock: unknown,
) => {
	if (error instanceof BetterDrizzleError) return error;

	const fields =
		typeof error === 'object' && error !== null
			? (error as {
					code?: string | number;
					errno?: string | number;
					message?: string;
					sqlState?: string;
				})
			: undefined;
	const code = `${fields?.code ?? fields?.sqlState ?? ''}`.toLowerCase();
	const errno = Number(fields?.errno);
	const message = `${fields?.message ?? ''}`.toLowerCase();

	if (
		code === '55p03' ||
		errno === 1205 ||
		errno === 3572 ||
		message.includes('lock timeout') ||
		message.includes('could not obtain lock') ||
		message.includes('could not be acquired immediately') ||
		message.includes('nowait is set')
	)
		return BetterDrizzleError.from(error, {
			code: BetterDrizzleErrorCode.LockTimeout,
			details: { lock },
			message:
				error instanceof Error
					? error.message
					: 'Failed to acquire the requested row lock.',
			operation,
			table: runtime.dbName,
		});

	return error;
};

const executeReadQuery = async (
	query: SelectQueryLike,
	runtime: TableRuntime,
	operation: string,
	lock: unknown,
) => {
	try {
		return await query;
	} catch (error) {
		throw normalizeLockError(error, runtime, operation, lock);
	}
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
export const findManyRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
	operation = 'findMany',
): Promise<Record<string, unknown>[]> => {
	const relational = prepareRelationalRead(context, tableName, args);
	if (relational && !args?.lock) {
		const rows = await buildDirectReadQuery(
			context,
			tableName,
			relational.args as QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
		);
		return hydrateRelations(
			context,
			getTableRuntime(context, tableName as string),
			rows,
			args as QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
			relational.source,
		);
	}
	const query = buildFindManyQuery(context, tableName, args, operation);

	return (
		args?.lock
			? executeReadQuery(
					query as SelectQueryLike,
					getTableRuntime(context, tableName as string),
					operation,
					args.lock,
				)
			: query
	) as Promise<Record<string, unknown>[]>;
};

export const buildFindManyQuery = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
	operation = 'findMany',
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const relational = prepareRelationalRead(context, tableName, args);
	if (relational && !args?.lock)
		return buildDirectReadQuery(
			context,
			tableName,
			relational.args as QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
		);
	const joinedQuery = buildJoinedOneRelationQuery(context, tableName, args);
	const lock = resolveReadLock(context, runtime, operation, args);
	if (joinedQuery)
		return lock
			? applyReadLock(joinedQuery, runtime, operation, lock)
			: joinedQuery;
	if (canUseDirectRead(runtime, args)) {
		const query = buildDirectReadQuery(context, tableName, args);
		return lock ? applyReadLock(query, runtime, operation, lock) : query;
	}

	if (lock)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.LockNotSupported,
			details: { dialect: context.dialect, lock: args?.lock },
			dialect: context.dialect,
			message:
				'Row locks are only supported on read queries without general relation loading.',
			operation,
			table: runtime.dbName,
		});

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
	operation = 'findFirst',
): Promise<Record<string, unknown> | null> => {
	const relational = prepareRelationalRead(context, tableName, args);
	if (relational && !args?.lock) {
		const rows = await findManyRecords(context, tableName, {
			...args,
			take: args?.take ?? 1,
		});
		return rows[0] ?? null;
	}
	const query = buildFindFirstQuery(context, tableName, args, operation);
	const runtime = getTableRuntime(context, tableName as string);
	const rows = await (args?.lock
		? executeReadQuery(
				query as SelectQueryLike,
				runtime,
				operation,
				args.lock,
			)
		: query);

	return (Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null)) as Record<
		string,
		unknown
	> | null;
};

export const buildFindFirstQuery = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
	operation = 'findFirst',
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const relational = prepareRelationalRead(context, tableName, args);
	if (relational && !args?.lock)
		return buildDirectReadQuery(context, tableName, {
			...relational.args,
			take: args?.take ?? 1,
		} as QueryArgs<Schema, BetterTableKey<Schema>, Meta>);
	const lock = resolveReadLock(context, runtime, operation, args);
	const joinedQuery = buildJoinedOneRelationQuery(context, tableName, {
		...args,
		take: args?.take ?? 1,
	});

	if (joinedQuery) {
		return lock
			? applyReadLock(joinedQuery, runtime, operation, lock)
			: joinedQuery;
	}

	if (canUseDirectRead(runtime, args)) {
		const query = buildDirectReadQuery(context, tableName, {
			...args,
			take: args?.take ?? 1,
		});
		return lock ? applyReadLock(query, runtime, operation, lock) : query;
	}

	if (lock)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.LockNotSupported,
			details: { dialect: context.dialect, lock: args?.lock },
			dialect: context.dialect,
			message:
				'Row locks are only supported on read queries without general relation loading.',
			operation,
			table: runtime.dbName,
		});

	if (context.db.query[tableName].findFirst) {
		return context.db.query[tableName].findFirst(
			buildQueryConfig(context, tableName, args),
		);
	}

	return context.db.query[tableName].findMany(
		buildQueryConfig(context, tableName, {
			...args,
			take: args?.take ?? 1,
		}),
	);
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
	args?: {
		cursor?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>['cursor'];
		where?: WhereArg<Schema, BetterTableKey<Schema>>;
	},
) => {
	const rows = await buildExistsQuery(context, tableName, args).limit(1);

	return rows.length > 0;
};

export const buildExistsQuery = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: {
		cursor?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>['cursor'];
		where?: WhereArg<Schema, BetterTableKey<Schema>>;
	},
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const predicate = getPredicate(context, runtime, tableName, args?.where);
	const cursorPredicate = compileCursorWhere(
		{
			...context,
			runtime,
			tableName: tableName as string,
		},
		args?.cursor,
	);
	let query = context.db.select({ one: sql`1` }).from(runtime.table);

	if (predicate || cursorPredicate)
		query = query.where(and(predicate, cursorPredicate));

	return query;
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
	const relational = hasRelationWrites(runtime, args.data);
	const prepared = relational
		? await prepareRelationWrite(
				context,
				runtime,
				args.data as Record<string, unknown>,
				true,
			)
		: undefined;
	const writeArgs = prepared
		? ({ ...args, data: prepared.scalar } as typeof args)
		: args;
	const { builder, skipDuplicates } = applyInsertOnConflict(
		context,
		runtime,
		writeArgs,
	);

	if (typeof builder.returning === 'function') {
		const rows = await builder.returning();
		const created = rows[0] ?? null;
		if (!created) return null;
		if (prepared)
			await applyRelationWrites(
				context,
				runtime,
				created,
				prepared.relations,
				true,
			);
		if (!hasProjection(args) && !prepared) return created;
		return reloadRecord(context, tableName, created, args);
	}

	const result = await builder;
	if (skipDuplicates.enabled && (getAffectedCount(result) ?? 0) === 0)
		return null;

	const created = await reloadRecord(
		context,
		tableName,
		writeArgs.data as Record<string, unknown>,
	);
	if (!created) return null;
	if (prepared)
		await applyRelationWrites(
			context,
			runtime,
			created,
			prepared.relations,
			true,
		);
	return hasProjection(args) || prepared
		? reloadRecord(context, tableName, created, args)
		: created;
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
	compiledArgs = args,
): Promise<BatchResult<Record<string, unknown>>> => {
	const runtime = getTableRuntime(context, tableName as string);
	const targetColumns = getTargetColumns(context, runtime, args.target);
	const selection = getReturningSelection(
		runtime,
		args.select as Record<string, unknown> | undefined,
	);
	const update = buildUpsertManySet(runtime, args, targetColumns);
	const set = compileUpdateMutations(
		runtime,
		context.dialect,
		'upsertMany',
		update,
	);
	if (getCompiledUpdateSet(update)) compiledUpdateSets.set(compiledArgs, set);

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
		const chunk = await upsertManyChunk(
			context,
			tableName,
			{
				...args,
				batchSize: undefined,
				data: args.data.slice(start, start + batchSize),
			},
			args,
		);

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
	if (hasRelationWrites(runtime, args.data)) {
		const scalar = splitRelationData(
			runtime,
			args.data as Record<string, unknown>,
		).scalar;
		compileUpdateMutations(runtime, context.dialect, 'update', scalar);
		const matches = await findManyRecords(context, tableName, {
			take: 2,
			where: args.where,
		});
		if (!matches.length) return null;
		if (matches.length > 1)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				details: { matches: matches.length },
				message:
					'Relational update requires where to identify exactly one record.',
				operation: 'update',
				table: runtime.dbName,
			});
		const prepared = await prepareRelationWrite(
			context,
			runtime,
			args.data as Record<string, unknown>,
			false,
		);
		let current = matches[0] as Record<string, unknown>;
		if (Object.keys(prepared.scalar).length) {
			const primaryWhere = getPrimaryKeyWhere(runtime, current);
			const predicate = getPredicate(
				context,
				runtime,
				tableName,
				primaryWhere,
			);
			if (!predicate) return null;
			const set = compileUpdateMutations(
				runtime,
				context.dialect,
				'update',
				prepared.scalar,
			);
			if (getCompiledUpdateSet(prepared.scalar))
				compiledUpdateSets.set(args.data as object, set);
			await context.db.update(runtime.table).set(set).where(predicate);
			current =
				(await reloadRecord(context, tableName, current)) ?? current;
		}
		await applyRelationWrites(
			context,
			runtime,
			current,
			prepared.relations,
			false,
		);
		return reloadRecord(context, tableName, current, args);
	}
	const set = compileUpdateMutations(
		runtime,
		context.dialect,
		'update',
		args.data as Record<string, unknown>,
	);
	const predicate = getPredicate(context, runtime, tableName, args.where);
	if (!predicate) return null;

	const builder = context.db.update(runtime.table).set(set).where(predicate);

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
	const set = compileUpdateMutations(
		runtime,
		context.dialect,
		'updateMany',
		args.data as Record<string, unknown>,
	);
	const predicate = getPredicate(context, runtime, tableName, args.where);
	if (!predicate) return { count: 0 };

	const affectedCount = await countRows(context, tableName, args.where);
	if (affectedCount > 0)
		await context.db.update(runtime.table).set(set).where(predicate);

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

	const set = buildUpdateEachSet(context, runtime, rows.byKey, args);
	const affectedCount = await countRows(context, tableName, where);
	if (affectedCount === 0) return { count: 0 };
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
	if (
		hasRelationWrites(runtime, args.create) ||
		hasRelationWrites(runtime, args.update)
	) {
		const matches = await findManyRecords(context, tableName, {
			take: 2,
			where: args.where,
		});
		if (matches.length > 1)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				details: { matches: matches.length },
				message:
					'Relational upsert requires where to identify at most one record.',
				operation: 'upsert',
				table: runtime.dbName,
			});
		if (matches.length)
			return updateRecord(context, tableName, {
				data: args.update,
				include: args.include,
				meta: args.meta,
				select: args.select,
				where: getPrimaryKeyWhere(
					runtime,
					matches[0] ?? {},
				) as WhereArg<Schema, BetterTableKey<Schema>>,
			});
		return createRecord(context, tableName, {
			data: args.create,
			include: args.include,
			meta: args.meta,
			select: args.select,
		} as CreateArgs<Schema, BetterTableKey<Schema>, Meta>);
	}
	const createData = args.create as Record<string, unknown>;
	const updateData = args.update as Record<string, unknown>;
	const insertBuilder = context.db.insert(runtime.table).values(createData);
	const duplicateKeyUpdate = (
		insertBuilder as { onDuplicateKeyUpdate?: unknown }
	).onDuplicateKeyUpdate;

	if (
		(typeof insertBuilder.onConflictDoUpdate === 'function' ||
			typeof duplicateKeyUpdate === 'function') &&
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
			} as CreateArgs<Schema, BetterTableKey<Schema>, Meta>);

		const set = compileUpdateMutations(
			runtime,
			context.dialect,
			'upsert',
			updateData,
		);
		if (getCompiledUpdateSet(updateData)) compiledUpdateSets.set(args, set);
		const builder =
			typeof insertBuilder.onConflictDoUpdate === 'function'
				? insertBuilder.onConflictDoUpdate({
						set,
						target: conflictTarget,
					})
				: (
						duplicateKeyUpdate as (config: {
							set: Record<string, unknown>;
						}) => typeof insertBuilder
					)({ set });

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
	} as CreateArgs<Schema, BetterTableKey<Schema>, Meta>);
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
		findManyRecords(context, tableName, query, 'paginate'),
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

const CURSOR_OPPOSITE_FLAG = '__betterDrizzleCursorOpposite';

export const buildFastCursorQuery = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
	queryArgs: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const field = runtime.primaryKeyFields[0];
	const cursor = (args.after ?? args.before) as
		| Record<string, unknown>
		| undefined;
	if (
		runtime.primaryKeyFields.length !== 1 ||
		!field ||
		!cursor ||
		typeof cursor !== 'object' ||
		Array.isArray(cursor) ||
		Object.keys(cursor).length !== 1 ||
		!(field in cursor) ||
		args.skip !== undefined ||
		args.lock ||
		args.include ||
		runtime.columns[CURSOR_OPPOSITE_FLAG] ||
		hasRelationSelection(
			runtime,
			args.select as Record<string, unknown> | undefined,
		)
	)
		return;

	const entries = Array.isArray(args.orderBy)
		? args.orderBy
		: args.orderBy
			? [args.orderBy]
			: undefined;
	if (
		entries &&
		(entries.length !== 1 || Object.keys(entries[0]).length !== 1)
	)
		return;
	if (entries && !(field in entries[0])) return;
	const direction = entries
		? (entries[0] as Record<string, 'asc' | 'desc'>)[field]
		: 'asc';
	if (direction !== 'asc' && direction !== 'desc') return;

	const where = args.where
		? compileFastWhere(runtime, args.where)
		: undefined;
	if (args.where && !where) return;

	const column = runtime.columns[field];
	const value = cursor[field];
	const opposite =
		(args.after && direction === 'asc') ||
		(args.before && direction === 'desc')
			? lte(column, value)
			: gte(column, value);
	const flag =
		sql`exists (select 1 from ${runtime.table} where ${and(where, opposite)})`.mapWith(
			Boolean,
		);
	if (!args.where && !args.select) {
		const predicate =
			(args.after && direction === 'asc') ||
			(args.before && direction === 'desc')
				? gt(column, value)
				: lt(column, value);
		return context.db
			.select({ ...runtime.columns, [CURSOR_OPPOSITE_FLAG]: flag })
			.from(runtime.table)
			.where(predicate)
			.orderBy(
				(args.after && direction === 'asc') ||
					(args.before && direction === 'desc')
					? asc(column)
					: desc(column),
			)
			.limit(queryArgs.take ?? 10);
	}
	const state = buildReadState(context, tableName, queryArgs);
	let query = context.db
		.select({
			...(state.select ?? runtime.columns),
			[CURSOR_OPPOSITE_FLAG]: flag,
		})
		.from(runtime.table);
	if (state.where) query = query.where(state.where);
	if (state.orderBy?.length) query = query.orderBy(...state.orderBy);
	if (state.limit !== undefined) query = query.limit(state.limit);

	return query;
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

	const rows = await findManyRecords(
		context,
		tableName,
		projectCursorProbe(
			context,
			tableName,
			result.query as QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
		),
		'cursor',
	);
	return rows.length > 0;
};

const projectCursorProbe = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	query: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const field =
		runtime.primaryKeyFields[0] ?? Object.keys(runtime.columns)[0];
	if (!field) return query;
	return {
		...query,
		include: undefined,
		select: { [field]: true },
	} as QueryArgs<Schema, BetterTableKey<Schema>, Meta>;
};

export const getCursorExplainProbes = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
	built: {
		direction: 'before' | 'forward';
	},
	dataQuery: Promise<unknown[]>,
	limit: number,
	fast: boolean,
) => {
	const rows = (await dataQuery) as Record<string, unknown>[];
	if (fast && rows.length) return [];
	const hasOverflow = rows.length > limit;
	const slice = hasOverflow ? rows.slice(0, limit) : rows;
	const data = built.direction === 'before' ? [...slice].reverse() : slice;
	const runtime = getTableRuntime(context, tableName as string);
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
	const probes: Array<{
		key: string;
		query: Promise<Record<string, unknown>[]>;
	}> = [];

	if (built.direction !== 'before' && args.after) {
		const query = buildCursorPaginationQuery(
			{
				...args,
				after: undefined,
				before: previousToken,
				limit: 1,
			},
			1,
		).query as QueryArgs<Schema, BetterTableKey<Schema>, Meta>;
		probes.push({
			key: 'probe:hasPrevious',
			query: buildFindManyQuery(
				context,
				tableName,
				projectCursorProbe(context, tableName, query),
				'cursor',
			) as Promise<Record<string, unknown>[]>,
		});
	}

	if (built.direction === 'before' && args.before) {
		const query = buildCursorPaginationQuery(
			{
				...args,
				before: undefined,
				after: nextToken,
				limit: 1,
			},
			1,
		).query as QueryArgs<Schema, BetterTableKey<Schema>, Meta>;
		probes.push({
			key: 'probe:hasNext',
			query: buildFindManyQuery(
				context,
				tableName,
				projectCursorProbe(context, tableName, query),
				'cursor',
			) as Promise<Record<string, unknown>[]>,
		});
	}

	return probes;
};

/**
 * Without an `orderBy`, cursor pages are ordered by the primary key ascending
 * so the first page and every `after`/`before` page walk the same order.
 */
export const withDefaultCursorOrder = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	if (args.orderBy || args.after || args.before) return args;
	const field = getTableRuntime(context, tableName as string)
		.primaryKeyFields[0];
	if (!field) return args;
	return {
		...args,
		orderBy: { [field]: 'asc' },
	} as CursorArgs<Schema, BetterTableKey<Schema>, Meta>;
};

export const cursorRecords = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	cursorArgs: CursorArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const args = withDefaultCursorOrder(context, tableName, cursorArgs);
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

	const queryArgs = built.query as QueryArgs<
		Schema,
		BetterTableKey<Schema>,
		Meta
	>;
	const fastQuery = buildFastCursorQuery(context, tableName, args, queryArgs);
	const rows = (await (fastQuery ??
		findManyRecords(context, tableName, queryArgs, 'cursor'))) as Record<
		string,
		unknown
	>[];
	const hasOpposite =
		fastQuery && rows.length
			? Boolean(rows[0][CURSOR_OPPOSITE_FLAG])
			: undefined;
	if (fastQuery) for (const row of rows) delete row[CURSOR_OPPOSITE_FLAG];
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
				? (hasOpposite ??
					(await hasCursorPage(context, tableName, {
						...args,
						after: undefined,
						before: previousToken,
						limit: 1,
					})))
				: false;
	const hasNext =
		built.direction === 'before'
			? args.before
				? (hasOpposite ??
					(await hasCursorPage(context, tableName, {
						...args,
						before: undefined,
						after: nextToken,
						limit: 1,
					})))
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
