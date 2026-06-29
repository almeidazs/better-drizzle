/**
 * Severity level for a rule violation.
 *
 * - `'off'` -- the rule is disabled and will never emit.
 * - `'warn'` -- the violation is logged/reported but the operation proceeds.
 * - `'error'` -- the violation is logged/reported and the operation is
 *   rejected (unless `throwOnError` is `false`).
 */
export type RuleSeverity = 'off' | 'warn' | 'error';

/**
 * Configuration shape for a single rule.
 *
 * A rule can be enabled/disabled with a shorthand or configured with
 * per-rule options:
 *
 * - `true` -- enabled at `'error'` level with default options.
 * - `false` / `'off'` -- disabled.
 * - `'warn'` / `'error'` -- enabled at the given severity with default options.
 * - `{ level?, ...options }` -- full configuration object. When `level` is
 *   omitted it defaults to `'error'`.
 *
 * @typeParam TOptions - Extra per-rule options beyond `level`. Defaults to
 *   `Record<never, never>` (no extra options).
 *
 * @example
 * ```ts
 * // Shorthand forms
 * const a: RuleSetting = true;            // error, default options
 * const b: RuleSetting = false;           // off
 * const c: RuleSetting = 'warn';          // warn, default options
 *
 * // Full form with per-rule options
 * const d: RuleSetting<{ value: number }> = {
 *   level: 'error',
 *   value: 500,
 * };
 * ```
 */
export type RuleSetting<TOptions extends object = Record<never, never>> =
	| boolean
	| RuleSeverity
	| ({
			level?: RuleSeverity;
	  } & TOptions);

/**
 * Utility type that accepts either a single value or a readonly array of
 * that value.
 */
export type MaybeArray<T> = T | readonly T[];

/**
 * The set of Better Drizzle operations that the rules plugin can intercept.
 *
 * This includes all CRUD operations, pagination, raw SQL, transactions,
 * and explain.
 */
export type RulesOperation =
	| 'findMany'
	| 'findFirst'
	| 'findOne'
	| 'findUnique'
	| 'findFirstOrThrow'
	| 'create'
	| 'createMany'
	| 'update'
	| 'updateMany'
	| 'updateEach'
	| 'delete'
	| 'deleteMany'
	| 'upsert'
	| 'upsertMany'
	| 'count'
	| 'exists'
	| 'paginate'
	| 'cursor'
	| 'raw'
	| 'executeRaw'
	| 'transaction'
	| 'explain';

/**
 * String alias for a model/table name used in rule scope filtering.
 */
export type RulesModelName = string;

/**
 * String alias for a context key (e.g. `'tenantId'`, `'userId'`) used in
 * tenant and audit rules.
 */
export type RulesContextKey = string;

/**
 * A single rule violation emitted by the rules plugin.
 *
 * Violations are created for every rule check that fails. They carry enough
 * metadata for reporters, loggers, and error handlers to understand what
 * happened and why.
 */
export type RulesViolation = {
	/** The rule key that was violated (e.g. `"noDeleteManyWithoutWhere"`). */
	rule: string;

	/** The severity of the violation (`'warn'` or `'error'`). */
	level: Exclude<RuleSeverity, 'off'>;

	/** A human-readable description of the violation. */
	message: string;

	/** The operation that triggered the violation. */
	operation?: RulesOperation;

	/** The model/table name the operation targeted. */
	model?: string;

	/** The path in the query args where the issue was found (e.g. `["where"]`). */
	path?: readonly string[];

	/**
	 * A snapshot of the query arguments at the time of the violation.
	 * Only the relevant fields for the operation are populated.
	 */
	query?: {
		where?: unknown;
		data?: unknown;
		select?: unknown;
		include?: unknown;
		orderBy?: unknown;
		limit?: unknown;
		lock?: unknown;
	};

	/** Additional runtime context (e.g. `{ rawAction: "rawUnsafe" }`). */
	context?: Record<string, unknown>;

	/** Merged metadata from `$withContext(...)` and per-call `meta`. */
	meta?: Record<string, unknown>;
};

/**
 * Optional reporter interface for receiving rule violations.
 *
 * Pass a `RulesReporter` to the plugin options to integrate with logging
 * libraries, monitoring systems, or custom output handlers.
 */
export type RulesReporter = {
	/** Called when a violation at `'warn'` level is emitted. */
	warn?: (violation: RulesViolation) => void;

	/** Called when a violation at `'error'` level is emitted. */
	error?: (violation: RulesViolation) => void;
};

/**
 * Scope filter for model-specific rules.
 *
 * Use `models` to target specific tables, `ignoreModels` to exclude tables,
 * and `operations` to limit the rule to certain operation types. When all
 * fields are omitted the rule applies to every model and operation.
 */
export type ModelRuleScope<TModel extends string = string> = {
	/** When set, the rule only applies to these models. */
	models?: readonly TModel[];

	/** When set, the rule is skipped for these models. */
	ignoreModels?: readonly TModel[];

	/** When set, the rule only applies to these operations. */
	operations?: readonly RulesOperation[];
};

/**
 * Configuration options for the `@better-drizzle/rules` plugin.
 *
 * Every rule is optional. When omitted the rule is disabled. Rules can be
 * set to `true` (error), `false`/`'off'` (disabled), `'warn'`, `'error'`,
 * or a full `{ level, ...options }` object.
 *
 * @typeParam TModel - Union of model/table names for type-safe scoping.
 *   Defaults to `string`.
 * @typeParam TContextKey - Union of context key names for type-safe tenant
 *   and audit rules. Defaults to `string`.
 *
 * @example
 * ```ts
 * import { rules, safe } from '@better-drizzle/rules';
 *
 * const plugin = rules({
 *   ...safe(),
 *   noDeleteManyWithoutWhere: 'error',
 *   maxLimit: { level: 'warn', value: 1000 },
 * });
 * ```
 */
export type RulesPluginOptions<
	TModel extends string = string,
	TContextKey extends string = string,
> = {
	/**
	 * Global switch.
	 *
	 * When `false` the plugin is installed but no rules are evaluated.
	 *
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * Whether `'error'`-level violations should throw a `BetterDrizzleError`.
	 *
	 * When `false` errors are reported through `reporter` and `onViolation`
	 * but do not interrupt the operation.
	 *
	 * @default true
	 */
	throwOnError?: boolean;

	/**
	 * Whether `'warn'`-level violations should be reported through the
	 * configured `reporter`.
	 *
	 * When `false` warnings are only passed to `onViolation`.
	 *
	 * @default true
	 */
	warnOnViolation?: boolean;

	/**
	 * Optional custom reporter for receiving violations as structured objects.
	 *
	 * Use this to integrate with logging libraries (e.g. pino, winston) or
	 * monitoring systems.
	 */
	reporter?: RulesReporter;

	/**
	 * Called for every violation, regardless of severity.
	 *
	 * Use this for metrics collection, audit logging, or custom side effects.
	 * The callback may be async.
	 */
	onViolation?: (violation: RulesViolation) => void | Promise<void>;

	// ---------------------------------------------------------------------------
	// Destructive operation rules
	// ---------------------------------------------------------------------------

	/**
	 * Rejects `deleteMany` calls that do not include a `where` clause.
	 *
	 * Prevents accidental full-table deletes.
	 */
	noDeleteManyWithoutWhere?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Rejects `updateMany` calls that do not include a `where` clause.
	 *
	 * Prevents accidental full-table updates.
	 */
	noUpdateManyWithoutWhere?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Rejects single-row `delete` calls that do not include a `where` clause.
	 */
	noDeleteWithoutWhere?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Rejects single-row `update` calls that do not include a `where` clause.
	 */
	noUpdateWithoutWhere?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Rejects operations with an empty or undefined `where` clause.
	 *
	 * Extra options:
	 * - `operations` -- which operations to check (defaults to all).
	 * - `treatUndefinedAsEmpty` -- treat missing `where` as empty (default `true`).
	 * - `treatEmptyAndOrAsEmpty` -- treat `{ AND: [] }` / `{ OR: [] }` as empty
	 *   (default `false`).
	 */
	noEmptyWhere?: RuleSetting<
		ModelRuleScope<TModel> & {
			operations?: readonly RulesOperation[];
			treatUndefinedAsEmpty?: boolean;
			treatEmptyAndOrAsEmpty?: boolean;
		}
	>;

	// ---------------------------------------------------------------------------
	// Read/query safety
	// ---------------------------------------------------------------------------

	/**
	 * Rejects `findMany` calls that are not bounded by `where` or `limit`.
	 *
	 * Extra options:
	 * - `allowWithWhere` -- allow unbounded reads when `where` is present.
	 * - `allowWithLimit` -- allow when a `limit`/`take` is set.
	 * - `allowWithTake` -- allow when `take` is set.
	 * - `allowSmallStaticModels` -- allow when `where` is present (alias).
	 */
	noUnboundedFindMany?: RuleSetting<
		ModelRuleScope<TModel> & {
			allowWithWhere?: boolean;
			allowWithLimit?: boolean;
			allowWithTake?: boolean;
			allowSmallStaticModels?: boolean;
		}
	>;

	/**
	 * Requires an explicit `limit` / `take` on the specified operations.
	 *
	 * Defaults to checking only `findMany`.
	 */
	requireExplicitLimit?: RuleSetting<
		ModelRuleScope<TModel> & {
			operations?: readonly Extract<RulesOperation, 'findMany'>[];
		}
	>;

	/**
	 * Rejects operations where the resolved `limit` exceeds `value`.
	 *
	 * Defaults to checking `findMany`, `paginate`, and `cursor`.
	 */
	maxLimit?: RuleSetting<
		ModelRuleScope<TModel> & {
			value: number;
			applyTo?: readonly Extract<
				RulesOperation,
				'findMany' | 'paginate' | 'cursor' | 'chunk' | 'groupBy'
			>[];
		}
	>;

	/**
	 * Requires `orderBy` when `limit` / `take` is present.
	 */
	requireOrderByForLimit?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Requires `orderBy` for `paginate` operations.
	 */
	requireOrderByForPagination?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Requires `orderBy` for `cursor` pagination.
	 */
	requireOrderByForCursor?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Requires a stable `orderBy` for cursor pagination, optionally including
	 * the primary key column.
	 *
	 * Extra options:
	 * - `allowAppendPrimaryKey` -- allow appending the PK automatically.
	 * - `requirePrimaryKeyInOrderBy` -- require `id` in the `orderBy` columns.
	 */
	requireStableOrderByForCursor?: RuleSetting<
		ModelRuleScope<TModel> & {
			allowAppendPrimaryKey?: boolean;
			requirePrimaryKeyInOrderBy?: boolean;
		}
	>;

	/**
	 * Limits the maximum nesting depth of `include` / relation queries.
	 */
	maxIncludeDepth?: RuleSetting<
		ModelRuleScope<TModel> & {
			value: number;
		}
	>;

	/**
	 * Limits the total number of relations loaded via `include`.
	 */
	maxIncludeRelations?: RuleSetting<
		ModelRuleScope<TModel> & {
			value: number;
		}
	>;

	// ---------------------------------------------------------------------------
	// Locks / transactions
	// ---------------------------------------------------------------------------

	/**
	 * Requires an active transaction when `lock` is used.
	 */
	requireTransactionForLock?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Rejects `lock` when `include` is also present.
	 *
	 * This prevents silently dropping the lock on relation queries.
	 */
	noLockWithInclude?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Rejects mutually exclusive lock options (`skipLocked` + `noWait`).
	 */
	noInvalidLockCombination?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Requires `orderBy` when `skipLocked` is used.
	 */
	requireOrderByForSkipLocked?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Requires a `limit` when `skipLocked` is used.
	 */
	requireLimitForSkipLocked?: RuleSetting<ModelRuleScope<TModel>>;

	// ---------------------------------------------------------------------------
	// Raw SQL
	// ---------------------------------------------------------------------------

	/**
	 * Rejects `$rawUnsafe` calls entirely.
	 *
	 * Safe raw APIs (`$raw`, `$executeRaw`) are not affected.
	 */
	noRawUnsafe?: RuleSetting;

	/**
	 * Requires a SQL comment on raw queries.
	 *
	 * Extra options:
	 * - `minLength` -- minimum comment length (default `1`).
	 */
	requireRawComment?: RuleSetting<{
		minLength?: number;
	}>;

	/**
	 * Requires `timeoutMs` on raw queries, with optional bounds.
	 *
	 * Extra options:
	 * - `defaultTimeoutMs` -- warn when timeout exceeds this value.
	 * - `maxTimeoutMs` -- error when timeout exceeds this value.
	 */
	requireRawTimeout?: RuleSetting<{
		defaultTimeoutMs?: number;
		maxTimeoutMs?: number;
	}>;

	/**
	 * Rejects raw queries that contain mutation verbs (INSERT, UPDATE, DELETE,
	 * etc.).
	 *
	 * Extra options:
	 * - `allow` -- SQL prefixes that are explicitly allowed.
	 */
	noRawMutation?: RuleSetting<{
		allow?: readonly string[];
	}>;

	/**
	 * Requires raw queries to run inside a transaction.
	 *
	 * Extra options:
	 * - `onlyMutations` -- only enforce for mutation queries (default `false`).
	 */
	noRawWithoutTransaction?: RuleSetting<{
		onlyMutations?: boolean;
	}>;

	// ---------------------------------------------------------------------------
	// Multi-tenant safety
	// ---------------------------------------------------------------------------

	/**
	 * Requires a tenant context key in `meta` or `transactionContext` for
	 * the specified models.
	 *
	 * Extra options:
	 * - `contextKey` -- the metadata key to check (default `'tenantId'`).
	 * - `allowSystem` -- skip the check when `meta.system` is truthy.
	 */
	requireTenantContext?: RuleSetting<
		ModelRuleScope<TModel> & {
			contextKey?: TContextKey;
			allowSystem?: boolean;
		}
	>;

	/**
	 * Requires `system` context when `bypassTenant` is passed in query args.
	 */
	noTenantBypassWithoutSystem?: RuleSetting<{
		systemContextKey?: TContextKey;
	}>;

	/**
	 * Prevents overwriting the tenant column in `data` with a value that
	 * differs from the current tenant context.
	 *
	 * Extra options:
	 * - `tenantColumn` -- the column name to protect (default `'tenantId'`).
	 * - `contextKey` -- the metadata key that holds the tenant value.
	 */
	noTenantColumnOverride?: RuleSetting<
		ModelRuleScope<TModel> & {
			tenantColumn?: string;
			contextKey?: TContextKey;
		}
	>;

	/**
	 * Requires `tenantId` in the create payload when tenant context is present.
	 */
	requireTenantOnCreate?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Requires a `where` clause on update operations when tenant context is
	 * present (prevents tenant-wide updates).
	 */
	requireTenantOnUpdate?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Requires a `where` clause on delete operations when tenant context is
	 * present (prevents tenant-wide deletes).
	 */
	requireTenantOnDelete?: RuleSetting<ModelRuleScope<TModel>>;

	// ---------------------------------------------------------------------------
	// Sensitive fields
	// ---------------------------------------------------------------------------

	/**
	 * Rejects `select` that includes known sensitive field names (e.g.
	 * `password`, `token`, `secret`).
	 *
	 * Extra options:
	 * - `allowWithSensitive` -- allow when an explicit opt-in arg is present.
	 * - `withSensitiveArg` -- the arg name to look for (default `'withSensitive'`).
	 */
	noSensitiveSelect?: RuleSetting<
		ModelRuleScope<TModel> & {
			allowWithSensitive?: boolean;
			withSensitiveArg?: string;
		}
	>;

	/**
	 * Requires an explicit `reason` when accessing sensitive fields with the
	 * opt-in argument.
	 *
	 * Extra options:
	 * - `withSensitiveArg` -- the opt-in arg name (default `'withSensitive'`).
	 * - `reasonArg` -- the reason arg name (default `'reason'`).
	 */
	requireExplicitSensitiveAccessReason?: RuleSetting<
		ModelRuleScope<TModel> & {
			withSensitiveArg?: string;
			reasonArg?: string;
		}
	>;

	/**
	 * Rejects sensitive field names in log/audit payloads.
	 *
	 * Extra options:
	 * - `checkContext` -- also check `context` for sensitive keys.
	 * - `checkAuditPayload` -- also check the audit payload.
	 */
	noSensitiveFieldsInLogs?: RuleSetting<
		ModelRuleScope<TModel> & {
			checkContext?: boolean;
			checkAuditPayload?: boolean;
		}
	>;

	// ---------------------------------------------------------------------------
	// Soft delete
	// ---------------------------------------------------------------------------

	/**
	 * Rejects hard deletes on models that use soft delete.
	 *
	 * Extra options:
	 * - `allowWithContextKey` -- allow when a specific context key is present.
	 * - `allowWithReason` -- allow when a `reason` is provided.
	 */
	noHardDeleteOnSoftDeleteModel?: RuleSetting<
		ModelRuleScope<TModel> & {
			allowWithContextKey?: TContextKey;
			allowWithReason?: boolean;
		}
	>;

	/**
	 * Requires an explicit reason when performing a hard delete.
	 *
	 * Extra options:
	 * - `reasonArg` -- the arg name to look for (default `'reason'`).
	 */
	requireHardDeleteReason?: RuleSetting<
		ModelRuleScope<TModel> & {
			reasonArg?: string;
		}
	>;

	/**
	 * Rejects queries on deleted records unless explicitly opted in with
	 * `deleted: "with"` or `deleted: "only"`.
	 *
	 * Extra options:
	 * - `requireReason` -- require a reason when querying deleted records.
	 * - `reasonArg` -- the reason arg name (default `'reason'`).
	 */
	noQueryDeletedWithoutExplicitOptIn?: RuleSetting<
		ModelRuleScope<TModel> & {
			requireReason?: boolean;
			reasonArg?: string;
		}
	>;

	/**
	 * Requires an explicit reason when restoring soft-deleted records.
	 *
	 * Extra options:
	 * - `reasonArg` -- the reason arg name (default `'reason'`).
	 */
	requireRestoreReason?: RuleSetting<
		ModelRuleScope<TModel> & {
			reasonArg?: string;
		}
	>;

	// ---------------------------------------------------------------------------
	// Plugin/system bypass
	// ---------------------------------------------------------------------------

	/**
	 * Warns when `$withoutPlugins` is used, as it bypasses all plugin
	 * transforms and guards.
	 */
	noWithoutPlugins?: RuleSetting;

	/**
	 * Requires a reason when `$withoutPlugins` is used.
	 *
	 * Extra options:
	 * - `reasonArg` -- the reason arg name (default `'reason'`).
	 */
	noPluginBypassWithoutReason?: RuleSetting<{
		reasonArg?: string;
	}>;

	/**
	 * Requires a reason when system mode is active.
	 *
	 * Extra options:
	 * - `reasonArg` -- the reason arg name (default `'reason'`).
	 */
	noSystemModeWithoutReason?: RuleSetting<{
		reasonArg?: string;
	}>;

	// ---------------------------------------------------------------------------
	// Audit logs
	// ---------------------------------------------------------------------------

	/**
	 * Requires audit context keys (e.g. `userId`) to be present in `meta`
	 * for write operations.
	 *
	 * Extra options:
	 * - `contextKeys` -- the keys to require (default `['userId']`).
	 * - `operations` -- which operations to check.
	 */
	requireAuditContext?: RuleSetting<
		ModelRuleScope<TModel> & {
			contextKeys?: readonly TContextKey[];
			operations?: readonly Extract<
				RulesOperation,
				| 'create'
				| 'createMany'
				| 'update'
				| 'updateById'
				| 'updateMany'
				| 'updateEach'
				| 'delete'
				| 'deleteById'
				| 'deleteMany'
				| 'restore'
				| 'restoreById'
			>[];
		}
	>;

	/**
	 * Warns when audit logging is skipped for ignored model writes.
	 *
	 * Extra options:
	 * - `criticalModels` -- models that should always be audited.
	 */
	noAuditLogForIgnoredModelWrite?: RuleSetting<
		ModelRuleScope<TModel> & {
			criticalModels?: readonly TModel[];
		}
	>;

	// ---------------------------------------------------------------------------
	// Nested writes
	// ---------------------------------------------------------------------------

	/**
	 * Limits the maximum nesting depth of write operations (e.g. nested
	 * `create` inside a relation).
	 */
	maxNestedWriteDepth?: RuleSetting<{
		value: number;
	}>;

	/**
	 * Requires a transaction for nested write operations.
	 *
	 * Extra options:
	 * - `allowAutoTransaction` -- allow when an auto-transaction wrapper is
	 *   present (default `false`).
	 */
	requireTransactionForNestedWrite?: RuleSetting<{
		allowAutoTransaction?: boolean;
	}>;

	/**
	 * Requires `where` with a unique field for `connect` operations.
	 */
	requireUniqueWhereForConnect?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Requires `where` with a unique field for `connectOrCreate` operations.
	 */
	requireUniqueWhereForConnectOrCreate?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Rejects ambiguous nested relation writes where the target row cannot
	 * be uniquely identified.
	 */
	noAmbiguousNestedRelation?: RuleSetting<ModelRuleScope<TModel>>;

	// ---------------------------------------------------------------------------
	// Aggregate / groupBy
	// ---------------------------------------------------------------------------

	/**
	 * Requires `where` for aggregate operations (count, sum, avg, etc.).
	 */
	requireWhereForAggregate?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Requires `limit` / `take` for `groupBy` operations.
	 */
	requireLimitForGroupBy?: RuleSetting<ModelRuleScope<TModel>>;

	/**
	 * Limits the maximum `limit` for `groupBy` operations.
	 */
	maxGroupByLimit?: RuleSetting<
		ModelRuleScope<TModel> & {
			value: number;
		}
	>;

	/**
	 * Requires `orderBy` when `limit` is used with `groupBy`.
	 */
	requireOrderByForGroupByLimit?: RuleSetting<ModelRuleScope<TModel>>;

	// ---------------------------------------------------------------------------
	// Prepared statements
	// ---------------------------------------------------------------------------

	/**
	 * Rejects prepared statements with dynamically computed output shapes.
	 */
	noDynamicPreparedShape?: RuleSetting;

	/**
	 * Rejects prepared statement name conflicts across operations.
	 */
	noPreparedNameConflict?: RuleSetting;

	// ---------------------------------------------------------------------------
	// Dialect support
	// ---------------------------------------------------------------------------

	/**
	 * Rejects operations that are not supported by the current dialect.
	 */
	noUnsupportedDialectFeature?: RuleSetting;

	/**
	 * Warns when a dialect silently falls back to a different behavior.
	 */
	noSilentDialectFallback?: RuleSetting;

	// ---------------------------------------------------------------------------
	// Long-running operations
	// ---------------------------------------------------------------------------

	/**
	 * Requires `timeoutMs` for long-running operations (raw, executeRaw,
	 * explain, etc.).
	 *
	 * Extra options:
	 * - `operations` -- which operations to check.
	 * - `defaultTimeoutMs` -- warn when timeout exceeds this value.
	 * - `maxTimeoutMs` -- error when timeout exceeds this value.
	 */
	requireTimeoutForLongRunningOperation?: RuleSetting<{
		operations?: readonly Extract<
			RulesOperation,
			| 'raw'
			| 'executeRaw'
			| 'explain'
			| 'materializedViewRefresh'
			| 'advisoryLock'
		>[];

		defaultTimeoutMs?: number;
		maxTimeoutMs?: number;
	}>;
};

export type NormalizedRule<TOptions extends object = Record<never, never>> = {
	level: RuleSeverity;
	options: TOptions;
};

export type OperationContext = {
	context?: Record<string, unknown>;
	data?: unknown;
	include?: unknown;
	isInTransaction: boolean;
	lock?: unknown;
	limit?: unknown;
	meta?: Record<string, unknown>;
	model?: string;
	operation: RulesOperation;
	orderBy?: unknown;
	path?: readonly string[];
	query?: Record<string, unknown>;
	queryText?: string;
	rawComment?: string;
	rawTimeoutMs?: number;
	select?: unknown;
	take?: unknown;
	transactionContext?: Record<string, unknown>;
	where?: unknown;
};

export type RuleKey = Exclude<
	keyof RulesPluginOptions<string, string>,
	'enabled' | 'throwOnError' | 'warnOnViolation' | 'reporter' | 'onViolation'
>;

export type RuleEmit = (
	violation: Omit<RulesViolation, 'level'>,
	level: RuleSeverity,
) => void;

export type RuleEvaluator = (
	context: OperationContext,
	options: RulesPluginOptions<string, string>,
	emit: RuleEmit,
) => void;

export type HookOperationContext = {
	args: Record<string, unknown>;
	data?: unknown;
	include?: unknown;
	isInTransaction: boolean;
	meta?: unknown;
	orderBy?: unknown;
	select?: unknown;
	table: string;
	take?: unknown;
	transactionContext?: Record<string, unknown>;
	where?: unknown;
};

export type HookRawContext = {
	action: 'raw' | 'executeRaw' | 'rawUnsafe';
	comment?: string;
	isInTransaction: boolean;
	meta?: unknown;
	query: string;
	timeoutMs?: number;
	transactionContext?: Record<string, unknown>;
};

export type HookTransactionContext = {
	depth: number;
	isInTransaction: true;
	meta?: unknown;
	transactionContext?: Record<string, unknown>;
	transactionOptions: Record<string, unknown>;
};
