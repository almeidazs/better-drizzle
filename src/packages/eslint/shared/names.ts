export const SENSITIVE_FIELD_NAMES = [
	'apiKey',
	'apiKeys',
	'password',
	'passwordHash',
	'secret',
	'secrets',
	'ssn',
	'token',
	'tokens',
] as const;

export const SUPPORTED_RUNTIME_RULE_KEYS = [
	'noDeleteManyWithoutWhere',
	'noUpdateManyWithoutWhere',
	'noDeleteWithoutWhere',
	'noUpdateWithoutWhere',
	'noEmptyWhere',
	'noUnboundedFindMany',
	'requireExplicitLimit',
	'maxLimit',
	'requireOrderByForLimit',
	'requireOrderByForPagination',
	'requireOrderByForCursor',
	'requireStableOrderByForCursor',
	'maxIncludeDepth',
	'maxIncludeRelations',
	'noLockWithInclude',
	'noInvalidLockCombination',
	'requireOrderByForSkipLocked',
	'requireLimitForSkipLocked',
	'noRawUnsafe',
	'requireRawComment',
	'requireRawTimeout',
	'noRawMutation',
	'noSensitiveSelect',
	'requireExplicitSensitiveAccessReason',
	'noWithoutPlugins',
	'noPluginBypassWithoutReason',
] as const;

export type SupportedRuntimeRuleKey =
	(typeof SUPPORTED_RUNTIME_RULE_KEYS)[number];

export const ruleIdByRuntimeKey: Record<SupportedRuntimeRuleKey, string> = {
	maxIncludeDepth: 'max-include-depth',
	maxIncludeRelations: 'max-include-relations',
	maxLimit: 'max-limit',
	noDeleteManyWithoutWhere: 'no-delete-many-without-where',
	noDeleteWithoutWhere: 'no-delete-without-where',
	noEmptyWhere: 'no-empty-where',
	noInvalidLockCombination: 'no-invalid-lock-combination',
	noLockWithInclude: 'no-lock-with-include',
	noPluginBypassWithoutReason: 'no-plugin-bypass-without-reason',
	noRawMutation: 'no-raw-mutation',
	noRawUnsafe: 'no-raw-unsafe',
	noSensitiveSelect: 'no-sensitive-select',
	noUnboundedFindMany: 'no-unbounded-find-many',
	noUpdateManyWithoutWhere: 'no-update-many-without-where',
	noUpdateWithoutWhere: 'no-update-without-where',
	noWithoutPlugins: 'no-without-plugins',
	requireExplicitLimit: 'require-explicit-limit',
	requireExplicitSensitiveAccessReason:
		'require-explicit-sensitive-access-reason',
	requireLimitForSkipLocked: 'require-limit-for-skip-locked',
	requireOrderByForCursor: 'require-order-by-for-cursor',
	requireOrderByForLimit: 'require-order-by-for-limit',
	requireOrderByForPagination: 'require-order-by-for-pagination',
	requireOrderByForSkipLocked: 'require-order-by-for-skip-locked',
	requireRawComment: 'require-raw-comment',
	requireRawTimeout: 'require-raw-timeout',
	requireStableOrderByForCursor: 'require-stable-order-by-for-cursor',
};

export const runtimeKeyByRuleId = Object.fromEntries(
	Object.entries(ruleIdByRuntimeKey).map(([runtimeKey, ruleId]) => [
		ruleId,
		runtimeKey,
	]),
) as Record<string, SupportedRuntimeRuleKey>;
