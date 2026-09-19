import {
	getIncludeStats,
	getObjectProperty,
	parseBetterCall,
} from '../shared/ast';
import { createRule } from '../shared/rule';

export const maxIncludeDepth = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					value?: number;
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				if (typeof options?.value !== 'number') return;
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate') return;
				const include = getObjectProperty(call.query, 'include');
				if (!include) return;
				const stats = getIncludeStats(include);
				if (stats.depth <= options.value) return;
				context.report({
					message: `include depth ${stats.depth} exceeds the maximum ${options.value}.`,
					node,
				});
			},
		};
	},
	message: 'include depth exceeds the configured maximum.',
	name: 'max-include-depth',
	schema: [{ additionalProperties: true, type: 'object' }],
});

export const maxIncludeRelations = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					value?: number;
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				if (typeof options?.value !== 'number') return;
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate') return;
				const include = getObjectProperty(call.query, 'include');
				if (!include) return;
				const stats = getIncludeStats(include);
				if (stats.relations <= options.value) return;
				context.report({
					message: `include relation count ${stats.relations} exceeds the maximum ${options.value}.`,
					node,
				});
			},
		};
	},
	message: 'include relation count exceeds the configured maximum.',
	name: 'max-include-relations',
	schema: [{ additionalProperties: true, type: 'object' }],
});
