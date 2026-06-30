import { getStringProperty, parseBetterCall } from '../shared/ast';
import { createRule } from '../shared/rule';

export const noWithoutPlugins = createRule({
	create(context) {
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'plugin-bypass') return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: '$withoutPlugins() bypasses plugin transforms and guardrails.',
	name: 'no-without-plugins',
});

export const noPluginBypassWithoutReason = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					reasonArg?: string;
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate' || !call.viaWithoutPlugins)
					return;
				const reasonArg = options?.reasonArg ?? 'reason';
				if (getStringProperty(call.query, reasonArg)) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'Using $withoutPlugins() requires a reason.',
	name: 'no-plugin-bypass-without-reason',
	schema: [{ additionalProperties: true, type: 'object' }],
});
