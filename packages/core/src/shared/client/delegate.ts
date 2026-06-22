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
import { buildQueryConfig, countRows } from '../query';
import { attachThrow, buildHookContext, executeOperation } from './hooks';
import {
	createManyRecords,
	createRecord,
	deleteManyRecords,
	deleteRecord,
	findFirstRecord,
	paginateRecords,
	updateManyRecords,
	updateRecord,
} from './operations';

export const createModelDelegate = <Schema extends AnySchema, Meta>(
	context: RuntimeContext<Schema, Meta>,
	tableName: BetterTableKey<Schema>,
) => ({
	count: (args?: CountArgs<Schema, BetterTableKey<Schema>, Meta>) => {
		const operationArgs =
			args ?? ({} as CountArgs<Schema, BetterTableKey<Schema>, Meta>);

		return executeOperation({
			action: 'count',
			args: operationArgs,
			afterHookName: 'afterQuery',
			afterPayload: (result) =>
				({
					...buildHookContext(
						context,
						tableName,
						'count',
						operationArgs,
					),
					result,
				}) as AfterQueryHookContext<Schema, Meta>,
			beforeHookName: 'beforeQuery',
			beforePayload: buildHookContext(
				context,
				tableName,
				'count',
				operationArgs,
			) as BeforeQueryHookContext<Schema, Meta>,
			context,
			operation: () => countRows(context, tableName, operationArgs.where),
			tableName,
		});
	},
	exists: (args?: ExistsArgs<Schema, BetterTableKey<Schema>, Meta>) => {
		const operationArgs =
			args ?? ({} as ExistsArgs<Schema, BetterTableKey<Schema>, Meta>);

		return executeOperation({
			action: 'exists',
			args: operationArgs,
			afterHookName: 'afterQuery',
			afterPayload: (result) =>
				({
					...buildHookContext(
						context,
						tableName,
						'exists',
						operationArgs,
					),
					result,
				}) as AfterQueryHookContext<Schema, Meta>,
			beforeHookName: 'beforeQuery',
			beforePayload: buildHookContext(
				context,
				tableName,
				'exists',
				operationArgs,
			) as BeforeQueryHookContext<Schema, Meta>,
			context,
			operation: async () =>
				(await countRows(context, tableName, operationArgs.where)) > 0,
			tableName,
		});
	},
	createMany: (args: CreateManyArgs<Schema, BetterTableKey<Schema>, Meta>) =>
		executeOperation({
			action: 'createMany',
			args,
			afterHookName: 'afterCreate',
			afterPayload: (result) =>
				({
					...buildHookContext(context, tableName, 'createMany', args),
					result,
				}) as AfterCreateHookContext<Schema, Meta>,
			beforeHookName: 'beforeCreate',
			beforePayload: buildHookContext(
				context,
				tableName,
				'createMany',
				args,
			) as BeforeCreateHookContext<Schema, Meta>,
			context,
			operation: () => createManyRecords(context, tableName, args),
			tableName,
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
					...buildHookContext(
						context,
						tableName,
						'findMany',
						operationArgs,
					),
					result,
					rows: result,
				}) as AfterQueryHookContext<Schema, Meta>,
			beforeHookName: 'beforeQuery',
			beforePayload: buildHookContext(
				context,
				tableName,
				'findMany',
				operationArgs,
			) as BeforeQueryHookContext<Schema, Meta>,
			context,
			operation: () =>
				context.db.query[tableName].findMany(
					buildQueryConfig(context, tableName, operationArgs),
				),
			tableName,
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
						...buildHookContext(
							context,
							tableName,
							'findFirst',
							operationArgs,
						),
						result,
						row: result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: buildHookContext(
					context,
					tableName,
					'findFirst',
					operationArgs,
				) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: () =>
					findFirstRecord(context, tableName, operationArgs),
				tableName,
			}),
			context,
			'findFirst',
			operationArgs,
			'findFirst',
			tableName,
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
						...buildHookContext(
							context,
							tableName,
							'findOne',
							operationArgs,
						),
						result,
						row: result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: buildHookContext(
					context,
					tableName,
					'findOne',
					operationArgs,
				) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: () =>
					findFirstRecord(context, tableName, operationArgs),
				tableName,
			}),
			context,
			'findOne',
			operationArgs,
			'findOne',
			tableName,
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
						...buildHookContext(
							context,
							tableName,
							'findUnique',
							args,
						),
						result,
						row: result,
					}) as AfterQueryHookContext<Schema, Meta>,
				beforeHookName: 'beforeQuery',
				beforePayload: buildHookContext(
					context,
					tableName,
					'findUnique',
					args,
				) as BeforeQueryHookContext<Schema, Meta>,
				context,
				operation: () => findFirstRecord(context, tableName, args),
				tableName,
			}),
			context,
			'findUnique',
			args,
			'findUnique',
			tableName,
		),
	create: (args: CreateArgs<Schema, BetterTableKey<Schema>, Meta>) =>
		executeOperation({
			action: 'create',
			args,
			afterHookName: 'afterCreate',
			afterPayload: (result) =>
				({
					...buildHookContext(context, tableName, 'create', args),
					result,
					row: result,
				}) as AfterCreateHookContext<Schema, Meta>,
			beforeHookName: 'beforeCreate',
			beforePayload: buildHookContext(
				context,
				tableName,
				'create',
				args,
			) as BeforeCreateHookContext<Schema, Meta>,
			context,
			operation: () =>
				createRecord(context, tableName, {
					...args,
					data: args.data as Record<string, unknown>,
				}),
			tableName,
		}),
	update: (args: UpdateArgs<Schema, BetterTableKey<Schema>, Meta>) =>
		attachThrow(
			executeOperation({
				action: 'update',
				args,
				afterHookName: 'afterUpdate',
				afterPayload: (result) =>
					({
						...buildHookContext(context, tableName, 'update', args),
						result,
						row: result,
					}) as AfterUpdateHookContext<Schema, Meta>,
				beforeHookName: 'beforeUpdate',
				beforePayload: buildHookContext(
					context,
					tableName,
					'update',
					args,
				) as BeforeUpdateHookContext<Schema, Meta>,
				context,
				operation: () => updateRecord(context, tableName, args),
				tableName,
			}),
			context,
			'update',
			args,
			'update',
			tableName,
		),
	updateMany: (args: UpdateManyArgs<Schema, BetterTableKey<Schema>, Meta>) =>
		executeOperation({
			action: 'updateMany',
			args,
			afterHookName: 'afterUpdate',
			afterPayload: (result) =>
				({
					...buildHookContext(context, tableName, 'updateMany', args),
					result,
				}) as AfterUpdateHookContext<Schema, Meta>,
			beforeHookName: 'beforeUpdate',
			beforePayload: buildHookContext(
				context,
				tableName,
				'updateMany',
				args,
			) as BeforeUpdateHookContext<Schema, Meta>,
			context,
			operation: () => updateManyRecords(context, tableName, args),
			tableName,
		}),
	delete: (args: DeleteArgs<Schema, BetterTableKey<Schema>, Meta>) =>
		attachThrow(
			executeOperation({
				action: 'delete',
				args,
				afterHookName: 'afterDelete',
				afterPayload: (result) =>
					({
						...buildHookContext(context, tableName, 'delete', args),
						result,
						row: result,
					}) as AfterDeleteHookContext<Schema, Meta>,
				beforeHookName: 'beforeDelete',
				beforePayload: buildHookContext(
					context,
					tableName,
					'delete',
					args,
				) as BeforeDeleteHookContext<Schema, Meta>,
				context,
				operation: () => deleteRecord(context, tableName, args),
				tableName,
			}),
			context,
			'delete',
			args,
			'delete',
			tableName,
		),
	deleteMany: (args: DeleteManyArgs<Schema, BetterTableKey<Schema>, Meta>) =>
		executeOperation({
			action: 'deleteMany',
			args,
			afterHookName: 'afterDelete',
			afterPayload: (result) =>
				({
					...buildHookContext(context, tableName, 'deleteMany', args),
					result,
				}) as AfterDeleteHookContext<Schema, Meta>,
			beforeHookName: 'beforeDelete',
			beforePayload: buildHookContext(
				context,
				tableName,
				'deleteMany',
				args,
			) as BeforeDeleteHookContext<Schema, Meta>,
			context,
			operation: () => deleteManyRecords(context, tableName, args),
			tableName,
		}),
	upsert: async (args: UpsertArgs<Schema, BetterTableKey<Schema>, Meta>) => {
		const existing = await findFirstRecord(context, tableName, {
			where: args.where,
		});

		if (existing) {
			const updateArgs: UpdateArgs<
				Schema,
				BetterTableKey<Schema>,
				Meta
			> = {
				where: args.where,
				data: args.update,
				select: args.select,
				include: args.include,
				meta: args.meta,
			};

			return executeOperation({
				action: 'upsert',
				args: updateArgs,
				afterHookName: 'afterUpdate',
				afterPayload: (result) =>
					({
						...buildHookContext(
							context,
							tableName,
							'upsert',
							updateArgs,
						),
						result,
						row: result,
					}) as AfterUpdateHookContext<Schema, Meta>,
				beforeHookName: 'beforeUpdate',
				beforePayload: buildHookContext(
					context,
					tableName,
					'upsert',
					updateArgs,
				) as BeforeUpdateHookContext<Schema, Meta>,
				context,
				operation: () => updateRecord(context, tableName, updateArgs),
				tableName,
			});
		}

		const createArgs: CreateArgs<Schema, BetterTableKey<Schema>, Meta> = {
			data: args.create,
			select: args.select,
			include: args.include,
			meta: args.meta,
		};

		return executeOperation({
			action: 'upsert',
			args: createArgs,
			afterHookName: 'afterCreate',
			afterPayload: (result) =>
				({
					...buildHookContext(
						context,
						tableName,
						'upsert',
						createArgs,
					),
					result,
					row: result,
				}) as AfterCreateHookContext<Schema, Meta>,
			beforeHookName: 'beforeCreate',
			beforePayload: buildHookContext(
				context,
				tableName,
				'upsert',
				createArgs,
			) as BeforeCreateHookContext<Schema, Meta>,
			context,
			operation: () =>
				createRecord(context, tableName, {
					...createArgs,
					data: createArgs.data as Record<string, unknown>,
				}),
			tableName,
		});
	},
	paginate: (args: PaginationArgs<Schema, BetterTableKey<Schema>, Meta>) =>
		executeOperation({
			action: 'paginate',
			args,
			afterHookName: 'afterQuery',
			afterPayload: (result) =>
				({
					...buildHookContext(context, tableName, 'paginate', args),
					result,
				}) as AfterQueryHookContext<Schema, Meta>,
			beforeHookName: 'beforeQuery',
			beforePayload: buildHookContext(
				context,
				tableName,
				'paginate',
				args,
			) as BeforeQueryHookContext<Schema, Meta>,
			context,
			operation: () => paginateRecords(context, tableName, args),
			tableName,
		}),
});
