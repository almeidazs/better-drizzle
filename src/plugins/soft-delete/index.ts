import type {
	AnySchema,
	BetterDrizzleModelDelegate,
	BetterTableKey,
	UpdateArgs,
} from 'better-drizzle';
import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	definePlugin,
} from 'better-drizzle';

import { deferPluginOperation } from '../../shared/client/plugin-override';
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

const restoreOperation = Symbol('soft-delete/restore');

const isRecord = (value: unknown): value is MutableRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

// Writes with an empty `where` are no-ops in the core; a soft delete must
// not turn one into an update.
const hasCondition = (where: unknown): boolean => {
	if (where === undefined) return false;
	if (Array.isArray(where)) return where.some(hasCondition);
	if (!isRecord(where)) return true;
	for (const key in where) if (hasCondition(where[key])) return true;
	return false;
};

const createRestoreExtension = <
	Schema extends AnySchema,
	Name extends BetterTableKey<Schema>,
	Meta,
>(
	client: BetterDrizzleModelDelegate<Schema, Name, Meta>,
	column: string,
	primaryKey: readonly string[],
	deletedByColumn?: string,
): RestoreModelExtension => {
	const restore: RestoreModelExtension['restore'] = (args) => {
		const data: MutableRecord = { [column]: null };
		if (deletedByColumn) data[deletedByColumn] = null;
		return client.update({
			...args,
			data,
			deleted: 'with',
			[restoreOperation]: true,
		} as UpdateArgs<Schema, Name, Meta> as never);
	};

	return {
		restore,
		restoreById(id, args) {
			if (primaryKey.length !== 1)
				throw new BetterDrizzleError({
					code: BetterDrizzleErrorCode.InvalidArgs,
					message:
						'restoreById requires a single-column primary key. Use restore({ where }) instead.',
				});
			return restore({
				...args,
				where: { [primaryKey[0]!]: id },
			});
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

export const softDelete = (options: SoftDeleteOptions = {}) => {
	const column = options.column ?? DEFAULT_COLUMN;
	const deletedByColumn =
		options.deletedByColumn ?? DEFAULT_DELETED_BY_COLUMN;
	const defaultMode = options.defaults?.mode ?? DEFAULT_MODE;
	const defaultVisibility =
		options.defaults?.visibility ?? DEFAULT_VISIBILITY;
	const live = { [column]: null };
	const deletedOnly = { [column]: { not: null } };
	const withoutOwnedColumns = <T>(data: T, hasDeletedBy: boolean): T => {
		if (
			!isRecord(data) ||
			(!(column in data) && !(hasDeletedBy && deletedByColumn in data))
		)
			return data;
		const copy = { ...data };
		delete (copy as Record<string, unknown>)[column];
		if (hasDeletedBy)
			delete (copy as Record<string, unknown>)[deletedByColumn];
		return copy;
	};
	const protectUpdate = (
		args: { target?: unknown; update?: unknown },
		columns: Record<string, unknown>,
		hasDeletedBy: boolean,
	) => {
		const update = args.update;
		if (update === 'all') {
			const target = Array.isArray(args.target)
				? args.target
				: [args.target];
			args.update = Object.keys(columns).filter(
				(key) =>
					key !== column &&
					!target.includes(key) &&
					(!hasDeletedBy || key !== deletedByColumn),
			);
		} else if (Array.isArray(update)) {
			if (
				update.includes(column) ||
				(hasDeletedBy && update.includes(deletedByColumn))
			)
				args.update = update.filter(
					(key) =>
						key !== column &&
						(!hasDeletedBy || key !== deletedByColumn),
				);
		} else if (typeof update === 'function')
			args.update = (context: unknown) =>
				withoutOwnedColumns(update(context), hasDeletedBy);
		else if (isRecord(update))
			args.update = withoutOwnedColumns(update, hasDeletedBy);
	};

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
			beforeCreate(context) {
				if (!context.model.hasColumn(column)) return context.data;
				const hasDeletedBy = context.model.hasColumn(deletedByColumn);
				if (context.kind === 'upsertMany')
					protectUpdate(
						context.args as { update?: unknown },
						context.model.columns,
						hasDeletedBy,
					);
				if (Array.isArray(context.data)) {
					let rows = context.data;
					for (let index = 0; index < context.data.length; index++) {
						const row = context.data[index];
						const clean = withoutOwnedColumns(row, hasDeletedBy);
						if (clean !== row) {
							if (rows === context.data)
								rows = context.data.slice();
							rows[index] = clean;
						}
					}
					return rows;
				}
				if (context.kind === 'upsert' && isRecord(context.data)) {
					const create = withoutOwnedColumns(
						context.data.create,
						hasDeletedBy,
					);
					const update = withoutOwnedColumns(
						context.data.update,
						hasDeletedBy,
					);
					return create === context.data.create &&
						update === context.data.update
						? context.data
						: { ...context.data, create, update };
				}
				return withoutOwnedColumns(context.data, hasDeletedBy);
			},
			beforeUpdate(context) {
				if (!context.model.hasColumn(column)) return context.data;
				// Only restore helpers may clear the plugin-owned columns.
				if (restoreOperation in context.args) return context.data;
				const hasDeletedBy = context.model.hasColumn(deletedByColumn);
				if (context.kind === 'updateEach') {
					protectUpdate(
						context.args as { update?: unknown },
						context.model.columns,
						hasDeletedBy,
					);
					return context.data;
				}
				return withoutOwnedColumns(context.data, hasDeletedBy);
			},
			beforeDelete(context) {
				if (!context.model.hasColumn(column)) return;

				// `root()` must see the effective mode, including a hard default.
				if (context.args.mode === undefined && defaultMode === 'hard')
					context.args.mode = 'hard';
				return deferPluginOperation((next) => {
					// Transforms and later before hooks can change the final args.
					const args = context.args as Record<string, unknown> &
						DeleteArgs;
					if (
						(args.mode ?? defaultMode) === 'hard' ||
						!hasCondition(args.where)
					)
						return next();

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
						args.deletedBy !== undefined &&
						context.model.hasColumn(deletedByColumn)
					)
						data[deletedByColumn] = args.deletedBy;

					// Keep tenant and visibility scopes on the underlying update.
					const target = context.client.$withoutPlugins({
						keepScopes: true,
					});
					const deleted = args.deleted ?? 'without';

					if (context.kind === 'deleteMany')
						return target.updateMany({
							data,
							deleted,
							meta: context.meta,
							select: args.select,
							where: args.where,
						} as never);

					return target.update({
						data,
						deleted,
						include: args.include,
						meta: context.meta,
						select: args.select,
						where: args.where,
					} as never);
				});
			},
		},
		extendModel({ client, model }) {
			if (!model.hasColumn(column)) return;

			return createRestoreExtension(
				client,
				column,
				model.primaryKey,
				model.hasColumn(deletedByColumn) ? deletedByColumn : undefined,
			);
		},
		options,
		// Nested reads (relations, filters, `count`, sorts) always use the
		// static `where`; `root()` maps the root `deleted` argument. Upserts
		// stay unfiltered: hiding a deleted row would turn the update branch
		// into a duplicate insert.
		scope: {
			key: 'softDelete',
			model: (model) =>
				model.hasColumn(column)
					? { upsert: false, where: live }
					: undefined,
			root(args) {
				const deleted = args.deleted as
					| SoftDeleteVisibility
					| undefined;
				if (deleted === undefined) {
					// A hard delete purges whatever matches unless `deleted` narrows it.
					if (args.mode === 'hard') return null;
					return defaultVisibility === 'with' ? null : undefined;
				}
				if (deleted === 'with') return null;
				return deleted === 'only' ? deletedOnly : undefined;
			},
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
