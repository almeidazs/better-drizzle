import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	definePlugin,
	type PluginModelInfo,
} from 'better-drizzle';

import type { TimestampsOptions } from './types';
import { version } from './version';

type MutableRecord = Record<string, unknown>;

type ModelColumns = {
	createdAt: string;
	createdText: boolean;
	hasCreatedAt: boolean;
	hasUpdatedAt: boolean;
	updatedAt: string;
	updatedText: boolean;
};

const DEFAULT_CREATED_AT = 'createdAt';
const DEFAULT_UPDATED_AT = 'updatedAt';

/**
 * Sets a timestamp field on a mutable payload when the corresponding column
 * exists on the current model.
 */
const withTimestamp = <T extends MutableRecord>(
	data: T,
	column: string,
	value: Date | string,
	enabled: boolean,
) => {
	if (!enabled) return data;

	(data as Record<string, unknown>)[column] = value;
	return data;
};

/**
 * Narrow unknown values to plain records so the plugin can safely clone and
 * augment Drizzle insert/update payloads.
 */
const isRecord = (value: unknown): value is MutableRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const appendColumn = (columns: string[], column: string, enabled: boolean) => {
	if (!enabled || columns.includes(column)) return columns;

	columns.push(column);
	return columns;
};

/**
 * Adds automatic `createdAt` / `updatedAt` handling to Better Drizzle models.
 *
 * In `app` mode the plugin updates the payload before the database call:
 * - `create` / `createMany`: sets both `createdAt` and `updatedAt`
 * - `update` / `updateEach`: sets `updatedAt`
 * - `upsert`: sets both on the create payload and `updatedAt` on the update payload
 * - `upsertMany`: stamps insert rows and keeps only `updatedAt` on conflict updates
 *
 * In `database` mode the plugin does nothing, which is useful when the schema
 * already relies on DB defaults or triggers.
 *
 * Every write reads `now()` once, so `createdAt` and `updatedAt` match.
 * `models` overrides column names per table key, or disables a model with
 * `false`; overridden columns must exist.
 *
 * @param options - Optional column names, clock, per-model overrides, and mode.
 * @returns A Better Drizzle plugin definition.
 */
export const timestamps = (options: TimestampsOptions = {}) => {
	const createdAt = options.createdAt ?? DEFAULT_CREATED_AT;
	const updatedAt = options.updatedAt ?? DEFAULT_UPDATED_AT;
	const clock = options.now ?? (() => new Date());

	return definePlugin({
		description: 'Automatically manages createdAt and updatedAt fields.',
		id: 'better-drizzle/timestamps',
		name: 'Timestamps',
		options,
		setup({ addHook, models }) {
			if (options.mode === 'database') return;

			const byModel = Object.create(null) as Record<string, ModelColumns>;
			for (const name in models) {
				const model = models[name] as PluginModelInfo;
				const override = options.models?.[name];
				if (override === false) continue;

				const created = override?.createdAt ?? createdAt;
				const updated = override?.updatedAt ?? updatedAt;
				for (const column of [override?.createdAt, override?.updatedAt])
					if (column !== undefined && !model.hasColumn(column))
						throw new BetterDrizzleError({
							code: BetterDrizzleErrorCode.PluginRequiredColumnMissing,
							column,
							details: { pluginId: 'better-drizzle/timestamps' },
							message: `Plugin "better-drizzle/timestamps" requires column "${column}" on model "${name}".`,
							table: name,
						});

				const hasCreatedAt = model.hasColumn(created);
				const hasUpdatedAt = model.hasColumn(updated);
				if (!hasCreatedAt && !hasUpdatedAt) continue;

				byModel[name] = {
					createdAt: created,
					createdText: Boolean(
						model.columns[created]?.dataType.startsWith('string'),
					),
					hasCreatedAt,
					hasUpdatedAt,
					updatedAt: updated,
					updatedText: Boolean(
						model.columns[updated]?.dataType.startsWith('string'),
					),
				};
			}

			addHook({
				beforeCreate(operation) {
					const model = byModel[operation.model.name];
					if (!model) return operation.data;

					const { createdAt, hasCreatedAt, hasUpdatedAt, updatedAt } =
						model;
					const now = clock();
					const createdValue = model.createdText
						? now.toISOString()
						: now;
					const updatedValue = model.updatedText
						? now.toISOString()
						: now;

					if (operation.kind === 'create') {
						if (!isRecord(operation.data)) return operation.data;

						return withTimestamp(
							withTimestamp(
								{ ...operation.data },
								createdAt,
								createdValue,
								hasCreatedAt,
							),
							updatedAt,
							updatedValue,
							hasUpdatedAt,
						);
					}

					if (operation.kind === 'createMany') {
						if (!Array.isArray(operation.data))
							return operation.data;

						const result = new Array(operation.data.length);

						for (
							let index = 0;
							index < operation.data.length;
							index += 1
						) {
							const row = operation.data[index];
							if (!isRecord(row)) {
								result[index] = row;
								continue;
							}

							result[index] = withTimestamp(
								withTimestamp(
									{ ...row },
									createdAt,
									createdValue,
									hasCreatedAt,
								),
								updatedAt,
								updatedValue,
								hasUpdatedAt,
							);
						}

						return result;
					}

					if (operation.kind === 'upsertMany') {
						if (!Array.isArray(operation.data))
							return operation.data;

						const result = new Array(operation.data.length);

						for (
							let index = 0;
							index < operation.data.length;
							index += 1
						) {
							const row = operation.data[index];
							if (!isRecord(row)) {
								result[index] = row;
								continue;
							}

							result[index] = withTimestamp(
								withTimestamp(
									{ ...row },
									createdAt,
									createdValue,
									hasCreatedAt,
								),
								updatedAt,
								updatedValue,
								hasUpdatedAt,
							);
						}

						const args = operation.args as {
							update?: unknown;
						};
						const update = args.update;

						if (update === 'all') {
							const columns = Object.keys(
								operation.model.columns,
							);

							if (hasCreatedAt) {
								const index = columns.indexOf(createdAt);
								if (index >= 0) columns.splice(index, 1);
							}

							args.update = appendColumn(
								columns,
								updatedAt,
								hasUpdatedAt,
							);
							return result;
						}

						if (Array.isArray(update)) {
							const columns = update.filter(
								(column) => column !== createdAt,
							);

							args.update = appendColumn(
								columns,
								updatedAt,
								hasUpdatedAt,
							);
							return result;
						}

						if (isRecord(update)) {
							args.update = withTimestamp(
								hasCreatedAt
									? Object.fromEntries(
											Object.entries(update).filter(
												([column]) =>
													column !== createdAt,
											),
										)
									: { ...update },
								updatedAt,
								updatedValue,
								hasUpdatedAt,
							);
							return result;
						}

						if (typeof update === 'function') {
							args.update = (context: {
								excluded: Record<string, unknown>;
								sql: unknown;
								table: Record<string, unknown>;
							}) => {
								const resolved = update(context);
								const base = isRecord(resolved)
									? hasCreatedAt
										? Object.fromEntries(
												Object.entries(resolved).filter(
													([column]) =>
														column !== createdAt,
												),
											)
										: { ...resolved }
									: {};

								return withTimestamp(
									base,
									updatedAt,
									updatedValue,
									hasUpdatedAt,
								);
							};
						}

						return result;
					}

					if (
						operation.kind !== 'upsert' ||
						!isRecord(operation.data)
					)
						return operation.data;

					const createData = isRecord(operation.data.create)
						? withTimestamp(
								withTimestamp(
									{ ...operation.data.create },
									createdAt,
									createdValue,
									hasCreatedAt,
								),
								updatedAt,
								updatedValue,
								hasUpdatedAt,
							)
						: operation.data.create;
					const updateData = isRecord(operation.data.update)
						? withTimestamp(
								{ ...operation.data.update },
								updatedAt,
								updatedValue,
								hasUpdatedAt,
							)
						: operation.data.update;

					return {
						create: createData,
						update: updateData,
					};
				},
				beforeUpdate(operation) {
					const model = byModel[operation.model.name];
					if (!model?.hasUpdatedAt) return operation.data;

					const { updatedAt } = model;
					const now = clock();
					const value = model.updatedText ? now.toISOString() : now;

					if (operation.kind === 'updateEach') {
						const args = operation.args as {
							update?: Record<string, unknown>;
						};

						args.update = {
							...(args.update ?? {}),
							[updatedAt]: () => value,
						};
						return operation.data;
					}

					if (!isRecord(operation.data)) return operation.data;

					return withTimestamp(
						{ ...operation.data },
						updatedAt,
						value,
						true,
					);
				},
			});
		},
		version,
	});
};

export default timestamps;

export type { TimestampModelOptions, TimestampsOptions } from './types';
export { version };
