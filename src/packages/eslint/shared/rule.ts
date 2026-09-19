import type { Rule } from 'eslint';

export const ERROR_DOCS_URL = 'https://better-drizzle.com/docs/plugins/rules';

export type RuleModule = Rule.RuleModule;

export const createRule = ({
	create,
	message,
	schema = [],
}: {
	create: RuleModule['create'];
	message: string;
	name: string;
	schema?: Rule.RuleMetaData['schema'];
}): RuleModule => ({
	create,
	meta: {
		docs: {
			description: message,
			recommended: false,
			url: ERROR_DOCS_URL,
		},
		messages: {
			default: message,
		},
		schema,
		type: 'problem',
	},
});
