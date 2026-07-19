import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	definePlugin,
} from 'better-drizzle';

import type {
	HookOperationContext,
	HookRawContext,
	HookTransactionContext,
	ModelRuleScope,
	NormalizedRule,
	OperationContext,
	RuleEvaluator,
	RuleKey,
	RuleSetting,
	RuleSeverity,
	RulesOperation,
	RulesPluginOptions,
	RulesViolation,
} from '../types';
import { version } from '../version';

const MUTATION_VERBS = [
	'alter',
	'create',
	'delete',
	'drop',
	'insert',
	'replace',
	'truncate',
	'update',
];
const LONG_RUNNING_OPERATIONS = new Set<RulesOperation>([
	'executeRaw',
	'explain',
	'raw',
]);
const SENSITIVE_FIELD_NAMES = [
	'apiKey',
	'apiKeys',
	'password',
	'passwordHash',
	'secret',
	'secrets',
	'ssn',
	'token',
	'tokens',
];

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const normalizeRule = <TOptions extends object>(
	setting: RuleSetting<TOptions> | undefined,
): NormalizedRule<TOptions> => {
	if (setting === true) return { level: 'error', options: {} as TOptions };
	if (setting === false || setting === undefined || setting === 'off')
		return { level: 'off', options: {} as TOptions };
	if (setting === 'warn' || setting === 'error')
		return { level: setting, options: {} as TOptions };

	return {
		level: setting.level ?? 'error',
		options: setting,
	};
};

const hasOwnKeys = (value: unknown) => {
	const record = asRecord(value);
	return Boolean(record && Object.keys(record).length > 0);
};

const isEmptyWhere = (
	where: unknown,
	treatUndefinedAsEmpty: boolean,
	treatEmptyAndOrAsEmpty: boolean,
) => {
	if (where === undefined) return treatUndefinedAsEmpty;

	const record = asRecord(where);
	if (!record) return false;
	if (Object.keys(record).length === 0) return true;
	if (!treatEmptyAndOrAsEmpty) return false;

	const andValue = record.AND;
	if (Array.isArray(andValue) && andValue.length === 0) return true;
	const orValue = record.OR;
	if (Array.isArray(orValue) && orValue.length === 0) return true;

	return false;
};

const toNumber = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getLimit = (context: OperationContext) => {
	const args = [context.limit, context.take];
	for (const value of args) {
		const resolved = toNumber(value);
		if (resolved !== undefined) return resolved;
	}

	if (context.operation === 'paginate') {
		const record = asRecord(context.query);
		const pageSize = toNumber(record?.perPage);
		if (pageSize !== undefined) return pageSize;
	}

	if (context.operation === 'cursor') {
		const record = asRecord(context.query);
		const first = toNumber(record?.first);
		if (first !== undefined) return first;
		const last = toNumber(record?.last);
		if (last !== undefined) return last;
	}

	return undefined;
};

const getIncludeStats = (
	include: unknown,
	depth = 1,
): { depth: number; relations: number } => {
	const record = asRecord(include);
	if (!record) return { depth: 0, relations: 0 };

	let maxDepth = depth;
	let relations = 0;

	for (const value of Object.values(record)) {
		if (value === false || value === undefined || value === null) continue;
		relations += 1;

		if (value === true) continue;
		const nestedRecord = asRecord(value);
		if (!nestedRecord) continue;

		const child = getIncludeStats(
			'with' in nestedRecord ? nestedRecord.with : nestedRecord.include,
			depth + 1,
		);
		if (child.depth > maxDepth) maxDepth = child.depth;
		relations += child.relations;
	}

	return { depth: maxDepth, relations };
};

const hasOrderBy = (orderBy: unknown) => {
	if (Array.isArray(orderBy)) return orderBy.length > 0;
	return orderBy !== undefined && orderBy !== null;
};

const getOrderByColumns = (orderBy: unknown): string[] => {
	const values = Array.isArray(orderBy) ? orderBy : [orderBy];
	const columns: string[] = [];

	for (const value of values) {
		const record = asRecord(value);
		if (!record) continue;

		for (const [key, child] of Object.entries(record)) {
			if (key === 'asc' || key === 'desc') continue;
			if (typeof child === 'string' || typeof child === 'number') {
				columns.push(key);
				continue;
			}
			if (asRecord(child) || child === 'asc' || child === 'desc') {
				columns.push(key);
			}
		}
	}

	return columns;
};

const hasPrimaryKeyOrder = (context: OperationContext) => {
	const columns = getOrderByColumns(context.orderBy);
	if (columns.length === 0) return undefined;
	return columns.includes('id');
};

const getLockRecord = (lock: unknown) => asRecord(lock);

const getQueryVerb = (query: string) =>
	query
		.trim()
		.replace(/^\/\*[\s\S]*?\*\//, '')
		.trim()
		.split(/\s+/, 1)[0]
		?.toLowerCase();

const isMutationQuery = (query: string, allow?: readonly string[]) => {
	const trimmed = query.trim().toLowerCase();
	if (allow?.some((item) => trimmed.startsWith(item.toLowerCase())))
		return false;

	const verb = getQueryVerb(query);
	return verb ? MUTATION_VERBS.includes(verb) : false;
};

const resolveMetaValue = (
	context: OperationContext,
	key: string | undefined,
): unknown => {
	if (!key) return undefined;
	if (context.meta && key in context.meta) return context.meta[key];
	return context.transactionContext?.[key];
};

const getReasonValue = (context: OperationContext, key = 'reason') => {
	const args = asRecord(context.query);
	if (args && key in args) return args[key];
	return resolveMetaValue(context, key);
};

const matchesModelScope = (
	context: OperationContext,
	scope: ModelRuleScope<string> | undefined,
) => {
	if (!scope || !context.model) return true;
	if (scope.models?.length && !scope.models.includes(context.model))
		return false;
	if (scope.ignoreModels?.includes(context.model)) return false;
	return true;
};

const matchesOperations = (
	context: OperationContext,
	operations: readonly RulesOperation[] | undefined,
) => !operations || operations.includes(context.operation);

const createViolation = (
	context: OperationContext,
	rule: string,
	message: string,
	path?: readonly string[],
): Omit<RulesViolation, 'level'> => ({
	context: context.context,
	message,
	meta: context.meta,
	model: context.model,
	operation: context.operation,
	path,
	query: {
		data: context.data,
		include: context.include,
		lock: context.lock,
		limit: context.limit ?? context.take,
		orderBy: context.orderBy,
		select: context.select,
		where: context.where,
	},
	rule,
});

const emitIf = (
	condition: boolean,
	context: OperationContext,
	emit: (
		violation: Omit<RulesViolation, 'level'>,
		level: RuleSeverity,
	) => void,
	level: RuleSeverity,
	rule: string,
	message: string,
	path?: readonly string[],
) => {
	if (!condition || level === 'off') return;
	emit(createViolation(context, rule, message, path), level);
};

const evaluators: Partial<Record<RuleKey, RuleEvaluator>> = {
	noDeleteManyWithoutWhere(context, options, emit) {
		const rule = normalizeRule(options.noDeleteManyWithoutWhere);
		if (
			context.operation !== 'deleteMany' ||
			!matchesModelScope(context, rule.options)
		)
			return;
		emitIf(
			context.where === undefined,
			context,
			emit,
			rule.level,
			'noDeleteManyWithoutWhere',
			'deleteMany requires a where clause.',
			['where'],
		);
	},
	noUpdateManyWithoutWhere(context, options, emit) {
		const rule = normalizeRule(options.noUpdateManyWithoutWhere);
		if (
			context.operation !== 'updateMany' ||
			!matchesModelScope(context, rule.options)
		)
			return;
		emitIf(
			context.where === undefined,
			context,
			emit,
			rule.level,
			'noUpdateManyWithoutWhere',
			'updateMany requires a where clause.',
			['where'],
		);
	},
	noDeleteWithoutWhere(context, options, emit) {
		const rule = normalizeRule(options.noDeleteWithoutWhere);
		if (
			context.operation !== 'delete' ||
			!matchesModelScope(context, rule.options)
		)
			return;
		emitIf(
			context.where === undefined,
			context,
			emit,
			rule.level,
			'noDeleteWithoutWhere',
			'delete requires a where clause.',
			['where'],
		);
	},
	noUpdateWithoutWhere(context, options, emit) {
		const rule = normalizeRule(options.noUpdateWithoutWhere);
		if (
			context.operation !== 'update' ||
			!matchesModelScope(context, rule.options)
		)
			return;
		emitIf(
			context.where === undefined,
			context,
			emit,
			rule.level,
			'noUpdateWithoutWhere',
			'update requires a where clause.',
			['where'],
		);
	},
	noEmptyWhere(context, options, emit) {
		const rule = normalizeRule(options.noEmptyWhere);
		if (
			!matchesModelScope(context, rule.options) ||
			!matchesOperations(context, rule.options.operations)
		)
			return;
		emitIf(
			isEmptyWhere(
				context.where,
				rule.options.treatUndefinedAsEmpty ?? true,
				rule.options.treatEmptyAndOrAsEmpty ?? false,
			),
			context,
			emit,
			rule.level,
			'noEmptyWhere',
			'The where clause is empty.',
			['where'],
		);
	},
	noUnboundedFindMany(context, options, emit) {
		const rule = normalizeRule(options.noUnboundedFindMany);
		if (
			context.operation !== 'findMany' ||
			!matchesModelScope(context, rule.options)
		)
			return;
		const hasWhere = context.where !== undefined;
		const limit = getLimit(context);
		const allowed =
			(rule.options.allowWithWhere && hasWhere) ||
			(rule.options.allowWithLimit && limit !== undefined) ||
			(rule.options.allowWithTake &&
				toNumber(context.take) !== undefined) ||
			(Boolean(rule.options.allowSmallStaticModels) && hasWhere);
		emitIf(
			!allowed,
			context,
			emit,
			rule.level,
			'noUnboundedFindMany',
			'findMany should be bounded by where or limit.',
		);
	},
	requireExplicitLimit(context, options, emit) {
		const rule = normalizeRule(options.requireExplicitLimit);
		if (
			!matchesModelScope(context, rule.options) ||
			!matchesOperations(
				context,
				(rule.options.operations as
					| readonly RulesOperation[]
					| undefined) ?? ['findMany'],
			)
		)
			return;
		emitIf(
			getLimit(context) === undefined,
			context,
			emit,
			rule.level,
			'requireExplicitLimit',
			'This operation requires an explicit limit.',
			['limit'],
		);
	},
	maxLimit(context, options, emit) {
		const rule = normalizeRule(options.maxLimit);
		if (!matchesModelScope(context, rule.options)) return;
		if (
			!matchesOperations(
				context,
				(rule.options.applyTo as
					| readonly RulesOperation[]
					| undefined) ??
					(['findMany', 'paginate', 'cursor'] as const),
			)
		)
			return;
		const limit = getLimit(context);
		if (limit === undefined) return;
		emitIf(
			limit > rule.options.value,
			context,
			emit,
			rule.level,
			'maxLimit',
			`The requested limit ${limit} exceeds the maximum ${rule.options.value}.`,
			['limit'],
		);
	},
	requireOrderByForLimit(context, options, emit) {
		const rule = normalizeRule(options.requireOrderByForLimit);
		if (!matchesModelScope(context, rule.options)) return;
		const limit = getLimit(context);
		if (limit === undefined) return;
		emitIf(
			!hasOrderBy(context.orderBy),
			context,
			emit,
			rule.level,
			'requireOrderByForLimit',
			'Using limit without orderBy is not allowed.',
			['orderBy'],
		);
	},
	requireOrderByForPagination(context, options, emit) {
		const rule = normalizeRule(options.requireOrderByForPagination);
		if (
			context.operation !== 'paginate' ||
			!matchesModelScope(context, rule.options)
		)
			return;
		emitIf(
			!hasOrderBy(context.orderBy),
			context,
			emit,
			rule.level,
			'requireOrderByForPagination',
			'paginate requires orderBy.',
			['orderBy'],
		);
	},
	requireOrderByForCursor(context, options, emit) {
		const rule = normalizeRule(options.requireOrderByForCursor);
		if (
			context.operation !== 'cursor' ||
			!matchesModelScope(context, rule.options)
		)
			return;
		emitIf(
			!hasOrderBy(context.orderBy),
			context,
			emit,
			rule.level,
			'requireOrderByForCursor',
			'cursor pagination requires orderBy.',
			['orderBy'],
		);
	},
	requireStableOrderByForCursor(context, options, emit) {
		const rule = normalizeRule(options.requireStableOrderByForCursor);
		if (
			context.operation !== 'cursor' ||
			!matchesModelScope(context, rule.options) ||
			!hasOrderBy(context.orderBy)
		)
			return;
		const hasPk = hasPrimaryKeyOrder(context);
		if (hasPk === undefined) return;
		emitIf(
			Boolean(rule.options.requirePrimaryKeyInOrderBy) && !hasPk,
			context,
			emit,
			rule.level,
			'requireStableOrderByForCursor',
			'cursor pagination requires a stable orderBy that includes the primary key.',
			['orderBy'],
		);
	},
	maxIncludeDepth(context, options, emit) {
		const rule = normalizeRule(options.maxIncludeDepth);
		if (
			!matchesModelScope(context, rule.options) ||
			context.include === undefined
		)
			return;
		const stats = getIncludeStats(context.include);
		emitIf(
			stats.depth > rule.options.value,
			context,
			emit,
			rule.level,
			'maxIncludeDepth',
			`include depth ${stats.depth} exceeds the maximum ${rule.options.value}.`,
			['include'],
		);
	},
	maxIncludeRelations(context, options, emit) {
		const rule = normalizeRule(options.maxIncludeRelations);
		if (
			!matchesModelScope(context, rule.options) ||
			context.include === undefined
		)
			return;
		const stats = getIncludeStats(context.include);
		emitIf(
			stats.relations > rule.options.value,
			context,
			emit,
			rule.level,
			'maxIncludeRelations',
			`include relation count ${stats.relations} exceeds the maximum ${rule.options.value}.`,
			['include'],
		);
	},
	requireTransactionForLock(context, options, emit) {
		const rule = normalizeRule(options.requireTransactionForLock);
		if (
			!matchesModelScope(context, rule.options) ||
			context.lock === undefined
		)
			return;
		emitIf(
			!context.isInTransaction,
			context,
			emit,
			rule.level,
			'requireTransactionForLock',
			'Row locks require an active transaction.',
			['lock'],
		);
	},
	noLockWithInclude(context, options, emit) {
		const rule = normalizeRule(options.noLockWithInclude);
		if (
			!matchesModelScope(context, rule.options) ||
			context.lock === undefined ||
			context.include === undefined
		)
			return;
		emitIf(
			hasOwnKeys(context.include),
			context,
			emit,
			rule.level,
			'noLockWithInclude',
			'Using lock with include is not allowed.',
			['lock'],
		);
	},
	noInvalidLockCombination(context, options, emit) {
		const rule = normalizeRule(options.noInvalidLockCombination);
		if (!matchesModelScope(context, rule.options)) return;
		const lock = getLockRecord(context.lock);
		if (!lock) return;
		emitIf(
			Boolean(lock.skipLocked) && Boolean(lock.noWait),
			context,
			emit,
			rule.level,
			'noInvalidLockCombination',
			'skipLocked and noWait cannot be used together.',
			['lock'],
		);
	},
	requireOrderByForSkipLocked(context, options, emit) {
		const rule = normalizeRule(options.requireOrderByForSkipLocked);
		if (!matchesModelScope(context, rule.options)) return;
		const lock = getLockRecord(context.lock);
		if (!lock?.skipLocked) return;
		emitIf(
			!hasOrderBy(context.orderBy),
			context,
			emit,
			rule.level,
			'requireOrderByForSkipLocked',
			'skipLocked requires orderBy.',
			['orderBy'],
		);
	},
	requireLimitForSkipLocked(context, options, emit) {
		const rule = normalizeRule(options.requireLimitForSkipLocked);
		if (!matchesModelScope(context, rule.options)) return;
		const lock = getLockRecord(context.lock);
		if (!lock?.skipLocked) return;
		emitIf(
			getLimit(context) === undefined,
			context,
			emit,
			rule.level,
			'requireLimitForSkipLocked',
			'skipLocked requires a limit.',
			['limit'],
		);
	},
	noRawUnsafe(context, options, emit) {
		const rule = normalizeRule(options.noRawUnsafe);
		if (
			context.operation !== 'raw' ||
			context.context?.rawAction !== 'rawUnsafe'
		)
			return;
		emitIf(
			true,
			context,
			emit,
			rule.level,
			'noRawUnsafe',
			'rawUnsafe is not allowed.',
		);
	},
	requireRawComment(context, options, emit) {
		const rule = normalizeRule(options.requireRawComment);
		if (context.operation !== 'raw') return;
		const comment = context.rawComment?.trim();
		emitIf(
			!comment || comment.length < (rule.options.minLength ?? 1),
			context,
			emit,
			rule.level,
			'requireRawComment',
			'Raw queries require a comment.',
			['comment'],
		);
	},
	requireRawTimeout(context, options, emit) {
		const rule = normalizeRule(options.requireRawTimeout);
		if (context.operation !== 'raw') return;
		const timeout = context.rawTimeoutMs;
		emitIf(
			timeout === undefined,
			context,
			emit,
			rule.level,
			'requireRawTimeout',
			'Raw queries require timeoutMs.',
			['timeoutMs'],
		);
		if (timeout === undefined || rule.level === 'off') return;
		if (
			rule.options.defaultTimeoutMs !== undefined &&
			timeout > rule.options.defaultTimeoutMs
		)
			emit(
				createViolation(
					context,
					'requireRawTimeout',
					`Raw timeout ${timeout}ms exceeds the recommended default ${rule.options.defaultTimeoutMs}ms.`,
					['timeoutMs'],
				),
				rule.level,
			);
		if (
			rule.options.maxTimeoutMs !== undefined &&
			timeout > rule.options.maxTimeoutMs
		)
			emit(
				createViolation(
					context,
					'requireRawTimeout',
					`Raw timeout ${timeout}ms exceeds the maximum ${rule.options.maxTimeoutMs}ms.`,
					['timeoutMs'],
				),
				rule.level,
			);
	},
	noRawMutation(context, options, emit) {
		const rule = normalizeRule(options.noRawMutation);
		if (context.operation !== 'raw' || !context.queryText) return;
		emitIf(
			isMutationQuery(context.queryText, rule.options.allow),
			context,
			emit,
			rule.level,
			'noRawMutation',
			'Raw mutation queries are not allowed.',
		);
	},
	noRawWithoutTransaction(context, options, emit) {
		const rule = normalizeRule(options.noRawWithoutTransaction);
		if (context.operation !== 'raw' || context.isInTransaction) return;
		if (
			rule.options.onlyMutations &&
			(!context.queryText || !isMutationQuery(context.queryText))
		)
			return;
		emitIf(
			true,
			context,
			emit,
			rule.level,
			'noRawWithoutTransaction',
			'Raw queries must run inside a transaction.',
		);
	},
	requireTenantContext(context, options, emit) {
		const rule = normalizeRule(options.requireTenantContext);
		if (!matchesModelScope(context, rule.options)) return;
		const contextKey = rule.options.contextKey ?? 'tenantId';
		if (rule.options.allowSystem && resolveMetaValue(context, 'system'))
			return;
		emitIf(
			resolveMetaValue(context, contextKey) === undefined,
			context,
			emit,
			rule.level,
			'requireTenantContext',
			`Tenant context "${contextKey}" is required.`,
			['meta', contextKey],
		);
	},
	noTenantBypassWithoutSystem(context, options, emit) {
		const rule = normalizeRule(options.noTenantBypassWithoutSystem);
		const args = asRecord(context.query);
		if (!args || !('bypassTenant' in args) || !args.bypassTenant) return;
		const systemKey = rule.options.systemContextKey ?? 'system';
		emitIf(
			!resolveMetaValue(context, systemKey),
			context,
			emit,
			rule.level,
			'noTenantBypassWithoutSystem',
			'Tenant bypass requires system context.',
			['meta', systemKey],
		);
	},
	noTenantColumnOverride(context, options, emit) {
		const rule = normalizeRule(options.noTenantColumnOverride);
		if (!matchesModelScope(context, rule.options)) return;
		const tenantColumn = rule.options.tenantColumn ?? 'tenantId';
		const tenantValue = resolveMetaValue(
			context,
			rule.options.contextKey ?? tenantColumn,
		);
		if (tenantValue === undefined) return;
		const data = asRecord(context.data);
		if (!data || !(tenantColumn in data)) return;
		emitIf(
			data[tenantColumn] !== tenantValue,
			context,
			emit,
			rule.level,
			'noTenantColumnOverride',
			`Overriding ${tenantColumn} is not allowed.`,
			['data', tenantColumn],
		);
	},
	requireTenantOnCreate(context, options, emit) {
		const rule = normalizeRule(options.requireTenantOnCreate);
		if (
			(context.operation !== 'create' &&
				context.operation !== 'createMany' &&
				context.operation !== 'upsert' &&
				context.operation !== 'upsertMany') ||
			!matchesModelScope(context, rule.options)
		)
			return;
		const tenant = resolveMetaValue(context, 'tenantId');
		if (tenant === undefined) return;
		const rows =
			context.operation === 'createMany' ||
			context.operation === 'upsertMany'
				? Array.isArray(context.data)
					? context.data
					: []
				: context.operation === 'upsert'
					? [asRecord(context.data)?.create]
					: [context.data];
		for (const row of rows) {
			const record = asRecord(row);
			if (record && record.tenantId === undefined)
				emit(
					createViolation(
						context,
						'requireTenantOnCreate',
						'Create payload must include tenantId.',
						['data', 'tenantId'],
					),
					rule.level,
				);
		}
	},
	requireTenantOnUpdate(context, options, emit) {
		const rule = normalizeRule(options.requireTenantOnUpdate);
		if (
			(context.operation !== 'update' &&
				context.operation !== 'updateMany' &&
				context.operation !== 'updateEach' &&
				context.operation !== 'upsert') ||
			!matchesModelScope(context, rule.options)
		)
			return;
		const tenant = resolveMetaValue(context, 'tenantId');
		if (tenant === undefined || context.where !== undefined) return;
		emitIf(
			true,
			context,
			emit,
			rule.level,
			'requireTenantOnUpdate',
			'Update operations require tenant scoping.',
			['where'],
		);
	},
	requireTenantOnDelete(context, options, emit) {
		const rule = normalizeRule(options.requireTenantOnDelete);
		if (
			(context.operation !== 'delete' &&
				context.operation !== 'deleteMany') ||
			!matchesModelScope(context, rule.options)
		)
			return;
		const tenant = resolveMetaValue(context, 'tenantId');
		if (tenant === undefined || context.where !== undefined) return;
		emitIf(
			true,
			context,
			emit,
			rule.level,
			'requireTenantOnDelete',
			'Delete operations require tenant scoping.',
			['where'],
		);
	},
	noSensitiveSelect(context, options, emit) {
		const rule = normalizeRule(options.noSensitiveSelect);
		if (
			!matchesModelScope(context, rule.options) ||
			context.select === undefined
		)
			return;
		const args = asRecord(context.query);
		if (
			rule.options.allowWithSensitive &&
			args?.[rule.options.withSensitiveArg ?? 'withSensitive'] === true
		)
			return;
		const select = asRecord(context.select);
		if (!select) return;
		for (const field of SENSITIVE_FIELD_NAMES) {
			if (select[field] === true)
				emit(
					createViolation(
						context,
						'noSensitiveSelect',
						`Selecting sensitive field "${field}" is not allowed.`,
						['select', field],
					),
					rule.level,
				);
		}
	},
	requireExplicitSensitiveAccessReason(context, options, emit) {
		const rule = normalizeRule(
			options.requireExplicitSensitiveAccessReason,
		);
		if (
			!matchesModelScope(context, rule.options) ||
			context.select === undefined
		)
			return;
		const select = asRecord(context.select);
		if (!select) return;
		let requested = false;
		for (const field of SENSITIVE_FIELD_NAMES) {
			if (select[field] === true) requested = true;
		}
		if (!requested) return;
		const args = asRecord(context.query);
		if (args?.[rule.options.withSensitiveArg ?? 'withSensitive'] !== true)
			return;
		emitIf(
			!getReasonValue(context, rule.options.reasonArg ?? 'reason'),
			context,
			emit,
			rule.level,
			'requireExplicitSensitiveAccessReason',
			'Sensitive access requires an explicit reason.',
			['reason'],
		);
	},
	noQueryDeletedWithoutExplicitOptIn(context, options, emit) {
		const rule = normalizeRule(options.noQueryDeletedWithoutExplicitOptIn);
		if (!matchesModelScope(context, rule.options)) return;
		const args = asRecord(context.query);
		if (!args || !('deleted' in args) || args.deleted === 'without') return;
		if (args.deleted === 'with' || args.deleted === 'only') {
			if (
				rule.options.requireReason &&
				!getReasonValue(context, rule.options.reasonArg ?? 'reason')
			)
				emit(
					createViolation(
						context,
						'noQueryDeletedWithoutExplicitOptIn',
						'Querying deleted records requires an explicit reason.',
						['reason'],
					),
					rule.level,
				);
			return;
		}
	},
	noHardDeleteOnSoftDeleteModel(context, options, emit) {
		const rule = normalizeRule(options.noHardDeleteOnSoftDeleteModel);
		if (
			context.operation !== 'delete' ||
			!matchesModelScope(context, rule.options)
		)
			return;
		const args = asRecord(context.query);
		if (args?.mode !== 'hard') return;
		if (
			rule.options.allowWithContextKey &&
			resolveMetaValue(context, rule.options.allowWithContextKey)
		)
			return;
		if (rule.options.allowWithReason && getReasonValue(context)) return;
		emitIf(
			true,
			context,
			emit,
			rule.level,
			'noHardDeleteOnSoftDeleteModel',
			'Hard delete is not allowed on soft delete models.',
			['mode'],
		);
	},
	requireHardDeleteReason(context, options, emit) {
		const rule = normalizeRule(options.requireHardDeleteReason);
		if (
			context.operation !== 'delete' ||
			!matchesModelScope(context, rule.options)
		)
			return;
		const args = asRecord(context.query);
		if (args?.mode !== 'hard') return;
		emitIf(
			!getReasonValue(context, rule.options.reasonArg ?? 'reason'),
			context,
			emit,
			rule.level,
			'requireHardDeleteReason',
			'Hard delete requires a reason.',
			['reason'],
		);
	},
	noSystemModeWithoutReason(context, options, emit) {
		const rule = normalizeRule(options.noSystemModeWithoutReason);
		const args = asRecord(context.query);
		if (args?.system !== true) return;
		emitIf(
			!getReasonValue(context, rule.options.reasonArg ?? 'reason'),
			context,
			emit,
			rule.level,
			'noSystemModeWithoutReason',
			'System mode requires a reason.',
			['reason'],
		);
	},
	requireTimeoutForLongRunningOperation(context, options, emit) {
		const rule = normalizeRule(
			options.requireTimeoutForLongRunningOperation,
		);
		if (
			!LONG_RUNNING_OPERATIONS.has(context.operation) ||
			!matchesOperations(
				context,
				(rule.options.operations as
					| readonly RulesOperation[]
					| undefined) ?? ['raw', 'executeRaw', 'explain'],
			)
		)
			return;
		const timeout = context.rawTimeoutMs;
		emitIf(
			timeout === undefined,
			context,
			emit,
			rule.level,
			'requireTimeoutForLongRunningOperation',
			'This operation requires timeoutMs.',
			['timeoutMs'],
		);
		if (timeout === undefined || rule.level === 'off') return;
		if (
			rule.options.maxTimeoutMs !== undefined &&
			timeout > rule.options.maxTimeoutMs
		)
			emit(
				createViolation(
					context,
					'requireTimeoutForLongRunningOperation',
					`Timeout ${timeout}ms exceeds the maximum ${rule.options.maxTimeoutMs}ms.`,
					['timeoutMs'],
				),
				rule.level,
			);
	},
};

const buildOperationContext = (
	operation: RulesOperation,
	context: HookOperationContext | HookRawContext | HookTransactionContext,
	extra?: Partial<OperationContext>,
): OperationContext => {
	if ('action' in context) {
		return {
			context: {
				rawAction: context.action,
			},
			isInTransaction: context.isInTransaction,
			meta: asRecord(context.meta) ?? undefined,
			operation,
			queryText: context.query,
			rawComment: context.comment,
			rawTimeoutMs: context.timeoutMs,
			transactionContext: context.transactionContext,
			...extra,
		};
	}

	if ('transactionOptions' in context) {
		return {
			context: {
				depth: context.depth,
			},
			isInTransaction: true,
			meta: asRecord(context.meta) ?? undefined,
			operation,
			transactionContext: context.transactionContext,
			...extra,
		};
	}

	return {
		context: undefined,
		data: context.data,
		include: context.include,
		isInTransaction: context.isInTransaction,
		limit: (context.args as Record<string, unknown>)?.limit,
		lock: (context.args as Record<string, unknown>)?.lock,
		meta: asRecord(context.meta) ?? undefined,
		model: String(context.table),
		operation,
		orderBy: context.orderBy,
		select: context.select,
		take: context.take,
		transactionContext: context.transactionContext,
		where: context.where,
		query: context.args as Record<string, unknown>,
		...extra,
	} as OperationContext;
};

const runRules = async (
	pluginOptions: RulesPluginOptions<string, string>,
	context: OperationContext,
) => {
	if (pluginOptions.enabled === false) return;

	const emit = async (payload: RulesViolation) => {
		const { level } = payload;
		await pluginOptions.onViolation?.(payload);

		if (level === 'warn') {
			if (pluginOptions.warnOnViolation === false) return;
			pluginOptions.reporter?.warn?.(payload);
			return;
		}

		pluginOptions.reporter?.error?.(payload);
		if (pluginOptions.throwOnError === false) return;
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.OperationError,
			details: {
				level,
				meta: payload.meta,
				model: payload.model,
				operation: payload.operation,
				path: payload.path,
				query: payload.query,
				rule: payload.rule,
			},
			message: payload.message,
			operation: payload.operation,
			table: payload.model,
		});
	};

	const pending: RulesViolation[] = [];
	const collect = (
		violation: Omit<RulesViolation, 'level'>,
		level: RuleSeverity,
	) => {
		if (level === 'off') return;
		pending.push({ ...violation, level });
	};

	for (const key of Object.keys(evaluators) as RuleKey[]) {
		const evaluator = evaluators[key];
		if (!evaluator) continue;
		evaluator(context, pluginOptions, collect);
		for (const violation of pending.splice(0)) await emit(violation);
	}
};

/**
 * Creates the `@better-drizzle/rules` plugin.
 *
 * The plugin hooks into every read, write, raw, and transaction operation
 * and evaluates the configured rules before execution. Violations are
 * reported through `onViolation`, the optional `reporter`, and optionally
 * thrown as `BetterDrizzleError` instances.
 *
 * @typeParam TModel - Union of model/table names for type-safe scoping.
 * @typeParam TContextKey - Union of context key names for type-safe
 *   tenant and audit rules.
 * @param options - Rule configuration. Defaults to `{}` (all rules off).
 *   Use a preset (`safe`, `recommended`, `strict`, `tenant`, `production`)
 *   as a starting point and merge your overrides.
 * @returns A Better Drizzle plugin to pass in the `plugins` array.
 *
 * @example
 * ```ts
 * import { better } from 'better-drizzle';
 * import { rules, safe } from '@better-drizzle/rules';
 *
 * const db = better(drizzleDb, {
 *   schema,
 *   plugins: [
 * 	 	rules(safe())
 * 	 ],
 * });
 * ```
 *
 * @example
 * ```ts
 * // With overrides
 * import { rules, recommended } from '@better-drizzle/rules';
 *
 * const plugin = rules(recommended({
 *   maxLimit: { level: 'error', value: 200 },
 *   noDeleteManyWithoutWhere: 'error',
 * }));
 * ```
 */
export const rules = (options: RulesPluginOptions<string, string> = {}) =>
	definePlugin({
		description: 'Runtime rules plugin for better-drizzle operations.',
		hooks: {
			async beforeCreate(context) {
				await runRules(
					options,
					buildOperationContext(
						context.kind,
						context as unknown as HookOperationContext,
					),
				);
				return undefined;
			},
			beforeDelete(context) {
				return runRules(
					options,
					buildOperationContext(
						context.kind,
						context as unknown as HookOperationContext,
					),
				);
			},
			beforeQuery(context) {
				return runRules(
					options,
					buildOperationContext(
						context.kind,
						context as unknown as HookOperationContext,
					),
				);
			},
			beforeRaw(context) {
				return runRules(
					options,
					buildOperationContext(
						context.action === 'executeRaw' ? 'executeRaw' : 'raw',
						context as unknown as HookRawContext,
					),
				);
			},
			beforeTransaction(context) {
				return runRules(
					options,
					buildOperationContext(
						'transaction',
						context as unknown as HookTransactionContext,
					),
				);
			},
			async beforeUpdate(context) {
				await runRules(
					options,
					buildOperationContext(
						context.kind,
						context as unknown as HookOperationContext,
					),
				);
				return undefined;
			},
		},
		id: '@better-drizzle/rules',
		name: 'Rules',
		options,
		version,
	});

export default rules;
