import {
	type AnySchema,
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	definePlugin,
} from 'better-drizzle';

import { createAtaSchemasRegistry } from './shared/registry';
import {
	shouldValidate,
	stripUnknownColumns,
	validateOrThrow,
} from './shared/validation';
import type { AtaPluginOptions, BetterDrizzleAtaModelExtension } from './types';
import { version } from './version';

/**
 * Validate Better Drizzle operations with ata.
 *
 * The plugin describes each table as JSON Schema and compiles it once. What that
 * buys over a validator built from objects is that the description is data: the
 * same schema reaches `db.user.$ata.create.schema` as a plain object, so it can
 * go to an HTTP layer, a form, or a file without being rewritten.
 *
 * Three column kinds have no spelling in JSON Schema, `Date`, `BigInt` and
 * `Buffer`, so the schema asks nothing of them and a predicate checks them after
 * ata has accepted the row. That split is the plugin's one compromise and it is
 * visible: `db.user.$ata.residues` names every column it applies to.
 */
export const ata = <
	Schema extends AnySchema,
	const Options extends AtaPluginOptions<Schema> = AtaPluginOptions<Schema>,
>(
	options: Options = {} as Options,
) => {
	let registry: ReturnType<typeof createAtaSchemasRegistry> | null = null;

	const getRegistry = (schema: unknown) => {
		registry ??= createAtaSchemasRegistry(
			schema as Record<string, unknown>,
			options,
		);
		return registry;
	};

	const validateFlag = (args: unknown): boolean | undefined =>
		(args as { validate?: boolean } | undefined)?.validate;

	return definePlugin<
		Options,
		Record<never, never>,
		BetterDrizzleAtaModelExtension,
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
		}
	>({
		description:
			'Describes Drizzle models as JSON Schema and validates Better Drizzle operations with ata.',
		extendModel(context) {
			const entry = getRegistry(context.schema).get(
				String(context.model.name),
			);
			if (!entry)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.TableRuntimeNotFound,
					message: `No ata schema registry entry found for "${String(context.model.name)}".`,
					table: String(context.model.name),
				});

			return { $ata: entry.schemas };
		},
		hooks: {
			afterCreate(context) {
				if (
					!shouldValidate(
						options.validate,
						'result',
						validateFlag(context.args),
					)
				)
					return;

				const many =
					context.kind === 'createMany' ||
					context.kind === 'upsertMany';
				// A batch write reports a count, not the rows, unless the rows
				// were asked for. Only the rows are worth checking.
				const result = context.result as { data?: unknown } | unknown;
				const value =
					many &&
					result &&
					typeof result === 'object' &&
					'data' in result
						? (result as { data?: unknown }).data
						: context.result;
				if (many && value === undefined) return;

				validateOrThrow(
					getRegistry(context.schema).getResult(
						String(context.table),
						many,
						context.args,
					),
					value,
					{ operation: 'write result', table: String(context.table) },
				);
			},
			afterQuery(context) {
				if (
					!shouldValidate(
						options.validate,
						'result',
						validateFlag(context.args),
					)
				)
					return;
				// `count` answers a number and `exists` a boolean; neither is a row.
				if (context.kind === 'count' || context.kind === 'exists')
					return;

				// The paginated shapes wrap the rows in an envelope the core owns.
				const result = context.result as { data?: unknown };
				const paginated =
					context.kind === 'cursor' || context.kind === 'paginate';
				const value = paginated ? result?.data : context.result;
				if (paginated && value === undefined) return;

				validateOrThrow(
					getRegistry(context.schema).getResult(
						String(context.table),
						paginated || context.kind === 'findMany',
						context.args,
					),
					value,
					{ operation: 'query result', table: String(context.table) },
				);
			},
			afterUpdate(context) {
				if (
					!shouldValidate(
						options.validate,
						'result',
						validateFlag(context.args),
					)
				)
					return;

				const many =
					context.kind === 'updateMany' ||
					context.kind === 'updateEach';
				const result = context.result as { data?: unknown } | unknown;
				const value =
					many &&
					result &&
					typeof result === 'object' &&
					'data' in result
						? (result as { data?: unknown }).data
						: context.result;
				if (many && value === undefined) return;

				validateOrThrow(
					getRegistry(context.schema).getResult(
						String(context.table),
						many,
						context.args,
					),
					value,
					{
						operation: 'update result',
						table: String(context.table),
					},
				);
			},
			beforeCreate(context): typeof context.data | undefined {
				if (
					!shouldValidate(
						options.validate,
						context.kind,
						validateFlag(context.args),
					)
				)
					return context.data;

				const create = getRegistry(context.schema).getCreate(
					String(context.table),
				);
				const table = String(context.table);

				if (
					context.kind === 'createMany' ||
					context.kind === 'upsertMany'
				) {
					const rows = Array.isArray(context.data)
						? context.data
						: [];
					for (const row of rows)
						validateOrThrow(create, row, {
							operation: `${context.kind} payload`,
							table,
						});
					if (
						context.kind === 'upsertMany' &&
						context.args.update &&
						typeof context.args.update === 'object' &&
						!Array.isArray(context.args.update)
					)
						validateOrThrow(
							getRegistry(context.schema).getUpdate(table),
							context.args.update,
							{ operation: 'upsertMany update payload', table },
						);
					return context.data;
				}

				if (context.kind === 'upsert') {
					const entry = getRegistry(context.schema).get(table);
					const payload = context.data as
						| { create?: unknown; update?: unknown }
						| undefined;
					validateOrThrow(
						create,
						stripUnknownColumns(
							payload?.create,
							entry?.columns ?? {},
						),
						{
							operation: 'upsert create payload',
							table,
						},
					);
					validateOrThrow(
						getRegistry(context.schema).getUpdate(table),
						stripUnknownColumns(
							payload?.update,
							entry?.columns ?? {},
						),
						{ operation: 'upsert update payload', table },
					);
					if (context.where !== undefined)
						validateOrThrow(entry?.schemas.where, context.where, {
							operation: 'upsert where',
							table,
						});
					return context.data;
				}

				validateOrThrow(
					create,
					stripUnknownColumns(
						context.data,
						getRegistry(context.schema).get(table)?.columns ?? {},
					),
					{
						operation: 'create payload',
						table,
					},
				);
				return context.data;
			},
			beforeDelete(context) {
				const enabled =
					shouldValidate(
						options.validate,
						context.kind,
						validateFlag(context.args),
					) ||
					shouldValidate(
						options.validate,
						'query',
						validateFlag(context.args),
					);
				if (!enabled) return;

				validateOrThrow(
					getRegistry(context.schema).getDeleteArgs(
						String(context.table),
						context.kind !== 'delete',
					),
					context.args,
					{
						operation: `${context.kind} args`,
						table: String(context.table),
					},
				);
			},
			beforeQuery(context) {
				const enabled =
					shouldValidate(
						options.validate,
						context.kind,
						validateFlag(context.args),
					) ||
					shouldValidate(
						options.validate,
						'query',
						validateFlag(context.args),
					);
				if (!enabled) return;

				const schemas = getRegistry(context.schema);
				const table = String(context.table);
				const args =
					context.kind === 'count' || context.kind === 'exists'
						? schemas.getCountArgs(table)
						: context.kind === 'cursor'
							? schemas.getCursorArgs(table)
							: context.kind === 'paginate'
								? schemas.getPaginationArgs(table)
								: schemas.getQueryArgs(table);

				validateOrThrow(args, context.args, {
					operation: `${context.kind} args`,
					table,
				});
			},
			beforeUpdate(context): typeof context.data | undefined {
				if (
					!shouldValidate(
						options.validate,
						context.kind,
						validateFlag(context.args),
					)
				)
					return context.data;

				const table = String(context.table);
				const update = getRegistry(context.schema).getUpdate(table);
				const entry = getRegistry(context.schema).get(table);

				if (context.kind === 'updateEach') {
					const rows = Array.isArray(context.data)
						? context.data
						: [];
					for (const row of rows)
						validateOrThrow(update, row, {
							operation: 'updateEach payload',
							table,
						});
					if (context.where !== undefined)
						validateOrThrow(entry?.schemas.where, context.where, {
							operation: 'updateEach where',
							table,
						});
					return context.data;
				}

				validateOrThrow(
					update,
					stripUnknownColumns(context.data, entry?.columns ?? {}),
					{
						operation: `${context.kind} payload`,
						table,
					},
				);
				if (context.where !== undefined)
					validateOrThrow(entry?.schemas.where, context.where, {
						operation: `${context.kind} where`,
						table,
					});
				return context.data;
			},
		},
		id: 'better-drizzle/ata',
		name: 'ata',
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
		options,
		setup(context) {
			getRegistry(context.schema);
		},
		version,
	});
};

export default ata;

export { stripUnknownColumns };
export { createAtaSchemasRegistry } from './shared/registry';
export { checkResidue, columnToSchema } from './shared/column';
export { createRowValidator } from './shared/row';
export { createWhereSchema, whereDefinitions } from './shared/where';
export {
	createCountArgsSchema,
	createCursorArgsSchema,
	createCursorSchema,
	createDeleteArgsSchema,
	createIncludeSchema,
	createLockSchema,
	createOrderBySchema,
	createPaginationArgsSchema,
	createQueryArgsSchema,
	createSelectSchema,
} from './shared/query';
export { DEFAULT_VALIDATE, shouldValidate } from './shared/validation';

export type {
	AtaCompiledSchema,
	AtaPluginOptions,
	AtaPluginTableConfig,
	AtaPluginValidateOptions,
	AtaValidateKey,
	BetterDrizzleAtaModelExtension,
	BetterDrizzleAtaModelSchemas,
	JsonSchema,
	ResidueKind,
} from './types';
export type { AtaSchemasRegistry, TableEntry } from './shared/registry';
export type { RowMode, RowValidator } from './shared/row';
export type { AtaIssue } from './shared/validation';

export { version };
