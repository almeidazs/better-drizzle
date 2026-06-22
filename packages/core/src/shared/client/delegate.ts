import type {
	AfterCreateHookContext,
	AfterDeleteHookContext,
	AfterQueryHookContext,
	AfterUpdateHookContext,
	AnySchema,
	BeforeCreateHookContext,
	BeforeDeleteHookContext,
	BeforeQueryHookContext,
	BeforeUpdateHookContext,
	BetterTableKey,
	CountArgs,
	CreateArgs,
	CreateManyArgs,
	DeleteArgs,
	DeleteManyArgs,
	ExistsArgs,
	PaginationArgs,
	QueryArgs,
	RuntimeContext,
	UpdateArgs,
	UpdateManyArgs,
	UpsertArgs,
} from '../../types';
import { countRows } from '../query';
import { getTableRuntime } from './context';
import { attachThrow, buildHookContext, executeOperation } from './hooks';
import {
	createManyRecords,
	createRecord,
	deleteManyRecords,
	deleteRecord,
	existsRecord,
	findFirstRecord,
	findManyRecords,
	paginateRecords,
	updateManyRecords,
	updateRecord,
	upsertRecord,
} from './operations';

export const createModelDelegate = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
) => {
	const name = tableName as string;
	const runtime = getTableRuntime(context, name);
	const hookContext = (action: string, args: unknown) =>
		buildHookContext(context, runtime, name, action, args);

	return {
		count: (args?: CountArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ?? ({} as CountArgs<Schema, BetterTableKey<Schema>, Meta>);

			return executeOperation({
				action: 'count',
				args: operationArgs,
				afterHookName: 'afterQuery',
				afterPayload: (result) =>
					({
						...hookContext('count', operationArgs),
						result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: () =>
					hookContext(
						'count',
						operationArgs,
					) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: () =>
					countRows(context, tableName, operationArgs.where),
				runtime,
				tableName: name,
			});
		},
		exists: (args?: ExistsArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ??
				({} as ExistsArgs<Schema, BetterTableKey<Schema>, Meta>);

			return executeOperation({
				action: 'exists',
				args: operationArgs,
				afterHookName: 'afterQuery',
				afterPayload: (result) =>
					({
						...hookContext('exists', operationArgs),
						result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: () =>
					hookContext(
						'exists',
						operationArgs,
					) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: () =>
					existsRecord(context, tableName, operationArgs),
				runtime,
				tableName: name,
			});
		},
		createMany: (
			args: CreateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
		) =>
			executeOperation({
				action: 'createMany',
				args,
				afterHookName: 'afterCreate',
				afterPayload: (result) =>
					({
						...hookContext('createMany', args),
						result,
					}) as AfterCreateHookContext<Schema, Meta>,
				beforeHookName: 'beforeCreate',
				beforePayload: () =>
					hookContext('createMany', args) as BeforeCreateHookContext<
						Schema,
						Meta
					>,
				context,
				operation: () => createManyRecords(context, tableName, args),
				runtime,
				tableName: name,
			}),
		findMany: (args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ?? ({} as QueryArgs<Schema, BetterTableKey<Schema>, Meta>);

			return executeOperation({
				action: 'findMany',
				args: operationArgs,
				afterHookName: 'afterQuery',
				afterPayload: (result) =>
					({
						...hookContext('findMany', operationArgs),
						result,
						rows: result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: () =>
					hookContext(
						'findMany',
						operationArgs,
					) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: () =>
					findManyRecords(context, tableName, operationArgs),
				runtime,
				tableName: name,
			});
		},
		findFirst: (args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ?? ({} as QueryArgs<Schema, BetterTableKey<Schema>, Meta>);

			return attachThrow(
				executeOperation({
					action: 'findFirst',
					args: operationArgs,
					afterHookName: 'afterQuery',
					afterPayload: (result) =>
						({
							...hookContext('findFirst', operationArgs),
							result,
							row: result,
						}) as AfterQueryHookContext<Schema, Meta>,
					beforeHookName: 'beforeQuery',
					beforePayload: () =>
						hookContext(
							'findFirst',
							operationArgs,
						) as BeforeQueryHookContext<Schema, Meta>,
					context,
					operation: () =>
						findFirstRecord(context, tableName, operationArgs),
					runtime,
					tableName: name,
				}),
				context,
				runtime,
				'findFirst',
				operationArgs,
				'findFirst',
				name,
			);
		},
		findOne: (args?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>) => {
			const operationArgs =
				args ?? ({} as QueryArgs<Schema, BetterTableKey<Schema>, Meta>);

			return attachThrow(
				executeOperation({
					action: 'findOne',
					args: operationArgs,
					afterHookName: 'afterQuery',
					afterPayload: (result) =>
						({
							...hookContext('findOne', operationArgs),
							result,
							row: result,
						}) as AfterQueryHookContext<Schema, Meta>,
					beforeHookName: 'beforeQuery',
					beforePayload: () =>
						hookContext(
							'findOne',
							operationArgs,
						) as BeforeQueryHookContext<Schema, Meta>,
					context,
					operation: () =>
						findFirstRecord(context, tableName, operationArgs),
					runtime,
					tableName: name,
				}),
				context,
				runtime,
				'findOne',
				operationArgs,
				'findOne',
				name,
			);
		},
		findUnique: (args: QueryArgs<Schema, BetterTableKey<Schema>, Meta>) =>
			attachThrow(
				executeOperation({
					action: 'findUnique',
					args,
					afterHookName: 'afterQuery',
					afterPayload: (result) =>
						({
							...hookContext('findUnique', args),
							result,
							row: result,
						}) as AfterQueryHookContext<Schema, Meta>,
					beforeHookName: 'beforeQuery',
					beforePayload: () =>
						hookContext(
							'findUnique',
							args,
						) as BeforeQueryHookContext<Schema, Meta>,
					context,
					operation: () => findFirstRecord(context, tableName, args),
					runtime,
					tableName: name,
				}),
				context,
				runtime,
				'findUnique',
				args,
				'findUnique',
				name,
			),
		create: (args: CreateArgs<Schema, BetterTableKey<Schema>, Meta>) =>
			executeOperation({
				action: 'create',
				args,
				afterHookName: 'afterCreate',
				afterPayload: (result) =>
					({
						...hookContext('create', args),
						result,
						row: result,
					}) as AfterCreateHookContext<Schema, Meta>,
				beforeHookName: 'beforeCreate',
				beforePayload: () =>
					hookContext('create', args) as BeforeCreateHookContext<
						Schema,
						Meta
					>,
				context,
				operation: () => createRecord(context, tableName, args),
				runtime,
				tableName: name,
			}),
		update: (args: UpdateArgs<Schema, BetterTableKey<Schema>, Meta>) =>
			attachThrow(
				executeOperation({
					action: 'update',
					args,
					afterHookName: 'afterUpdate',
					afterPayload: (result) =>
						({
							...hookContext('update', args),
							result,
							row: result,
						}) as AfterUpdateHookContext<Schema, Meta>,
					beforeHookName: 'beforeUpdate',
					beforePayload: () =>
						hookContext('update', args) as BeforeUpdateHookContext<
							Schema,
							Meta
						>,
					context,
					operation: () => updateRecord(context, tableName, args),
					runtime,
					tableName: name,
				}),
				context,
				runtime,
				'update',
				args,
				'update',
				name,
			),
		updateMany: (
			args: UpdateManyArgs<Schema, BetterTableKey<Schema>, Meta>,
		) =>
			executeOperation({
				action: 'updateMany',
				args,
				afterHookName: 'afterUpdate',
				afterPayload: (result) =>
					({
						...hookContext('updateMany', args),
						result,
					}) as AfterUpdateHookContext<Schema, Meta>,
				beforeHookName: 'beforeUpdate',
				beforePayload: () =>
					hookContext('updateMany', args) as BeforeUpdateHookContext<
						Schema,
						Meta
					>,
				context,
				operation: () => updateManyRecords(context, tableName, args),
				runtime,
				tableName: name,
			}),
		delete: (args: DeleteArgs<Schema, BetterTableKey<Schema>, Meta>) =>
			attachThrow(
				executeOperation({
					action: 'delete',
					args,
					afterHookName: 'afterDelete',
					afterPayload: (result) =>
						({
							...hookContext('delete', args),
							result,
							row: result,
						}) as AfterDeleteHookContext<Schema, Meta>,
					beforeHookName: 'beforeDelete',
					beforePayload: () =>
						hookContext('delete', args) as BeforeDeleteHookContext<
							Schema,
							Meta
						>,
					context,
					operation: () => deleteRecord(context, tableName, args),
					runtime,
					tableName: name,
				}),
				context,
				runtime,
				'delete',
				args,
				'delete',
				name,
			),
		deleteMany: (
			args: DeleteManyArgs<Schema, BetterTableKey<Schema>, Meta>,
		) =>
			executeOperation({
				action: 'deleteMany',
				args,
				afterHookName: 'afterDelete',
				afterPayload: (result) =>
					({
						...hookContext('deleteMany', args),
						result,
					}) as AfterDeleteHookContext<Schema, Meta>,
				beforeHookName: 'beforeDelete',
				beforePayload: () =>
					hookContext('deleteMany', args) as BeforeDeleteHookContext<
						Schema,
						Meta
					>,
				context,
				operation: () => deleteManyRecords(context, tableName, args),
				runtime,
				tableName: name,
			}),
		upsert: (args: UpsertArgs<Schema, BetterTableKey<Schema>, Meta>) =>
			executeOperation({
				action: 'upsert',
				args,
				afterHookName: 'afterCreate',
				afterPayload: (result) =>
					({
						...hookContext('upsert', args),
						result,
						row: result,
					}) as AfterCreateHookContext<Schema, Meta>,
				beforeHookName: 'beforeCreate',
				beforePayload: () =>
					hookContext('upsert', args) as BeforeCreateHookContext<
						Schema,
						Meta
					>,
				context,
				operation: () => upsertRecord(context, tableName, args),
				runtime,
				tableName: name,
			}),
		paginate: (
			args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>,
		) =>
			executeOperation({
				action: 'paginate',
				args,
				afterHookName: 'afterQuery',
				afterPayload: (result) =>
					({
						...hookContext('paginate', args),
						result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: () =>
					hookContext('paginate', args) as BeforeQueryHookContext<
						Schema,
						Meta
					>,
				context,
				operation: () => paginateRecords(context, tableName, args),
				runtime,
				tableName: name,
			}),
	};
};
