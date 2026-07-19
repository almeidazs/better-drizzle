import type { Rule } from 'eslint';
import {
	noDeleteManyWithoutWhere,
	noDeleteWithoutWhere,
	noEmptyWhere,
	noUpdateManyWithoutWhere,
	noUpdateWithoutWhere,
} from './rules/destructive';
import { maxIncludeDepth, maxIncludeRelations } from './rules/include';
import {
	noInvalidLockCombination,
	noLockWithInclude,
	requireLimitForSkipLocked,
	requireOrderByForSkipLocked,
} from './rules/locks';
import { noPluginBypassWithoutReason, noWithoutPlugins } from './rules/plugins';
import {
	maxLimit,
	noUnboundedFindMany,
	requireExplicitLimit,
	requireOrderByForCursor,
	requireOrderByForLimit,
	requireOrderByForPagination,
	requireStableOrderByForCursor,
} from './rules/query';
import {
	noRawMutation,
	noRawUnsafe,
	requireRawComment,
	requireRawTimeout,
} from './rules/raw';
import {
	noSensitiveSelect,
	requireExplicitSensitiveAccessReason,
} from './rules/sensitive';
import { createConfigs } from './shared/config';
import {
	ruleIdByRuntimeKey,
	type SupportedRuntimeRuleKey,
} from './shared/names';
import { version } from './version';

const ruleModules = {
	[ruleIdByRuntimeKey.maxIncludeDepth]: maxIncludeDepth,
	[ruleIdByRuntimeKey.maxIncludeRelations]: maxIncludeRelations,
	[ruleIdByRuntimeKey.maxLimit]: maxLimit,
	[ruleIdByRuntimeKey.noDeleteManyWithoutWhere]: noDeleteManyWithoutWhere,
	[ruleIdByRuntimeKey.noDeleteWithoutWhere]: noDeleteWithoutWhere,
	[ruleIdByRuntimeKey.noEmptyWhere]: noEmptyWhere,
	[ruleIdByRuntimeKey.noInvalidLockCombination]: noInvalidLockCombination,
	[ruleIdByRuntimeKey.noLockWithInclude]: noLockWithInclude,
	[ruleIdByRuntimeKey.noPluginBypassWithoutReason]:
		noPluginBypassWithoutReason,
	[ruleIdByRuntimeKey.noRawMutation]: noRawMutation,
	[ruleIdByRuntimeKey.noRawUnsafe]: noRawUnsafe,
	[ruleIdByRuntimeKey.noSensitiveSelect]: noSensitiveSelect,
	[ruleIdByRuntimeKey.noUnboundedFindMany]: noUnboundedFindMany,
	[ruleIdByRuntimeKey.noUpdateManyWithoutWhere]: noUpdateManyWithoutWhere,
	[ruleIdByRuntimeKey.noUpdateWithoutWhere]: noUpdateWithoutWhere,
	[ruleIdByRuntimeKey.noWithoutPlugins]: noWithoutPlugins,
	[ruleIdByRuntimeKey.requireExplicitLimit]: requireExplicitLimit,
	[ruleIdByRuntimeKey.requireExplicitSensitiveAccessReason]:
		requireExplicitSensitiveAccessReason,
	[ruleIdByRuntimeKey.requireLimitForSkipLocked]: requireLimitForSkipLocked,
	[ruleIdByRuntimeKey.requireOrderByForCursor]: requireOrderByForCursor,
	[ruleIdByRuntimeKey.requireOrderByForLimit]: requireOrderByForLimit,
	[ruleIdByRuntimeKey.requireOrderByForPagination]:
		requireOrderByForPagination,
	[ruleIdByRuntimeKey.requireOrderByForSkipLocked]:
		requireOrderByForSkipLocked,
	[ruleIdByRuntimeKey.requireRawComment]: requireRawComment,
	[ruleIdByRuntimeKey.requireRawTimeout]: requireRawTimeout,
	[ruleIdByRuntimeKey.requireStableOrderByForCursor]:
		requireStableOrderByForCursor,
} satisfies Record<string, Rule.RuleModule>;

export const rules = ruleModules;

const generatedConfigs = createConfigs({
	meta: {
		name: '@better-drizzle/eslint',
		version,
	},
	rules,
});

export const configs = generatedConfigs.configs;
export const recommended = generatedConfigs.recommended;
export const safe = generatedConfigs.safe;
export const strict = generatedConfigs.strict;

const plugin = {
	configs,
	meta: {
		name: '@better-drizzle/eslint',
		version,
	},
	rules,
};

export { version };

export type EslintBetterDrizzleRuleKey = SupportedRuntimeRuleKey;

export default plugin;
