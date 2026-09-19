import {
	getBooleanProperty,
	getLimit,
	getObjectProperty,
	hasOrderBy,
	parseBetterCall,
} from '../shared/ast';
import { createRule } from '../shared/rule';

export const noLockWithInclude = createRule({
	create(context) {
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate') return;
				if (!getObjectProperty(call.query, 'lock')) return;
				if (!getObjectProperty(call.query, 'include')) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'lock cannot be combined with include.',
	name: 'no-lock-with-include',
});

export const noInvalidLockCombination = createRule({
	create(context) {
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate') return;
				const lock = getObjectProperty(call.query, 'lock');
				if (!lock) return;
				if (!getBooleanProperty(lock, 'skipLocked')) return;
				if (!getBooleanProperty(lock, 'noWait')) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'skipLocked and noWait cannot be used together.',
	name: 'no-invalid-lock-combination',
});

export const requireOrderByForSkipLocked = createRule({
	create(context) {
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate') return;
				const lock = getObjectProperty(call.query, 'lock');
				if (!lock || !getBooleanProperty(lock, 'skipLocked')) return;
				if (hasOrderBy(call.query)) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'skipLocked requires orderBy.',
	name: 'require-order-by-for-skip-locked',
});

export const requireLimitForSkipLocked = createRule({
	create(context) {
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate') return;
				const lock = getObjectProperty(call.query, 'lock');
				if (!lock || !getBooleanProperty(lock, 'skipLocked')) return;
				if (getLimit(call.query, call.operation) !== undefined) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'skipLocked requires limit.',
	name: 'require-limit-for-skip-locked',
});
