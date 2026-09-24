import type { MergeRulesOptions, RulesPluginOptions } from '../types';

export function merge<
	TModel extends string = string,
	TContextKey extends string = string,
>(
	options: MergeRulesOptions<TModel, TContextKey>,
): RulesPluginOptions<TModel, TContextKey> {
	return Object.assign({}, ...[options.extends].flat(), options.rules);
}

export function safe<
	TModel extends string = string,
	TContextKey extends string = string,
>(
	overrides?: RulesPluginOptions<TModel, TContextKey>,
): RulesPluginOptions<TModel, TContextKey> {
	return merge<TModel, TContextKey>({
		extends: {
			enabled: true,
			throwOnError: true,
			warnOnViolation: true,
			noDeleteManyWithoutWhere: 'error',
			noUpdateManyWithoutWhere: 'error',
			noDeleteWithoutWhere: 'error',
			noUpdateWithoutWhere: 'error',
			noEmptyWhere: {
				level: 'error',
				operations: ['update', 'updateMany', 'delete', 'deleteMany'],
				treatUndefinedAsEmpty: true,
				treatEmptyAndOrAsEmpty: true,
			},
			noUnboundedFindMany: {
				level: 'warn',
				allowWithWhere: false,
				allowWithLimit: true,
				allowWithTake: true,
				allowSmallStaticModels: true,
			},
			maxLimit: {
				level: 'warn',
				value: 1000,
				applyTo: ['findMany', 'paginate', 'cursor'],
			},
			requireOrderByForCursor: 'error',
			requireTransactionForLock: 'warn',
			noLockWithInclude: 'error',
			noInvalidLockCombination: 'error',
			requireLimitForSkipLocked: 'error',
			noRawUnsafe: 'error',
			noUnsupportedDialectFeature: 'error',
			noSilentDialectFallback: 'warn',
		},
		rules: overrides,
	});
}

export function recommended<
	TModel extends string = string,
	TContextKey extends string = string,
>(
	overrides?: RulesPluginOptions<TModel, TContextKey>,
): RulesPluginOptions<TModel, TContextKey> {
	return merge<TModel, TContextKey>({
		extends: [
			safe<TModel, TContextKey>(),
			{
				requireStableOrderByForCursor: {
					level: 'warn',
					allowAppendPrimaryKey: true,
					requirePrimaryKeyInOrderBy: false,
				},
				maxIncludeDepth: {
					level: 'warn',
					value: 3,
				},
				maxIncludeRelations: {
					level: 'warn',
					value: 5,
				},
				requireOrderByForSkipLocked: 'warn',
				requireRawTimeout: {
					level: 'warn',
					defaultTimeoutMs: 5000,
					maxTimeoutMs: 30_000,
				},
				noRawMutation: {
					level: 'warn',
					allow: ['create extension', 'refresh materialized view'],
				},
				requireTenantContext: {
					level: 'error',
					allowSystem: true,
				},
				noSensitiveSelect: {
					level: 'error',
					allowWithSensitive: true,
					withSensitiveArg: 'withSensitive',
				},
				noHardDeleteOnSoftDeleteModel: {
					level: 'error',
					allowWithReason: true,
				},
				noWithoutPlugins: 'warn',
				noPluginBypassWithoutReason: {
					level: 'warn',
					reasonArg: 'reason',
				},
				noSystemModeWithoutReason: {
					level: 'warn',
					reasonArg: 'reason',
				},
				requireAuditContext: {
					level: 'warn',
					contextKeys: ['userId' as TContextKey],
					operations: [
						'create',
						'createMany',
						'update',
						'updateMany',
						'updateEach',
						'delete',
						'deleteMany',
					],
				},
				maxNestedWriteDepth: {
					level: 'warn',
					value: 2,
				},
				requireTransactionForNestedWrite: {
					level: 'warn',
					allowAutoTransaction: true,
				},
				requireUniqueWhereForConnect: 'error',
				requireUniqueWhereForConnectOrCreate: 'error',
				noAmbiguousNestedRelation: 'error',
				requireOrderByForGroupByLimit: 'warn',
				noDynamicPreparedShape: 'error',
				noPreparedNameConflict: 'error',
				requireTimeoutForLongRunningOperation: {
					level: 'warn',
					operations: ['raw', 'executeRaw', 'explain'],
					defaultTimeoutMs: 5000,
					maxTimeoutMs: 60_000,
				},
			},
		],
		rules: overrides,
	});
}

export function strict<
	TModel extends string = string,
	TContextKey extends string = string,
>(
	overrides?: RulesPluginOptions<TModel, TContextKey>,
): RulesPluginOptions<TModel, TContextKey> {
	return merge<TModel, TContextKey>({
		extends: [
			recommended<TModel, TContextKey>(),
			{
				noUnboundedFindMany: {
					level: 'error',
					allowWithWhere: false,
					allowWithLimit: true,
					allowWithTake: true,
					allowSmallStaticModels: false,
				},
				requireExplicitLimit: {
					level: 'warn',
					operations: ['findMany'],
				},
				maxLimit: {
					level: 'error',
					value: 500,
					applyTo: ['findMany', 'paginate', 'cursor'],
				},
				requireOrderByForLimit: 'warn',
				requireOrderByForPagination: 'warn',
				requireStableOrderByForCursor: {
					level: 'error',
					allowAppendPrimaryKey: true,
					requirePrimaryKeyInOrderBy: false,
				},
				maxIncludeDepth: {
					level: 'error',
					value: 2,
				},
				maxIncludeRelations: {
					level: 'error',
					value: 3,
				},
				requireTransactionForLock: 'error',
				requireOrderByForSkipLocked: 'error',
				requireLimitForSkipLocked: 'error',
				requireRawComment: {
					level: 'warn',
					minLength: 8,
				},
				requireRawTimeout: {
					level: 'error',
					defaultTimeoutMs: 5000,
					maxTimeoutMs: 30_000,
				},
				noRawMutation: {
					level: 'error',
					allow: ['create extension', 'refresh materialized view'],
				},
				noRawWithoutTransaction: {
					level: 'warn',
					onlyMutations: true,
				},
				requireTenantContext: {
					level: 'error',
					allowSystem: true,
				},
				noTenantBypassWithoutSystem: {
					level: 'error',
					systemContextKey: 'system' as TContextKey,
				},
				noTenantColumnOverride: {
					level: 'error',
					contextKey: 'tenantId' as TContextKey,
					tenantColumn: 'tenantId',
				},
				requireTenantOnCreate: 'error',
				requireTenantOnUpdate: 'error',
				requireTenantOnDelete: 'error',
				requireExplicitSensitiveAccessReason: {
					level: 'error',
					reasonArg: 'reason',
					withSensitiveArg: 'withSensitive',
				},
				noQueryDeletedWithoutExplicitOptIn: {
					level: 'warn',
					requireReason: true,
					reasonArg: 'reason',
				},
				requireHardDeleteReason: {
					level: 'error',
					reasonArg: 'reason',
				},
				noPluginBypassWithoutReason: {
					level: 'error',
					reasonArg: 'reason',
				},
				noSystemModeWithoutReason: {
					level: 'error',
					reasonArg: 'reason',
				},
				maxNestedWriteDepth: {
					level: 'error',
					value: 1,
				},
				requireWhereForAggregate: 'warn',
				requireLimitForGroupBy: 'warn',
				maxGroupByLimit: {
					level: 'error',
					value: 1000,
				},
				requireTimeoutForLongRunningOperation: {
					level: 'error',
					operations: ['raw', 'executeRaw', 'explain'],
					defaultTimeoutMs: 5000,
					maxTimeoutMs: 30_000,
				},
			},
		],
		rules: overrides,
	});
}
