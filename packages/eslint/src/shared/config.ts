import {
	recommended as runtimeRecommended,
	safe as runtimeSafe,
	strict as runtimeStrict,
} from '@better-drizzle/rules';
import parser from '@typescript-eslint/parser';

import { ruleIdByRuntimeKey, SUPPORTED_RUNTIME_RULE_KEYS } from './names';

type RuntimeOptions = Record<string, unknown>;

const toSeverity = (value: 'warn' | 'error') => (value === 'warn' ? 1 : 2);

const toEslintEntry = (setting: unknown) => {
	if (setting === undefined || setting === false || setting === 'off')
		return null;
	if (setting === true || setting === 'error') return 2;
	if (setting === 'warn') return 1;
	if (!setting || typeof setting !== 'object') return null;

	const record = { ...(setting as RuntimeOptions) };
	const level =
		record.level === 'warn'
			? 'warn'
			: record.level === 'off'
				? 'off'
				: 'error';
	delete record.level;
	if (level === 'off') return null;
	return Object.keys(record).length > 0
		? [toSeverity(level), record]
		: toSeverity(level);
};

const createRulesConfig = (settings: RuntimeOptions) => {
	const rules: Record<string, unknown> = Object.create(null);

	for (const key of SUPPORTED_RUNTIME_RULE_KEYS) {
		const entry = toEslintEntry(settings[key]);
		if (entry === null) continue;
		rules[`better-drizzle/${ruleIdByRuntimeKey[key]}`] = entry;
	}

	return rules;
};

export const createConfigs = (plugin: object) => {
	const createFlatConfig = (settings: RuntimeOptions) => [
		{
			files: ['**/*.{ts,tsx,mts,cts}'],
			languageOptions: {
				parser,
				sourceType: 'module' as const,
			},
			plugins: {
				'better-drizzle': plugin,
			},
			rules: createRulesConfig(settings),
		},
	];

	const safe = createFlatConfig(runtimeSafe());
	const recommended = createFlatConfig(runtimeRecommended());
	const strict = createFlatConfig(runtimeStrict());

	return {
		configs: {
			recommended,
			safe,
			strict,
		},
		recommended,
		safe,
		strict,
	};
};
