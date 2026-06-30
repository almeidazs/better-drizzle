import {
	getObjectProperty,
	isEmptyWhere,
	parseBetterCall,
} from '../shared/ast';
import { createRule } from '../shared/rule';

const withOperation = (
	operation: 'delete' | 'deleteMany' | 'update' | 'updateMany',
	message: string,
	ruleName: string,
) =>
	createRule({
		create(context) {
			return {
				CallExpression(node) {
					const call = parseBetterCall(node);
					if (
						call?.kind !== 'delegate' ||
						call.operation !== operation
					)
						return;
					if (getObjectProperty(call.query, 'where')) return;
					context.report({ messageId: 'default', node });
				},
			};
		},
		message,
		name: ruleName,
	});

export const noDeleteManyWithoutWhere = withOperation(
	'deleteMany',
	'deleteMany requires a where clause.',
	'no-delete-many-without-where',
);

export const noDeleteWithoutWhere = withOperation(
	'delete',
	'delete requires a where clause.',
	'no-delete-without-where',
);

export const noUpdateManyWithoutWhere = withOperation(
	'updateMany',
	'updateMany requires a where clause.',
	'no-update-many-without-where',
);

export const noUpdateWithoutWhere = withOperation(
	'update',
	'update requires a where clause.',
	'no-update-without-where',
);

export const noEmptyWhere = createRule({
	create(context) {
		const [options] = context.options as [
			| {
					operations?: readonly string[];
					treatEmptyAndOrAsEmpty?: boolean;
					treatUndefinedAsEmpty?: boolean;
			  }
			| undefined,
		];
		const operations = new Set(
			options?.operations ?? [
				'delete',
				'deleteMany',
				'update',
				'updateMany',
			],
		);
		return {
			CallExpression(node) {
				const call = parseBetterCall(node);
				if (
					call?.kind !== 'delegate' ||
					!operations.has(call.operation)
				)
					return;
				if (
					!isEmptyWhere(
						getObjectProperty(call.query, 'where'),
						options?.treatUndefinedAsEmpty ?? true,
						options?.treatEmptyAndOrAsEmpty ?? false,
					)
				)
					return;
				context.report({ messageId: 'default', node });
			},
		};
	},
	message: 'The where clause is empty.',
	name: 'no-empty-where',
	schema: [
		{
			additionalProperties: false,
			properties: {
				operations: {
					items: { type: 'string' },
					type: 'array',
				},
				treatEmptyAndOrAsEmpty: { type: 'boolean' },
				treatUndefinedAsEmpty: { type: 'boolean' },
			},
			type: 'object',
		},
	],
});
