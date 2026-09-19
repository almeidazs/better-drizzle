import {
	getNumberProperty,
	getStringProperty,
	isMutationQuery,
	parseBetterCall,
} from '../shared/ast';
import { createRule } from '../shared/rule';

export const noRawUnsafe = createRule({
	create(context) {
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'raw' || call.action !== '$rawUnsafe')
					return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'rawUnsafe is not allowed.',
	name: 'no-raw-unsafe',
});

export const requireRawComment = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					minLength?: number;
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'raw' || call.queryText === null) return;
				const comment = getStringProperty(
					call.options,
					'comment',
				)?.trim();
				if (comment && comment.length >= (options?.minLength ?? 1))
					return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'Raw queries require a comment.',
	name: 'require-raw-comment',
	schema: [{ additionalProperties: true, type: 'object' }],
});

export const requireRawTimeout = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					defaultTimeoutMs?: number;
					maxTimeoutMs?: number;
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'raw' || call.queryText === null) return;
				const timeoutMs = getNumberProperty(call.options, 'timeoutMs');
				if (timeoutMs === undefined) {
					context.report({ messageId: 'default', node });
					return;
				}
				if (
					typeof options?.defaultTimeoutMs === 'number' &&
					timeoutMs > options.defaultTimeoutMs
				) {
					context.report({
						message: `Raw timeout ${timeoutMs}ms exceeds the recommended default ${options.defaultTimeoutMs}ms.`,
						node,
					});
					return;
				}
				if (
					typeof options?.maxTimeoutMs === 'number' &&
					timeoutMs > options.maxTimeoutMs
				)
					context.report({
						message: `Raw timeout ${timeoutMs}ms exceeds the maximum ${options.maxTimeoutMs}ms.`,
						node,
					});
			},
		};
	},
	message: 'Raw queries require timeoutMs.',
	name: 'require-raw-timeout',
	schema: [{ additionalProperties: true, type: 'object' }],
});

export const noRawMutation = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					allow?: readonly string[];
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'raw' || !call.queryText) return;
				if (!isMutationQuery(call.queryText, options?.allow)) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'Raw mutation queries are not allowed.',
	name: 'no-raw-mutation',
	schema: [{ additionalProperties: true, type: 'object' }],
});
