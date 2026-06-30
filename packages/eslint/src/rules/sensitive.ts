import {
	getBooleanProperty,
	getObjectProperty,
	getStringProperty,
	hasSensitiveSelectField,
	parseBetterCall,
} from '../shared/ast';
import { SENSITIVE_FIELD_NAMES } from '../shared/names';
import { createRule } from '../shared/rule';

export const noSensitiveSelect = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					allowWithSensitive?: boolean;
					withSensitiveArg?: string;
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate') return;
				const select = getObjectProperty(call.query, 'select');
				const field = hasSensitiveSelectField(
					select,
					SENSITIVE_FIELD_NAMES,
				);
				if (!field) return;
				const withSensitiveArg =
					options?.withSensitiveArg ?? 'withSensitive';
				if (
					options?.allowWithSensitive &&
					getBooleanProperty(call.query, withSensitiveArg) === true
				)
					return;
				context.report({
					message: `Selecting sensitive field "${field}" is not allowed.`,
					node,
				});
			},
		};
	},
	message: 'Selecting sensitive fields is not allowed.',
	name: 'no-sensitive-select',
	schema: [{ additionalProperties: true, type: 'object' }],
});

export const requireExplicitSensitiveAccessReason = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					reasonArg?: string;
					withSensitiveArg?: string;
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate') return;
				const select = getObjectProperty(call.query, 'select');
				if (!hasSensitiveSelectField(select, SENSITIVE_FIELD_NAMES))
					return;
				const withSensitiveArg =
					options?.withSensitiveArg ?? 'withSensitive';
				if (getBooleanProperty(call.query, withSensitiveArg) !== true)
					return;
				const reasonArg = options?.reasonArg ?? 'reason';
				if (getStringProperty(call.query, reasonArg)) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'Sensitive access requires an explicit reason.',
	name: 'require-explicit-sensitive-access-reason',
	schema: [{ additionalProperties: true, type: 'object' }],
});
