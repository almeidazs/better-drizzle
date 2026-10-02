import type {
	AnySchema,
	BetterDrizzleModelDelegate,
	BetterTableKey,
	UpdateArgs,
	WhereArg,
} from 'better-drizzle';
import { definePlugin } from 'better-drizzle';

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
import { version } from './version';

const isRecord = (value: unknown): value is MutableRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

// Writes with an empty `where` are no-ops in the core. Adding the visibility
// filter to one would turn it into a write over every live row.
const hasCondition = (where: unknown): boolean => {
	if (where === undefined) return false;
	if (Array.isArray(where)) return where.some(hasCondition);
	if (!isRecord(where)) return true;
	for (const key in where) if (hasCondition(where[key])) return true;
	return false;
};

const WRITE_KINDS = new Set<string>([
	'delete',
	'deleteMany',
	'update',
	'updateEach',
	'updateMany',
]);

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
	} as MutableRecord;

	if (deletedByColumn) data[deletedByColumn] = null;

	return {
		restore(args) {
			return client.$withoutPlugins().update({
				...args,
				data,
			} as UpdateArgs<Schema, Name, Meta> as never);
		},
		restoreById(id, args) {
			return client.$withoutPlugins().update({
				...args,
				data,
				where: { id } as unknown as WhereArg<Schema, Name>,
			} as UpdateArgs<Schema, Name, Meta> as never);
		},
	};
};

type VisibilityArgs = { deleted?: SoftDeleteVisibility };
type DeleteArgs = VisibilityArgs & {
	deletedBy?: string;
	mode?: SoftDeleteMode;
};

const visibilityArgs = {
	deleted: undefined as SoftDeleteVisibility | undefined,
};
const deleteArgs = {
	...visibilityArgs,
	deletedBy: undefined as string | undefined,
	mode: undefined as SoftDeleteMode | undefined,
};

// Every operation with a `where`. upsert/upsertMany stay unfiltered: hiding a
// deleted row there would turn the update branch into a duplicate insert.
const FILTERED_KINDS = new Set<string>([
	'count',
	'cursor',
	'delete',
	'deleteMany',
	'exists',
	'findFirst',
	'findMany',
	'findOne',
	'findUnique',
	'paginate',
	'update',
	'updateEach',
	'updateMany',
]);

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
			count: VisibilityArgs;
			cursor: VisibilityArgs;
			delete: DeleteArgs;
			deleteMany: DeleteArgs;
			exists: VisibilityArgs;
			findFirst: VisibilityArgs;
			findMany: VisibilityArgs;
			findOne: VisibilityArgs;
			findUnique: VisibilityArgs;
			paginate: VisibilityArgs;
			update: VisibilityArgs;
			updateEach: VisibilityArgs;
			updateMany: VisibilityArgs;
		}
	>({
		description:
			'Adds soft delete visibility filters and delete overrides.',
		id: 'better-drizzle/soft-delete',
		name: 'Soft Delete',
		operationArgs: {
			count: visibilityArgs,
			cursor: visibilityArgs,
			delete: deleteArgs,
			deleteMany: deleteArgs,
			exists: visibilityArgs,
			findFirst: visibilityArgs,
			findMany: visibilityArgs,
			findOne: visibilityArgs,
			findUnique: visibilityArgs,
			paginate: visibilityArgs,
			update: visibilityArgs,
			updateEach: visibilityArgs,
			updateMany: visibilityArgs,
		},
		hooks: {
			beforeDelete(context) {
				if (
					!context.model.hasColumn(column) ||
					!hasCondition(context.where)
				)
					return;

				const mode = context.args.mode ?? defaultMode;

				if (mode === 'hard') return;

				const timestamp = context.model.columns[
					column
				]?.dataType.startsWith('string')
					? new Date().toISOString()
					: new Date();
				const data = {
					[column]: timestamp,
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

				// Hooks run before transforms, so the visibility filter is applied
				// here: a soft delete never re-stamps an already deleted row.
				const visibility = context.args.deleted ?? 'without';
				const where = (
					visibility === 'with'
						? context.where
						: buildDeletedWhere(context.where, column, visibility)
				) as WhereArg<typeof context.schema, typeof context.table>;

				if (context.kind === 'deleteMany')
					return context.client.$withoutPlugins().updateMany({
						select: context.select,
						data,
						meta: context.meta,
						where,
					} as never);

				return context.client.$withoutPlugins().update({
					include: context.include,
					meta: context.meta,
					select: context.select,
					data,
					where,
				} as never);
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
				!FILTERED_KINDS.has(operation.kind) ||
				!operation.model.hasColumn(column) ||
				(WRITE_KINDS.has(operation.kind) &&
					!hasCondition(operation.where))
			)
				return operation;

			const args = operation.args as {
				deleted?: SoftDeleteVisibility;
				mode?: SoftDeleteMode;
			};
			// A hard delete purges whatever matches unless `deleted` narrows it.
			if (
				(operation.kind === 'delete' ||
					operation.kind === 'deleteMany') &&
				(args.mode ?? defaultMode) === 'hard' &&
				args.deleted === undefined
			)
				return operation;
			const visibility = args.deleted ?? defaultVisibility;

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

export { version };
