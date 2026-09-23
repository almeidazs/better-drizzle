import { defineConfig } from 'oxlint';
import core from 'ultracite/oxlint/core';

export default defineConfig({
	categories: {
		correctness: 'error',
	},
	ignorePatterns: core.ignorePatterns,
	plugins: core.plugins?.filter(
		(plugin) => !['jsdoc', 'node', 'promise'].includes(plugin),
	),
	rules: {
		'no-debugger': 'error',
		'no-unused-vars': 'error',
		'prefer-const': 'error',
		'typescript/no-explicit-any': 'warn',
		'unicorn/no-new-array': 'off',
		'unicorn/no-thenable': 'off',
		'unicorn/no-useless-fallback-in-spread': 'off',
	},
});
