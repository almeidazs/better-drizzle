import {
	type AnyColumn,
	and,
	asc,
	eq,
	exists,
	gt,
	inArray,
	lte,
	not,
	or,
	type SQL,
	type SQLWrapper,
	sql,
} from 'drizzle-orm';

import type {
	AnySchema,
	BetterTableKey,
	QueryArgs,
	RuntimeContext,
	TableRuntime,
	WhereCompilerContext,
} from '../../types';
import { warnLegacyCount } from '../deprecations';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';
import {
	buildRelationCount,
	compileCursorWhere,
	compileOrderBy,
	compileWhereInput,
} from '../query';
import { getPrimaryKeyWhere, getTableRuntime, isSimpleRecord } from './context';
import { assertImmutable, scopePredicate, stampInsert } from './scopes';

// ANDs the model scope of `runtime` into a relation-write predicate;
// `strict` when the rows it matches are changed.
const scoped = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	predicate: SQL | undefined,
	strict = false,
) => {
	if (!predicate || context.scopes === undefined) return predicate;
	const scope = scopePredicate(
		context,
		runtime,
		undefined,
		undefined,
		strict,
	);
	return scope ? and(predicate, scope) : predicate;
};

type RelationArgs = QueryArgs<AnySchema, never, unknown>;
type RelationState = TableRuntime['relations'][string];
type CountSelection = Record<string, true | { where?: unknown }>;

const columnKey = (runtime: TableRuntime, column: AnyColumn) => {
	for (const key in runtime.columns)
		if (runtime.columns[key] === column) return key;

	for (const key in runtime.columns)
		if (runtime.columns[key]?.name === column.name) return key;

	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.OperationError,
		details: { column: column.name },
		message: `Could not resolve relation column "${column.name}" on "${runtime.dbName}".`,
		operation: 'relation',
		table: runtime.dbName,
	});
};

const encodeValue = (value: unknown) => {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'bigint') return `bigint:${value}`;
	if (value instanceof Date) return `date:${value.toISOString()}`;
	if (value instanceof Uint8Array)
		return `bytes:${Array.from(value).join(',')}`;
	return `${typeof value}:${String(value)}`;
};

export const rowKey = (
	runtime: TableRuntime,
	row: Record<string, unknown>,
	columns: readonly AnyColumn[],
) => {
	if (columns.length === 0) return;
	let key = '';
	for (let index = 0; index < columns.length; index += 1) {
		const column = columns[index];
		if (!column) return;
		const value = row[columnKey(runtime, column)];
		if (value === null || value === undefined) return;
		const encoded = encodeValue(value);
		if (columns.length === 1) return encoded;
		// Length prefixes keep delimiters inside composite values unambiguous.
		key += `${encoded.length}:${encoded}`;
	}
	return key;
};

/**
 * The key that holds the relation count in `include`: `count`, or the
 * deprecated `_count` alias. The result uses the same key.
 */
export const getCountKey = (
	runtime: TableRuntime,
	include: unknown,
): 'count' | '_count' | undefined => {
	if (!include || typeof include !== 'object') return;
	const hasCount = 'count' in include;
	if (!('_count' in include)) return hasCount ? 'count' : undefined;
	if (hasCount)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.InvalidArgs,
			message: 'Use either count or the deprecated _count, not both.',
			operation: 'relation',
			table: runtime.dbName,
		});
	warnLegacyCount();
	return '_count';
};

const getCountSelection = (
	runtime: TableRuntime,
	args: { include?: unknown } | undefined,
) => {
	const include = args?.include as Record<string, unknown> | undefined;
	const key = getCountKey(runtime, include);
	if (!include || !key) return;
	const count = include[key];
	if (!isSimpleRecord(count) || !isSimpleRecord(count.select))
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.InvalidArgs,
			message: `${key} must contain a non-empty select object.`,
			operation: 'relation',
			table: runtime.dbName,
		});

	const select = count.select as CountSelection;
	let hasSelection = false;
	for (const relationName in select) {
		hasSelection = true;
		if (!runtime.relationNames.has(relationName))
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.InvalidArgs,
				details: { relation: relationName },
				message: `Unknown relation "${relationName}" in ${key} on "${runtime.dbName}".`,
				operation: 'relation',
				table: runtime.dbName,
			});
		const value = select[relationName];
		if (value === true) continue;
		if (
			!isSimpleRecord(value) ||
			Object.keys(value).some((key) => key !== 'where')
		)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.InvalidArgs,
				details: { relation: relationName },
				message: `${key} relation "${relationName}" must be true or contain only where.`,
				operation: 'relation',
				table: runtime.dbName,
			});
	}

	if (!hasSelection)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.InvalidArgs,
			message: `${key}.select must include at least one relation.`,
			operation: 'relation',
			table: runtime.dbName,
		});

	return select;
};

const getRelationSource = (
	runtime: TableRuntime,
	args: { include?: unknown; select?: unknown } | undefined,
) => {
	if (args?.include && args.select)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.InvalidArgs,
			message:
				'select and include cannot be used at the same query level.',
			operation: 'relation',
			table: runtime.dbName,
		});
	getCountSelection(runtime, args);

	const source = (args?.select ?? args?.include) as
		| Record<string, unknown>
		| undefined;
	if (!source) return;
	const include = args?.include !== undefined;

	let hasRelations = false;
	for (const key in source) {
		if (include && (key === 'count' || key === '_count')) continue;
		if (runtime.unsupportedRelations[key])
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.OperationError,
				details: { relation: key },
				message: `Relation "${key}" on "${runtime.dbName}" cannot be loaded: ${runtime.unsupportedRelations[key]}.`,
				operation: 'relation',
				table: runtime.dbName,
			});
		if (runtime.relationNames.has(key)) {
			hasRelations = true;
			continue;
		}
		if (!include && Object.hasOwn(runtime.columns, key)) continue;
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.InvalidArgs,
			details: { field: key },
			message: `Unknown relation or column "${key}" on "${runtime.dbName}".`,
			operation: 'relation',
			table: runtime.dbName,
		});
	}

	return hasRelations ? source : undefined;
};

const addRequiredColumns = (
	runtime: TableRuntime,
	selection: Record<string, unknown>,
	source: Record<string, unknown> | undefined,
) => {
	if (!source) return;
	for (const relationName in source) {
		const relation = runtime.relations[relationName];
		if (!relation) continue;
		for (const field of relation.fields)
			selection[columnKey(runtime, field)] = true;
	}
};

export const validateProjection = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	args?: { include?: unknown; select?: unknown },
) => {
	const source = getRelationSource(runtime, args);
	if (source)
		for (const key in source) {
			const relation = runtime.relations[key];
			const nested = source[key];
			if (!relation || !isSimpleRecord(nested)) continue;
			validateProjection(
				context,
				getTableRuntime(context, relation.tableName),
				nested,
			);
		}
	return source;
};

export const prepareRelationalRead = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>,
) => {
	const runtime = getTableRuntime(context, tableName as string);
	const counts = getCountSelection(runtime, args);
	const countKey = counts ? getCountKey(runtime, args?.include) : undefined;
	const source = validateProjection(context, runtime, args);
	if (!source) return;

	const select = args?.select as Record<string, unknown> | undefined;
	if (!select)
		return {
			args: counts
				? {
						...args,
						include: { [countKey as string]: { select: counts } },
					}
				: { ...args, include: undefined },
			source,
		};

	const scalar = Object.create(null) as Record<string, true>;
	for (const key in select)
		if (!runtime.relationNames.has(key) && select[key] === true)
			scalar[key] = true;
	addRequiredColumns(runtime, scalar, source);

	return {
		args: {
			...args,
			include: undefined,
			select: scalar,
		},
		source,
	};
};

// Keep each link below common bind limits and composite OR-depth limits.
const RELATION_BATCH_PARAMS = 10_000;
const RELATION_BATCH_TERMS = 200;

export function* buildLinkPredicates(
	parentRuntime: TableRuntime,
	parents: readonly Record<string, unknown>[],
	parentFields: readonly AnyColumn[],
	targetFields: readonly AnyColumn[],
	maxParams: number,
): Generator<SQL> {
	if (parentFields.length === 1 && targetFields.length === 1) {
		const parentField = parentFields[0];
		const targetField = targetFields[0];
		if (!parentField || !targetField) return;
		const parentKey = columnKey(parentRuntime, parentField);
		let values = [];
		const seen = new Set<unknown>();
		for (const parent of parents) {
			const value = parent[parentKey];
			if (value === null || value === undefined) continue;
			const key =
				value instanceof Date || value instanceof Uint8Array
					? encodeValue(value)
					: value;
			if (seen.has(key)) continue;
			seen.add(key);
			values.push(value);
			if (values.length === maxParams) {
				yield inArray(targetField, values);
				values = [];
			}
		}
		if (values.length) yield inArray(targetField, values);
		return;
	}

	const batchSize = Math.min(
		RELATION_BATCH_TERMS,
		Math.max(1, Math.floor(maxParams / parentFields.length)),
	);
	let conditions = [];
	const seen = new Set<string>();
	for (const parent of parents) {
		const parts = [];
		let key = '';
		for (let index = 0; index < parentFields.length; index += 1) {
			const parentField = parentFields[index];
			const targetField = targetFields[index];
			if (!parentField || !targetField) continue;
			const value = parent[columnKey(parentRuntime, parentField)];
			if (value === null || value === undefined) {
				parts.length = 0;
				break;
			}
			const encoded = encodeValue(value);
			key += `${encoded.length}:${encoded}`;
			parts.push(eq(targetField, value));
		}
		if (!parts.length || seen.has(key)) continue;
		seen.add(key);
		conditions.push(and(...parts));
		if (conditions.length === batchSize) {
			yield or(...conditions)!;
			conditions = [];
		}
	}
	if (conditions.length) yield or(...conditions)!;
}

export const getRelationCountSelection = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	args: { include?: unknown } | undefined,
) => {
	const counts = getCountSelection(runtime, args);
	if (!counts) return;
	const selection = Object.create(null) as Record<string, SQLWrapper>;
	for (const relationName in counts) {
		const relation = runtime.relations[relationName];
		if (!relation) continue;
		const value = counts[relationName] as true | { where?: unknown };
		selection[relationName] = buildRelationCount(
			context,
			relation,
			`__better_count_${relationName}`,
			value === true ? undefined : value.where,
		)
			.mapWith(Number)
			.as(relationName);
	}
	return selection;
};

const getTargetSelection = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	relation: RelationState,
	args: Record<string, unknown> | undefined,
) => {
	const select = args?.select as Record<string, unknown> | undefined;
	const include = args?.include as Record<string, unknown> | undefined;
	const selection = Object.create(null) as Record<string, unknown>;
	const visible = new Set<string>();

	if (!select) {
		for (const key in runtime.columns) {
			selection[key] = runtime.columns[key] as AnyColumn;
			visible.add(key);
		}
	} else
		for (const key in select) {
			const column = runtime.columns[key];
			if (!column || select[key] !== true) continue;
			selection[key] = column;
			visible.add(key);
		}

	for (const field of relation.references) {
		const key = columnKey(runtime, field);
		selection[key] = field;
	}

	const source = select ?? include;
	if (source)
		for (const relationName in source) {
			const nestedRelation = runtime.relations[relationName];
			if (!nestedRelation) continue;
			for (const field of nestedRelation.fields)
				selection[columnKey(runtime, field)] = field;
		}
	const counts = getRelationCountSelection(context, runtime, args);
	if (counts) {
		const countKey = getCountKey(runtime, include) as string;
		selection[countKey] = counts;
		visible.add(countKey);
	}
	return { selection, visible };
};

const relationSlice = (
	rows: Record<string, unknown>[],
	args: Record<string, unknown> | undefined,
) => {
	const skip =
		typeof args?.skip === 'number' && args.skip > 0 ? args.skip : 0;
	const take =
		typeof args?.take === 'number' ? Math.abs(args.take) : undefined;
	if (!skip && take === undefined) return rows;
	return rows.slice(skip, take === undefined ? undefined : skip + take);
};

const relationPage = (args: Record<string, unknown> | undefined) => {
	const skip =
		typeof args?.skip === 'number' && args.skip > 0 ? args.skip : 0;
	const take =
		typeof args?.take === 'number' ? Math.abs(args.take) : undefined;
	return { enabled: Boolean(skip || take !== undefined), skip, take };
};

const rankRelationRows = (
	partitionBy: readonly AnyColumn[],
	orderBy: readonly SQLWrapper[] | undefined,
) =>
	sql<number>`row_number() over (partition by ${sql.join(
		[...partitionBy],
		sql`, `,
	)} order by ${sql.join(
		orderBy?.length
			? [...orderBy]
			: partitionBy.map((column) => asc(column)),
		sql`, `,
	)})`.as('__better_row_number');

const selectRelationPage = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	ranked: unknown,
	skip: number,
	take: number | undefined,
) => {
	const rowNumber = (ranked as { __better_row_number: SQLWrapper })
		.__better_row_number;
	const rows = await context.db
		.select()
		.from(ranked as never)
		.where(
			and(
				skip ? gt(rowNumber, skip) : undefined,
				take === undefined ? undefined : lte(rowNumber, skip + take),
			),
		)
		.orderBy(rowNumber);
	for (const row of rows) delete row.__better_row_number;
	return rows as Record<string, unknown>[];
};

const loadRelation = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	parentRuntime: TableRuntime,
	parents: Record<string, unknown>[],
	relationName: string,
	value: unknown,
) => {
	const relation = parentRuntime.relations[relationName];
	if (!relation) return;
	const targetRuntime = getTableRuntime(context, relation.tableName);
	const args =
		value === true
			? undefined
			: (value as Record<string, unknown> | undefined);
	if (args?.lock)
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.LockNotSupported,
			message: 'Nested relation locks are not supported.',
			operation: 'relation',
			table: targetRuntime.dbName,
		});

	const target = getTargetSelection(context, targetRuntime, relation, args);
	const whereContext = {
		...context,
		runtime: targetRuntime,
		tableName: relation.tableName,
		rootArgs: args,
	} as WhereCompilerContext<Schema, Meta>;
	const nestedWhere = compileWhereInput(whereContext, args?.where as never);
	const cursorWhere = compileCursorWhere(
		whereContext,
		args?.cursor as never,
		args?.orderBy as never,
		args?.take as number | undefined,
	);
	const orderBy = compileOrderBy(
		whereContext,
		args?.orderBy as never,
		args?.cursor as never,
		args?.take,
	);
	const page = relationPage(args);
	const scope = scopePredicate(context, targetRuntime);
	const throughRuntime = relation.through
		? getTableRuntime(context, relation.through.tableName)
		: undefined;
	const throughScope = throughRuntime
		? scopePredicate(context, throughRuntime)
		: undefined;
	let batchParams = RELATION_BATCH_PARAMS;
	if (
		nestedWhere ||
		cursorWhere ||
		scope ||
		throughScope ||
		orderBy?.length ||
		target.visible.has('count') ||
		target.visible.has('_count')
	) {
		// Reserve bindings from the rest of the statement before adding links.
		let query = context.db
			.select(target.selection)
			.from(targetRuntime.table)
			.where(and(nestedWhere, cursorWhere, scope, throughScope));
		if (orderBy?.length) query = query.orderBy(...orderBy);
		const { params } = (
			query as unknown as {
				toSQL(): { params: unknown[] };
			}
		).toSQL();
		const available =
			(context.dialect === 'sqlite' ? 32_766 : 65_535) -
			params.length -
			(page.skip ? 1 : 0) -
			(page.take === undefined ? 0 : 1);
		if (available < relation.fields.length)
			throw new BetterDrizzleError({
				code: BetterDrizzleErrorCode.InvalidArgs,
				message:
					'Relation filters leave no bind parameters for parent keys.',
				operation: 'relation',
				table: targetRuntime.dbName,
			});
		batchParams = Math.min(batchParams, available);
	}
	let rows: Record<string, unknown>[] = [];
	let parentKeyForRow: (row: Record<string, unknown>) => string | undefined;
	const grouped = new Map<string, Record<string, unknown>[]>();
	const appendRows = (batchRows: Record<string, unknown>[]) => {
		const groups = grouped.size
			? new Map<string, Record<string, unknown>[]>()
			: grouped;
		for (const row of batchRows) {
			const key = parentKeyForRow(row);
			if (!key) continue;
			const group = groups.get(key);
			if (group) group.push(row);
			else groups.set(key, [row]);
		}
		if (groups === grouped) {
			rows = batchRows;
			return;
		}
		// SQL collations can make distinct input keys match the same group.
		// Keep the first complete group, including legitimate duplicate rows.
		for (const [key, group] of groups) {
			if (grouped.has(key)) continue;
			grouped.set(key, group);
			for (const row of group) rows.push(row);
		}
	};

	if (relation.kind === 'manyToMany') {
		const through = relation.through;
		if (!through || !throughRuntime) return;
		parentKeyForRow = (row) => {
			let key = '';
			for (let index = 0; index < relation.fields.length; index += 1) {
				const value = row[`__better_parent_${index}`];
				if (value === null || value === undefined) return;
				const encoded = encodeValue(value);
				key +=
					relation.fields.length === 1
						? encoded
						: `${encoded.length}:${encoded}`;
				delete row[`__better_parent_${index}`];
			}
			return key;
		};
		for (const link of buildLinkPredicates(
			parentRuntime,
			parents,
			relation.fields,
			through.sourceFields,
			batchParams,
		)) {
			let batchRows: Record<string, unknown>[];
			const selection = {
				...target.selection,
			} as Record<string, unknown>;
			for (let index = 0; index < through.sourceFields.length; index += 1)
				selection[`__better_parent_${index}`] =
					through.sourceFields[index];
			const joins = [];
			for (
				let index = 0;
				index < through.targetFields.length;
				index += 1
			) {
				const throughField = through.targetFields[index];
				const targetField = relation.references[index];
				if (throughField && targetField)
					joins.push(eq(throughField, targetField));
			}
			if (page.enabled) {
				selection.__better_row_number = rankRelationRows(
					through.sourceFields,
					orderBy,
				);
				const ranked = context.db
					.select(selection)
					.from(throughRuntime.table)
					.innerJoin(targetRuntime.table, and(...joins))
					.where(
						and(
							link,
							nestedWhere,
							cursorWhere,
							scope,
							throughScope,
						),
					)
					.as('__better_relation');
				batchRows = await selectRelationPage(
					context,
					ranked,
					page.skip,
					page.take,
				);
			} else {
				let query = context.db
					.select(selection)
					.from(throughRuntime.table)
					.innerJoin(targetRuntime.table, and(...joins))
					.where(
						and(
							link,
							nestedWhere,
							cursorWhere,
							scope,
							throughScope,
						),
					);
				if (orderBy?.length) query = query.orderBy(...orderBy);
				batchRows = await query;
			}
			appendRows(batchRows);
		}
	} else {
		parentKeyForRow = (row) =>
			rowKey(targetRuntime, row, relation.references);
		for (const link of buildLinkPredicates(
			parentRuntime,
			parents,
			relation.fields,
			relation.references,
			batchParams,
		)) {
			let batchRows: Record<string, unknown>[];
			if (page.enabled) {
				const ranked = context.db
					.select({
						...target.selection,
						__better_row_number: rankRelationRows(
							relation.references,
							orderBy,
						),
					})
					.from(targetRuntime.table)
					.where(and(link, nestedWhere, cursorWhere, scope))
					.as('__better_relation');
				batchRows = await selectRelationPage(
					context,
					ranked,
					page.skip,
					page.take,
				);
			} else {
				let query = context.db
					.select(target.selection)
					.from(targetRuntime.table)
					.where(and(link, nestedWhere, cursorWhere, scope));
				if (orderBy?.length) query = query.orderBy(...orderBy);
				batchRows = await query;
			}
			appendRows(batchRows);
		}
	}

	const nestedSource = getRelationSource(targetRuntime, args);
	if (nestedSource)
		await hydrateRelations(
			context,
			targetRuntime,
			rows,
			args as RelationArgs,
			nestedSource,
		);

	for (const row of rows)
		for (const key in target.selection)
			if (!target.visible.has(key)) delete row[key];

	for (const parent of parents) {
		const key = rowKey(parentRuntime, parent, relation.fields);
		const group = key ? (grouped.get(key) ?? []) : [];
		const related = page.enabled ? group : relationSlice(group, args);
		if (
			relation.kind !== 'one' &&
			args?.cursor &&
			typeof args.take === 'number' &&
			args.take < 0
		)
			related.reverse();
		if (relation.kind === 'one') parent[relationName] = related[0] ?? null;
		else parent[relationName] = related;
	}
};

export const hydrateRelations = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	rows: Record<string, unknown>[],
	args: QueryArgs<Schema, BetterTableKey<Schema>, Meta> | RelationArgs,
	source = getRelationSource(runtime, args),
) => {
	if (!source || !rows.length) return rows;

	for (const relationName in source) {
		if (!runtime.relationNames.has(relationName)) continue;
		await loadRelation(
			context,
			runtime,
			rows,
			relationName,
			source[relationName],
		);
	}

	const select = args.select as Record<string, unknown> | undefined;
	if (select)
		for (const row of rows)
			for (const key in runtime.columns)
				if (select[key] !== true) delete row[key];

	return rows;
};

export const getDeferredRelationPlans = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
	args: unknown,
) => {
	const plans: {
		cardinality: 'many' | 'one';
		filtered: boolean;
		paginated: boolean;
		path: string;
		sorted: boolean;
		table: string;
		through?: string;
	}[] = [];
	const visit = (
		runtime: TableRuntime,
		value: { include?: unknown; select?: unknown } | undefined,
		parentPath: string,
	) => {
		const source = getRelationSource(runtime, value);
		if (!source) return;
		for (const relationName in source) {
			const relation = runtime.relations[relationName];
			if (!relation) continue;
			const nested =
				source[relationName] === true
					? undefined
					: (source[relationName] as Record<string, unknown>);
			const path = parentPath
				? `${parentPath}.${relationName}`
				: relationName;
			plans.push({
				cardinality: relation.kind === 'one' ? 'one' : 'many',
				filtered: Boolean(nested?.where || nested?.cursor),
				paginated: Boolean(
					nested?.take !== undefined || nested?.skip !== undefined,
				),
				path,
				sorted: Boolean(nested?.orderBy),
				table: getTableRuntime(context, relation.tableName).tableConfig
					.name,
				through: relation.through?.tableName,
			});
			visit(getTableRuntime(context, relation.tableName), nested, path);
		}
	};
	visit(
		getTableRuntime(context, tableName as string),
		args as { include?: unknown; select?: unknown } | undefined,
		'',
	);
	return plans;
};

export const hasRelationWrites = (runtime: TableRuntime, data: unknown) => {
	if (!isSimpleRecord(data)) return false;
	for (const key in data)
		if (runtime.relationNames.has(key) && data[key] !== undefined)
			return true;
	return false;
};

export const splitRelationData = (
	runtime: TableRuntime,
	data: Record<string, unknown>,
) => {
	const scalar = Object.create(null) as Record<string, unknown>;
	const relations = Object.create(null) as Record<string, unknown>;
	for (const key in data)
		if (!runtime.relationNames.has(key)) scalar[key] = data[key];
		else if (data[key] !== undefined) relations[key] = data[key];
	return { relations, scalar };
};

const relationError = (
	runtime: TableRuntime,
	relation: string,
	message: string,
	details?: Record<string, unknown>,
	code = BetterDrizzleErrorCode.InvalidArgs,
) =>
	new BetterDrizzleError({
		code,
		details: { relation, ...details },
		message,
		operation: 'relationWrite',
		table: runtime.dbName,
	});

const selectorList = (value: unknown) => {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
};

const resolveSelector = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	selector: unknown,
	relationName: string,
	strict = false,
) => {
	if (!isSimpleRecord(selector) || !Object.keys(selector).length)
		throw relationError(
			runtime,
			relationName,
			'Relation selectors must be non-empty structured objects.',
		);
	const where = compileWhereInput(
		{
			...context,
			runtime,
			tableName: runtime.tableConfig.name,
		} as WhereCompilerContext<Schema, Meta>,
		selector,
	);
	if (!where)
		throw relationError(
			runtime,
			relationName,
			'Relation selector could not be compiled.',
			{ selector },
		);
	const rows = await context.db
		.select()
		.from(runtime.table)
		.where(scoped(context, runtime, where, strict))
		.limit(2);
	if (rows.length !== 1)
		throw relationError(
			runtime,
			relationName,
			rows.length
				? 'Relation selector matched more than one record.'
				: 'Relation selector did not match a record.',
			{ matches: rows.length, selector },
			BetterDrizzleErrorCode.OperationError,
		);
	return rows[0] as Record<string, unknown>;
};

const resolveSelectors = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	selectors: unknown,
	relationName: string,
	strict = false,
) => {
	const rows = [];
	const seen = new Set<string>();
	for (const selector of selectorList(selectors)) {
		const row = await resolveSelector(
			context,
			runtime,
			selector,
			relationName,
			strict,
		);
		const key = rowKey(runtime, row, runtime.primaryKey);
		if (key && seen.has(key)) continue;
		if (key) seen.add(key);
		rows.push(row);
	}
	return rows;
};

const assertCommand = (
	runtime: TableRuntime,
	relationName: string,
	command: unknown,
	create: boolean,
) => {
	if (!isSimpleRecord(command))
		throw relationError(
			runtime,
			relationName,
			'Relation commands must be objects.',
		);
	const hasSet = 'set' in command;
	const hasConnect = 'connect' in command;
	const hasDisconnect = 'disconnect' in command;
	if (hasSet && (hasConnect || hasDisconnect))
		throw relationError(
			runtime,
			relationName,
			'set cannot be combined with connect or disconnect.',
		);
	if (create && (hasSet || hasDisconnect))
		throw relationError(
			runtime,
			relationName,
			'create relation data only supports connect.',
		);
	if (!hasSet && !hasConnect && !hasDisconnect)
		throw relationError(
			runtime,
			relationName,
			'Relation command must contain connect, disconnect, or set.',
		);
	return command;
};

const setColumnsFromTarget = (
	sourceRuntime: TableRuntime,
	targetRuntime: TableRuntime,
	relation: RelationState,
	target: Record<string, unknown> | null,
	data: Record<string, unknown>,
	relationName: string,
) => {
	for (let index = 0; index < relation.fields.length; index += 1) {
		const sourceField = relation.fields[index];
		const targetField = relation.references[index];
		if (!sourceField || !targetField) continue;
		if (!target && sourceField.notNull)
			throw relationError(
				sourceRuntime,
				relationName,
				`Cannot disconnect required relation "${relationName}".`,
				{ column: sourceField.name },
			);
		data[columnKey(sourceRuntime, sourceField)] = target
			? target[columnKey(targetRuntime, targetField)]
			: null;
	}
};

const holdsUniqueTarget = (runtime: TableRuntime, relation: RelationState) => {
	if (relation.fields.some((field) => field.notNull)) return false;
	const fields = relation.fields.map((field) => columnKey(runtime, field));
	if (fields.length === 1 && runtime.columns[fields[0] as string]?.isUnique)
		return true;
	return runtime.uniqueKeys.some(
		(key) =>
			key.length === fields.length &&
			fields.every((field) => key.includes(field)),
	);
};

// A nullable foreign key under a unique key links its target to one row at
// most: like Prisma, connecting the target detaches the row holding it.
const detachUniqueTargetHolder = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	targetRuntime: TableRuntime,
	relation: RelationState,
	target: Record<string, unknown>,
	current: Record<string, unknown> | undefined,
) => {
	if (!holdsUniqueTarget(runtime, relation)) return;
	const conditions: SQL[] = [];
	const detached = Object.create(null) as Record<string, unknown>;
	for (let index = 0; index < relation.fields.length; index += 1) {
		const source = relation.fields[index];
		const reference = relation.references[index];
		if (!source || !reference) continue;
		conditions.push(
			eq(source, target[columnKey(targetRuntime, reference)]),
		);
		detached[columnKey(runtime, source)] = null;
	}
	if (current) {
		const self = compileWhereInput(
			{
				...context,
				runtime,
				tableName: runtime.tableConfig.name,
			} as WhereCompilerContext<Schema, Meta>,
			getPrimaryKeyWhere(runtime, current),
		);
		if (self) conditions.push(not(self));
	}
	assertImmutable(context, runtime, detached);
	await context.db
		.update(runtime.table)
		.set(detached)
		.where(scoped(context, runtime, and(...conditions), true));
};

export const prepareRelationWrite = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	data: Record<string, unknown>,
	create: boolean,
	current?: Record<string, unknown>,
) => {
	const split = splitRelationData(runtime, data);
	const remaining = { ...split.relations };

	for (const relationName in split.relations) {
		const relation = runtime.relations[relationName];
		if (relation?.kind !== 'one' || !relation.sourceOwnsForeignKey)
			continue;
		const command = assertCommand(
			runtime,
			relationName,
			split.relations[relationName],
			create,
		);
		const targetRuntime = getTableRuntime(context, relation.tableName);
		let target: Record<string, unknown> | null;
		if ('connect' in command)
			target = await resolveSelector(
				context,
				targetRuntime,
				command.connect,
				relationName,
			);
		else if ('set' in command && command.set !== null)
			target = await resolveSelector(
				context,
				targetRuntime,
				command.set,
				relationName,
			);
		else target = null;
		if (target)
			await detachUniqueTargetHolder(
				context,
				runtime,
				targetRuntime,
				relation,
				target,
				current,
			);
		setColumnsFromTarget(
			runtime,
			targetRuntime,
			relation,
			target,
			split.scalar,
			relationName,
		);
		delete remaining[relationName];
	}

	// Foreign keys copied from targets may include scope columns.
	if (context.scopes === undefined)
		return { relations: remaining, scalar: split.scalar };
	if (!create) assertImmutable(context, runtime, split.scalar);
	return {
		relations: remaining,
		scalar: create
			? stampInsert(context, runtime, split.scalar)
			: split.scalar,
	};
};

const recordMatchesParent = (
	parentRuntime: TableRuntime,
	parent: Record<string, unknown>,
	targetRuntime: TableRuntime,
	target: Record<string, unknown>,
	relation: RelationState,
) => {
	for (let index = 0; index < relation.fields.length; index += 1) {
		const source = relation.fields[index];
		const reference = relation.references[index];
		if (
			!source ||
			!reference ||
			parent[columnKey(parentRuntime, source)] !==
				target[columnKey(targetRuntime, reference)]
		)
			return false;
	}
	return true;
};

const relationTargetData = (
	parentRuntime: TableRuntime,
	parent: Record<string, unknown>,
	targetRuntime: TableRuntime,
	relation: RelationState,
	value: 'connect' | 'disconnect',
	relationName: string,
) => {
	const data = Object.create(null) as Record<string, unknown>;
	for (let index = 0; index < relation.fields.length; index += 1) {
		const source = relation.fields[index];
		const reference = relation.references[index];
		if (!source || !reference) continue;
		if (value === 'disconnect' && reference.notNull)
			throw relationError(
				parentRuntime,
				relationName,
				`Cannot disconnect required relation "${relationName}".`,
				{ column: reference.name },
			);
		data[columnKey(targetRuntime, reference)] =
			value === 'connect'
				? parent[columnKey(parentRuntime, source)]
				: null;
	}
	return data;
};

const updateResolvedTarget = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	target: Record<string, unknown>,
	data: Record<string, unknown>,
) => {
	const where = compileWhereInput(
		{
			...context,
			runtime,
			tableName: runtime.tableConfig.name,
		} as WhereCompilerContext<Schema, Meta>,
		getPrimaryKeyWhere(runtime, target),
	);
	if (!where)
		throw relationError(
			runtime,
			'unknown',
			'Related records require a primary key for relation writes.',
			undefined,
			BetterDrizzleErrorCode.OperationError,
		);
	assertImmutable(context, runtime, data);
	await context.db
		.update(runtime.table)
		.set(data)
		.where(scoped(context, runtime, where, true));
};

const findLinkedTargets = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	parentRuntime: TableRuntime,
	parent: Record<string, unknown>,
	targetRuntime: TableRuntime,
	relation: RelationState,
) => {
	const conditions = [];
	for (let index = 0; index < relation.fields.length; index += 1) {
		const source = relation.fields[index];
		const reference = relation.references[index];
		if (source && reference)
			conditions.push(
				eq(reference, parent[columnKey(parentRuntime, source)]),
			);
	}
	if (!conditions.length) return [];
	return context.db
		.select()
		.from(targetRuntime.table)
		.where(scoped(context, targetRuntime, and(...conditions), true));
};

const applyDirectRelation = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	parentRuntime: TableRuntime,
	parent: Record<string, unknown>,
	relationName: string,
	relation: RelationState,
	commandValue: unknown,
) => {
	const command = assertCommand(
		parentRuntime,
		relationName,
		commandValue,
		false,
	);
	const targetRuntime = getTableRuntime(context, relation.tableName);
	const connectValue = 'connect' in command ? command.connect : undefined;
	const disconnectValue =
		'disconnect' in command ? command.disconnect : undefined;
	const setValue = 'set' in command ? command.set : undefined;
	const setTargets =
		setValue === undefined || setValue === null
			? []
			: await resolveSelectors(
					context,
					targetRuntime,
					setValue,
					relationName,
					true,
				);

	const connectTargets = [
		...setTargets,
		...(connectValue === undefined
			? []
			: await resolveSelectors(
					context,
					targetRuntime,
					connectValue,
					relationName,
					true,
				)),
	];
	// A to-one whose foreign key lives on the target (users.profile) has at
	// most one linked row: `disconnect: true` detaches it, and connecting a new
	// row replaces it, like `set`.
	const replacesCurrent =
		'set' in command ||
		(relation.kind === 'one' &&
			(disconnectValue === true || connectValue !== undefined));

	if (replacesCurrent) {
		const current = await findLinkedTargets(
			context,
			parentRuntime,
			parent,
			targetRuntime,
			relation,
		);
		const selected = new Set(
			connectTargets.map((row) =>
				rowKey(targetRuntime, row, targetRuntime.primaryKey),
			),
		);
		for (const row of current) {
			const key = rowKey(targetRuntime, row, targetRuntime.primaryKey);
			if (selected.has(key)) continue;
			await updateResolvedTarget(
				context,
				targetRuntime,
				row,
				relationTargetData(
					parentRuntime,
					parent,
					targetRuntime,
					relation,
					'disconnect',
					relationName,
				),
			);
		}
	}

	if (disconnectValue !== true)
		for (const selector of selectorList(disconnectValue)) {
			const target = await resolveSelector(
				context,
				targetRuntime,
				selector,
				relationName,
				true,
			);
			if (
				!recordMatchesParent(
					parentRuntime,
					parent,
					targetRuntime,
					target,
					relation,
				)
			)
				continue;
			await updateResolvedTarget(
				context,
				targetRuntime,
				target,
				relationTargetData(
					parentRuntime,
					parent,
					targetRuntime,
					relation,
					'disconnect',
					relationName,
				),
			);
		}

	if (relation.kind === 'one' && connectTargets.length > 1)
		throw relationError(
			parentRuntime,
			relationName,
			'To-one relations accept exactly one connected record.',
		);
	for (const target of connectTargets)
		await updateResolvedTarget(
			context,
			targetRuntime,
			target,
			relationTargetData(
				parentRuntime,
				parent,
				targetRuntime,
				relation,
				'connect',
				relationName,
			),
		);
};

const pivotPredicate = (
	parentRuntime: TableRuntime,
	parent: Record<string, unknown>,
	targetRuntime: TableRuntime,
	target: Record<string, unknown> | undefined,
	relation: RelationState,
) => {
	const through = relation.through;
	if (!through) return;
	const conditions = [];
	for (let index = 0; index < through.sourceFields.length; index += 1) {
		const pivotField = through.sourceFields[index];
		const sourceField = relation.fields[index];
		if (pivotField && sourceField)
			conditions.push(
				eq(pivotField, parent[columnKey(parentRuntime, sourceField)]),
			);
	}
	if (target)
		for (let index = 0; index < through.targetFields.length; index += 1) {
			const pivotField = through.targetFields[index];
			const targetField = relation.references[index];
			if (pivotField && targetField)
				conditions.push(
					eq(
						pivotField,
						target[columnKey(targetRuntime, targetField)],
					),
				);
		}
	return conditions.length ? and(...conditions) : undefined;
};

// `set` replaces only links to targets inside the target scope; links to
// out-of-scope targets (a junction without scope columns) stay.
const inScopeTargets = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	targetRuntime: TableRuntime,
	relation: RelationState,
	predicate: SQL,
) => {
	if (context.scopes === undefined) return predicate;
	const scope = scopePredicate(context, targetRuntime);
	const through = relation.through;
	if (!scope || !through) return predicate;
	const conditions: SQL[] = [scope];
	for (let index = 0; index < through.targetFields.length; index += 1) {
		const pivotField = through.targetFields[index];
		const targetField = relation.references[index];
		if (pivotField && targetField)
			conditions.push(eq(targetField, pivotField));
	}
	return and(
		predicate,
		exists(
			context.db
				.select({ one: sql`1` })
				.from(targetRuntime.table)
				.where(and(...conditions)),
		),
	) as SQL;
};

const connectPivot = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	parentRuntime: TableRuntime,
	parent: Record<string, unknown>,
	targetRuntime: TableRuntime,
	target: Record<string, unknown>,
	relation: RelationState,
) => {
	const through = relation.through;
	if (!through) return;
	const throughRuntime = getTableRuntime(context, through.tableName);
	const predicate = pivotPredicate(
		parentRuntime,
		parent,
		targetRuntime,
		target,
		relation,
	);
	if (!predicate) return;
	const existing = await context.db
		.select()
		.from(throughRuntime.table)
		.where(scoped(context, throughRuntime, predicate))
		.limit(1);
	if (existing.length) return;
	const data = Object.create(null) as Record<string, unknown>;
	for (let index = 0; index < through.sourceFields.length; index += 1) {
		const pivotField = through.sourceFields[index];
		const sourceField = relation.fields[index];
		if (pivotField && sourceField)
			data[columnKey(throughRuntime, pivotField)] =
				parent[columnKey(parentRuntime, sourceField)];
	}
	for (let index = 0; index < through.targetFields.length; index += 1) {
		const pivotField = through.targetFields[index];
		const targetField = relation.references[index];
		if (pivotField && targetField)
			data[columnKey(throughRuntime, pivotField)] =
				target[columnKey(targetRuntime, targetField)];
	}
	await context.db
		.insert(throughRuntime.table)
		.values(stampInsert(context, throughRuntime, data));
};

const applyManyToManyRelation = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	parentRuntime: TableRuntime,
	parent: Record<string, unknown>,
	relationName: string,
	relation: RelationState,
	commandValue: unknown,
) => {
	const command = assertCommand(
		parentRuntime,
		relationName,
		commandValue,
		false,
	);
	const through = relation.through;
	if (!through) return;
	const throughRuntime = getTableRuntime(context, through.tableName);
	const targetRuntime = getTableRuntime(context, relation.tableName);
	if ('set' in command) {
		const predicate = pivotPredicate(
			parentRuntime,
			parent,
			targetRuntime,
			undefined,
			relation,
		);
		if (predicate)
			await context.db
				.delete(throughRuntime.table)
				.where(
					scoped(
						context,
						throughRuntime,
						inScopeTargets(
							context,
							targetRuntime,
							relation,
							predicate,
						),
						true,
					),
				);
		for (const target of await resolveSelectors(
			context,
			targetRuntime,
			command.set,
			relationName,
		))
			await connectPivot(
				context,
				parentRuntime,
				parent,
				targetRuntime,
				target,
				relation,
			);
		return;
	}
	for (const selector of selectorList(command.disconnect)) {
		const target = await resolveSelector(
			context,
			targetRuntime,
			selector,
			relationName,
		);
		const predicate = pivotPredicate(
			parentRuntime,
			parent,
			targetRuntime,
			target,
			relation,
		);
		if (predicate)
			await context.db
				.delete(throughRuntime.table)
				.where(scoped(context, throughRuntime, predicate, true));
	}
	for (const target of await resolveSelectors(
		context,
		targetRuntime,
		command.connect,
		relationName,
	))
		await connectPivot(
			context,
			parentRuntime,
			parent,
			targetRuntime,
			target,
			relation,
		);
};

export const applyRelationWrites = async <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	runtime: TableRuntime,
	parent: Record<string, unknown>,
	relations: Record<string, unknown>,
	create: boolean,
) => {
	for (const relationName in relations) {
		const relation = runtime.relations[relationName];
		if (!relation) continue;
		const command = assertCommand(
			runtime,
			relationName,
			relations[relationName],
			create,
		);
		if (relation.kind === 'manyToMany')
			await applyManyToManyRelation(
				context,
				runtime,
				parent,
				relationName,
				relation,
				command,
			);
		else
			await applyDirectRelation(
				context,
				runtime,
				parent,
				relationName,
				relation,
				command,
			);
	}
};
