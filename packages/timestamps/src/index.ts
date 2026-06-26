import { definePlugin } from 'better-drizzle';
import type { TimestampsOptions } from './types';
import { version } from './version';

type MutableRecord = Record<string, unknown>;

const DEFAULT_CREATED_AT = 'createdAt';
const DEFAULT_UPDATED_AT = 'updatedAt';

/**
 * Sets a timestamp field on a mutable payload when the corresponding column
 * exists on the current model.
 */
const withTimestamp = (
	data: MutableRecord,
	column: string,
	value: Date,
	enabled: boolean,
) => {
	if (!enabled) return data;

	data[column] = value;
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
 * - `update`: sets `updatedAt`
 * - `upsert`: sets both on the create payload and `updatedAt` on the update payload
 * - `upsertMany`: stamps insert rows and keeps only `updatedAt` on conflict updates
 *
 * In `database` mode the plugin does nothing, which is useful when the schema
 * already relies on DB defaults or triggers.
 *
 * @param options - Optional timestamp column names and execution mode.
 * @returns A Better Drizzle plugin definition.
 */
export const timestamps = (options: TimestampsOptions = {}) => {
	const createdAt = options.createdAt ?? DEFAULT_CREATED_AT;
	const updatedAt = options.updatedAt ?? DEFAULT_UPDATED_AT;
	const mode = options.mode ?? 'app';

	return definePlugin({
		description: 'Automatically manages createdAt and updatedAt fields.',
		id: '@better-drizzle/timestamps',
		name: 'Timestamps',
		options,
		hooks:
			mode === 'database'
				? undefined
				: {
						beforeCreate(operation) {
							const hasCreatedAt =
								operation.model.hasColumn(createdAt);
							const hasUpdatedAt =
								operation.model.hasColumn(updatedAt);

							if (!hasCreatedAt && !hasUpdatedAt)
								return operation.data;

							const now = new Date();

							if (operation.kind === 'create') {
								if (!isRecord(operation.data))
									return operation.data;

								return withTimestamp(
									withTimestamp(
										{ ...operation.data },
										createdAt,
										now,
										hasCreatedAt,
									),
									updatedAt,
									now,
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
											now,
											hasCreatedAt,
										),
										updatedAt,
										now,
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
											now,
											hasCreatedAt,
										),
										updatedAt,
										now,
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
										const index =
											columns.indexOf(createdAt);
										if (index >= 0)
											columns.splice(index, 1);
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
													Object.entries(
														update,
													).filter(
														([column]) =>
															column !==
															createdAt,
													),
												)
											: { ...update },
										updatedAt,
										now,
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
														Object.entries(
															resolved,
														).filter(
															([column]) =>
																column !==
																createdAt,
														),
													)
												: { ...resolved }
											: {};

										return withTimestamp(
											base,
											updatedAt,
											now,
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
											now,
											hasCreatedAt,
										),
										updatedAt,
										now,
										hasUpdatedAt,
									)
								: operation.data.create;
							const updateData = isRecord(operation.data.update)
								? withTimestamp(
										{ ...operation.data.update },
										updatedAt,
										now,
										hasUpdatedAt,
									)
								: operation.data.update;

							return {
								create: createData,
								update: updateData,
							};
						},
						beforeUpdate(operation) {
							if (
								!operation.model.hasColumn(updatedAt) ||
								!isRecord(operation.data)
							)
								return operation.data;

							return withTimestamp(
								{ ...operation.data },
								updatedAt,
								new Date(),
								true,
							);
						},
					},
		version,
	});
};

export default timestamps;

export type { TimestampsOptions } from './types';
export { version };
