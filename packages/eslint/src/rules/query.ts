import {
	getLimit,
	getObjectProperty,
	getOrderByColumns,
	hasOrderBy,
	parseBetterCall,
} from '../shared/ast';
import { createRule } from '../shared/rule';

export const noUnboundedFindMany = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					allowSmallStaticModels?: boolean;
					allowWithLimit?: boolean;
					allowWithTake?: boolean;
					allowWithWhere?: boolean;
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate' || call.operation !== 'findMany')
					return;
				const hasWhere = Boolean(
					getObjectProperty(call.query, 'where'),
				);
				const limit = getLimit(call.query, call.operation);
				const allowed =
					(Boolean(options?.allowWithWhere) && hasWhere) ||
					(Boolean(options?.allowWithLimit) && limit !== undefined) ||
					(Boolean(options?.allowWithTake) &&
						getObjectProperty(call.query, 'take')) ||
					(Boolean(options?.allowSmallStaticModels) && hasWhere);
				if (allowed) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'findMany should be bounded by where or limit.',
	name: 'no-unbounded-find-many',
	schema: [{ additionalProperties: true, type: 'object' }],
});

export const requireExplicitLimit = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					operations?: readonly string[];
			  }
			| undefined,
		];
		const operations = new Set(options?.operations ?? ['findMany']);
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (
					call?.kind !== 'delegate' ||
					!operations.has(call.operation)
				)
					return;
				if (getLimit(call.query, call.operation) !== undefined) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'This operation requires an explicit limit.',
	name: 'require-explicit-limit',
	schema: [{ additionalProperties: true, type: 'object' }],
});

export const maxLimit = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					applyTo?: readonly string[];
					value?: number;
			  }
			| undefined,
		];
		const value = options?.value;
		const operations = new Set(
			options?.applyTo ?? ['findMany', 'paginate', 'cursor'],
		);
		return {
			CallExpression(node) {
				if (typeof value !== 'number') return;
				const call = parseBetterCall(node);
				if (
					call?.kind !== 'delegate' ||
					!operations.has(call.operation)
				)
					return;
				const limit = getLimit(call.query, call.operation);
				if (limit === undefined || limit <= value) return;
				context.report({
					data: { limit: String(limit), value: String(value) },
					message: `The requested limit ${limit} exceeds the maximum ${value}.`,
					node,
				});
			},
		};
	},
	message: 'The requested limit exceeds the configured maximum.',
	name: 'max-limit',
	schema: [{ additionalProperties: true, type: 'object' }],
});

export const requireOrderByForLimit = createRule({
	create(context) {
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate') return;
				if (getLimit(call.query, call.operation) === undefined) return;
				if (hasOrderBy(call.query)) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'Using limit without orderBy is not allowed.',
	name: 'require-order-by-for-limit',
});

export const requireOrderByForPagination = createRule({
	create(context) {
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate' || call.operation !== 'paginate')
					return;
				if (hasOrderBy(call.query)) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'paginate requires orderBy.',
	name: 'require-order-by-for-pagination',
});

export const requireOrderByForCursor = createRule({
	create(context) {
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate' || call.operation !== 'cursor')
					return;
				if (hasOrderBy(call.query)) return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'cursor pagination requires orderBy.',
	name: 'require-order-by-for-cursor',
});

export const requireStableOrderByForCursor = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					requirePrimaryKeyInOrderBy?: boolean;
			  }
			| undefined,
		];
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (call?.kind !== 'delegate' || call.operation !== 'cursor')
					return;
				if (!hasOrderBy(call.query)) return;
				const columns = getOrderByColumns(call.query);
				if (columns.length === 0) return;
				if (
					!options?.requirePrimaryKeyInOrderBy ||
					columns.includes('id')
				)
					return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message:
		'cursor pagination requires a stable orderBy that includes the primary key.',
	name: 'require-stable-order-by-for-cursor',
	schema: [{ additionalProperties: true, type: 'object' }],
});
