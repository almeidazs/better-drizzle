import {
	type AnySchema,
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	definePlugin,
	type TableKey,
} from 'better-drizzle';
import { z } from 'zod';

import { createZodSchemasRegistry } from './shared/registry';
import {
	parseOrThrow,
	preserveRelationCommands,
	shouldValidate,
	stripUnknownColumns,
} from './shared/validation';
import type { BetterDrizzleZodModelExtension, ZodPluginOptions } from './types';
import { version } from './version';

export const zod = <
	Schema extends AnySchema,
	const Options extends ZodPluginOptions<Schema> = ZodPluginOptions<Schema>,
>(
	options: Options = {} as Options,
) => {
	type ModelExtensionResolver = <
		Name extends TableKey<Schema>,
		Meta,
		Plugins extends readonly import('better-drizzle').AnyPlugin[],
	>(
		context: import('better-drizzle').PluginModelExtensionContext<
			Schema,
			Meta,
			Name,
			Plugins
		>,
	) => BetterDrizzleZodModelExtension<Schema, Name, Options>;

	let registry: ReturnType<typeof createZodSchemasRegistry<Schema>> | null =
		null;

	const getRegistry = (schema: Schema) => {
		if (!registry) registry = createZodSchemasRegistry(schema, options);
		return registry;
	};

	return definePlugin<
		Options,
		Record<never, never>,
		Record<never, never>,
		Record<never, never>,
		{
			count: { validate?: boolean };
			create: { validate?: boolean };
			createMany: { validate?: boolean };
			cursor: { validate?: boolean };
			delete: { validate?: boolean };
			deleteMany: { validate?: boolean };
			exists: { validate?: boolean };
			findFirst: { validate?: boolean };
			findMany: { validate?: boolean };
			findOne: { validate?: boolean };
			findUnique: { validate?: boolean };
			paginate: { validate?: boolean };
			update: { validate?: boolean };
			updateEach: { validate?: boolean };
			updateMany: { validate?: boolean };
			upsert: { validate?: boolean };
			upsertMany: { validate?: boolean };
		},
		ModelExtensionResolver
	>({
		description:
			'Generates Zod schemas from Drizzle models and validates Better Drizzle operations.',
		id: '@better-drizzle/zod',
		name: 'Zod',
		operationArgs: {
			count: { validate: undefined as boolean | undefined },
			create: { validate: undefined as boolean | undefined },
			createMany: { validate: undefined as boolean | undefined },
			cursor: { validate: undefined as boolean | undefined },
			delete: { validate: undefined as boolean | undefined },
			deleteMany: { validate: undefined as boolean | undefined },
			exists: { validate: undefined as boolean | undefined },
			findFirst: { validate: undefined as boolean | undefined },
			findMany: { validate: undefined as boolean | undefined },
			findOne: { validate: undefined as boolean | undefined },
			findUnique: { validate: undefined as boolean | undefined },
			paginate: { validate: undefined as boolean | undefined },
			update: { validate: undefined as boolean | undefined },
			updateEach: { validate: undefined as boolean | undefined },
			updateMany: { validate: undefined as boolean | undefined },
			upsert: { validate: undefined as boolean | undefined },
			upsertMany: { validate: undefined as boolean | undefined },
		},
		hooks: {
			beforeCreate(context): typeof context.data | undefined {
				const zodRegistry = getRegistry(
					context.schema as unknown as Schema,
				);
				if (
					!shouldValidate(
						options.validate,
						context.kind,
						context.args.validate,
					)
				)
					return context.data;

				if (context.kind === 'create')
					return preserveRelationCommands(
						context.data,
						parseOrThrow(
							zodRegistry.get(context.table)?.schemas.create ??
								z.unknown(),
							context.data,
							{
								operation: 'create payload',
								table: context.table,
							},
						),
						context.model.columns,
					) as typeof context.data;

				if (context.kind === 'createMany')
					return stripUnknownColumns(
						parseOrThrow(
							z.array(
								zodRegistry.get(context.table)?.schemas
									.create ?? z.unknown(),
							),
							context.data,
							{
								operation: 'createMany payload',
								table: context.table,
							},
						),
						context.model.columns,
					) as typeof context.data;

				if (context.kind === 'upsert') {
					const parsed = parseOrThrow(
						zodRegistry.getUpsertArgsSchema(context.table).pick({
							create: true,
							update: true,
							where: true,
						}),
						{
							create: context.data?.create,
							update: context.data?.update,
							where: context.where,
						},
						{
							operation: 'upsert payload',
							table: context.table,
						},
					);

					return {
						create: preserveRelationCommands(
							context.data?.create,
							parsed.create,
							context.model.columns,
						),
						update: preserveRelationCommands(
							context.data?.update,
							parsed.update,
							context.model.columns,
						),
					} as typeof context.data;
				}

				if (context.kind === 'upsertMany') {
					const parsed = parseOrThrow(
						zodRegistry
							.getUpsertManyArgsSchema(context.table)
							.pick({
								data: true,
								update: true,
							}),
						{
							data: context.data,
							update: context.args.update,
						},
						{
							operation: 'upsertMany payload',
							table: context.table,
						},
					) as { data: typeof context.data };

					return stripUnknownColumns(
						parsed.data,
						context.model.columns,
					) as typeof context.data;
				}

				return undefined;
			},
			beforeDelete(context) {
				const zodRegistry = getRegistry(
					context.schema as unknown as Schema,
				);
				const enabled =
					shouldValidate(
						options.validate,
						context.kind,
						context.args.validate,
					) ||
					shouldValidate(
						options.validate,
						'query',
						context.args.validate,
					);

				if (!enabled) return;

				parseOrThrow(
					context.kind === 'delete'
						? zodRegistry.getDeleteArgsSchema(context.table)
						: zodRegistry.getDeleteManyArgsSchema(context.table),
					context.args,
					{
						operation:
							context.kind === 'delete'
								? 'delete args'
								: 'deleteMany args',
						table: context.table,
					},
				);
			},
			beforeQuery(context) {
				const zodRegistry = getRegistry(
					context.schema as unknown as Schema,
				);
				const enabled =
					shouldValidate(
						options.validate,
						context.kind,
						context.args.validate,
					) ||
					shouldValidate(
						options.validate,
						'query',
						context.args.validate,
					);

				if (!enabled) return;

				parseOrThrow(
					context.kind === 'count'
						? zodRegistry.getCountArgsSchema(context.table)
						: context.kind === 'exists'
							? zodRegistry.getExistsArgsSchema(context.table)
							: context.kind === 'cursor'
								? zodRegistry.getCursorArgsSchema(context.table)
								: context.kind === 'paginate'
									? zodRegistry.getPaginationArgsSchema(
											context.table,
										)
									: zodRegistry.getQueryArgsSchema(
											context.table,
										),
					context.args,
					{
						operation:
							context.kind === 'count'
								? 'count args'
								: context.kind === 'exists'
									? 'exists args'
									: context.kind === 'cursor'
										? 'cursor args'
										: context.kind === 'paginate'
											? 'paginate args'
											: 'query args',
						table: context.table,
					},
				);
			},
			beforeUpdate(context): typeof context.data | undefined {
				const zodRegistry = getRegistry(
					context.schema as unknown as Schema,
				);
				if (
					!shouldValidate(
						options.validate,
						context.kind,
						context.args.validate,
					)
				)
					return context.data;

				if (
					context.kind === 'update' ||
					context.kind === 'updateMany'
				) {
					const parsed = parseOrThrow(
						(context.kind === 'update'
							? zodRegistry.getUpdateArgsSchema(context.table)
							: zodRegistry.getUpdateManyArgsSchema(context.table)
						).pick({
							data: true,
							where: true,
						}),
						{
							data: context.data,
							where: context.where,
						},
						{
							operation: `${context.kind} payload`,
							table: context.table,
						},
					) as { data: typeof context.data };

					return preserveRelationCommands(
						context.data,
						parsed.data,
						context.model.columns,
					) as typeof context.data;
				}

				return (
					parseOrThrow(
						zodRegistry
							.getUpdateEachArgsSchema(context.table)
							.pick({
								data: true,
								where: true,
							}),
						{
							data: context.data,
							where: context.where,
						},
						{
							operation: 'updateEach payload',
							table: context.table,
						},
					) as { data: typeof context.data }
				).data;
			},
			afterCreate(context) {
				const zodRegistry = getRegistry(
					context.schema as unknown as Schema,
				);
				if (
					!shouldValidate(
						options.validate,
						'result',
						context.args.validate,
					)
				)
					return;

				parseOrThrow(
					context.kind === 'createMany' ||
						context.kind === 'upsertMany'
						? zodRegistry.getBatchResultSchema(
								context.table,
								context.args,
							)
						: zodRegistry.getSingleResultSchema(
								context.table,
								context.args,
							),
					context.result,
					{
						operation: 'write result',
						table: context.table,
					},
				);
			},
			afterQuery(context) {
				const zodRegistry = getRegistry(
					context.schema as unknown as Schema,
				);
				if (
					!shouldValidate(
						options.validate,
						'result',
						context.args.validate,
					)
				)
					return;
				if (context.kind === 'count' || context.kind === 'exists')
					return;

				parseOrThrow(
					zodRegistry.getQueryResultSchema(
						context.table,
						context.args,
						context.kind,
					),
					context.result,
					{
						operation: 'query result',
						table: context.table,
					},
				);
			},
			afterUpdate(context) {
				const zodRegistry = getRegistry(
					context.schema as unknown as Schema,
				);
				if (
					!shouldValidate(
						options.validate,
						'result',
						context.args.validate,
					)
				)
					return;

				parseOrThrow(
					context.kind === 'updateMany' ||
						context.kind === 'updateEach'
						? zodRegistry.getBatchResultSchema(
								context.table,
								context.args,
							)
						: zodRegistry.getSingleResultSchema(
								context.table,
								context.args,
							),
					context.result,
					{
						operation: 'update result',
						table: context.table,
					},
				);
			},
		},
		extendModel(context) {
			const zodRegistry = getRegistry(
				context.schema as unknown as Schema,
			);
			const tableName = context.model.name;
			const entry = zodRegistry.get(String(tableName));
			if (!entry)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.TableRuntimeNotFound,
					message: `No zod schema registry entry found for "${String(tableName)}".`,
					table: String(tableName),
				});

			return {
				$zod: entry.schemas as unknown as BetterDrizzleZodModelExtension<
					Schema,
					typeof tableName & TableKey<Schema>,
					Options
				>['$zod'],
			};
		},
		options,
		setup(context) {
			getRegistry(context.schema as unknown as Schema);
		},
		version,
	});
};

export default zod;

export type {
	BetterDrizzleZodModelExtension,
	BetterDrizzleZodModelExtensionResolver,
	BetterDrizzleZodModelSchemas,
	ZodPluginBehavior,
	ZodPluginCursorInput,
	ZodPluginOptions,
	ZodPluginPaginationInput,
	ZodPluginQueryInput,
	ZodPluginTableSchemasConfig,
	ZodPluginValidateOptions,
} from './types';

export { version };
