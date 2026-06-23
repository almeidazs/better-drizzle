import type {
	AnySchema,
	BetterDrizzleModelDelegate,
	BetterTableKey,
	UpdateArgs,
	WhereArg,
} from 'better-drizzle';
import { definePlugin } from 'better-drizzle';
import { version } from '../package.json';

import {
	DEFAULT_COLUMN,
	DEFAULT_DELETED_BY_COLUMN,
	DEFAULT_MODE,
	DEFAULT_VISIBILITY,
	type MutableRecord,
	type RestoreModelExtension,
	type SoftDeleteMode,
	type SoftDeleteOptions,
	type SoftDeleteVisibility,
} from './types';

const isRecord = (value: unknown): value is MutableRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const buildDeletedWhere = (
	where: unknown,
	column: string,
	visibility: SoftDeleteVisibility,
) => {
	const deletedWhere =
		visibility === 'only'
			? { [column]: { not: null } }
			: { [column]: null };

	return where
		? {
				AND: [where, deletedWhere],
			}
		: deletedWhere;
};

const createRestoreExtension = <
	Schema extends AnySchema,
	Name extends BetterTableKey<Schema>,
	Meta,
>(
	client: BetterDrizzleModelDelegate<Schema, Name, Meta>,
	column: string,
	deletedByColumn?: string,
): RestoreModelExtension => {
	const data = {
		[column]: null,
	} as UpdateArgs<Schema, Name, Meta>['data'];

	// @ts-expect-error
	if (deletedByColumn) data[deletedByColumn] = null;

	return {
		restore(args) {
			return client.$withoutPlugins().update({
				...args,
				data,
			} as UpdateArgs<Schema, Name, Meta>);
		},
		restoreById(id, args) {
			return client.$withoutPlugins().update({
				...args,
				data,
				where: { id } as unknown as WhereArg<Schema, Name>,
			} as UpdateArgs<Schema, Name, Meta>);
		},
	};
};

export const softDelete = (options: SoftDeleteOptions = {}) => {
	const column = options.column ?? DEFAULT_COLUMN;
	const deletedByColumn =
		options.deletedByColumn ?? DEFAULT_DELETED_BY_COLUMN;
	const defaultMode = options.defaults?.mode ?? DEFAULT_MODE;
	const defaultVisibility =
		options.defaults?.visibility ?? DEFAULT_VISIBILITY;

	return definePlugin<
		SoftDeleteOptions,
		Record<never, never>,
		RestoreModelExtension,
		Record<string, unknown>,
		{
			count: {
				deleted?: SoftDeleteVisibility;
			};
			delete: {
				deletedBy?: string;
				mode?: SoftDeleteMode;
			};
			exists: {
				deleted?: SoftDeleteVisibility;
			};
			findFirst: {
				deleted?: SoftDeleteVisibility;
			};
			findMany: {
				deleted?: SoftDeleteVisibility;
			};
		}
	>({
		description:
			'Adds soft delete visibility filters and delete overrides.',
		id: '@better-drizzle/soft-delete',
		name: 'Soft Delete',
		operationArgs: {
			count: {
				deleted: undefined as SoftDeleteVisibility | undefined,
			},
			delete: {
				deletedBy: undefined as string | undefined,
				mode: undefined as SoftDeleteMode | undefined,
			},
			exists: {
				deleted: undefined as SoftDeleteVisibility | undefined,
			},
			findFirst: {
				deleted: undefined as SoftDeleteVisibility | undefined,
			},
			findMany: {
				deleted: undefined as SoftDeleteVisibility | undefined,
			},
		},
		hooks: {
			beforeDelete(context) {
				if (
					context.kind !== 'delete' ||
					!context.model.hasColumn(column)
				)
					return;

				const mode = context.args.mode ?? defaultMode;

				if (mode === 'hard') return;

				const data = {
					[column]: new Date(),
				} as UpdateArgs<
					typeof context.schema,
					typeof context.table,
					typeof context.meta
				>['data'];

				if (
					isRecord(data) &&
					context.args.deletedBy !== undefined &&
					context.model.hasColumn(deletedByColumn)
				)
					data[deletedByColumn] = context.args.deletedBy;

				return context.client.$withoutPlugins().update({
					include: context.include,
					meta: context.meta,
					select: context.select,
					data,
					where: context.where as WhereArg<
						typeof context.schema,
						typeof context.table
					>,
				});
			},
		},
		extendModel({ client, model }) {
			if (!model.hasColumn(column)) return;

			return createRestoreExtension(
				client,
				column,
				model.hasColumn(deletedByColumn) ? deletedByColumn : undefined,
			);
		},
		options,
		transform(operation) {
			if (
				(operation.kind !== 'findMany' &&
					operation.kind !== 'findFirst' &&
					operation.kind !== 'count' &&
					operation.kind !== 'exists') ||
				!operation.model.hasColumn(column)
			)
				return operation;

			const visibility = operation.args.deleted ?? defaultVisibility;

			if (visibility === 'with') return operation;

			operation.where = buildDeletedWhere(
				operation.where,
				column,
				visibility,
			) as typeof operation.where;

			return operation;
		},
		version,
	});
};

export default softDelete;

export type {
	SoftDeleteDefaultVisibility,
	SoftDeleteMode,
	SoftDeleteOptions,
	SoftDeleteVisibility,
} from './types';
