import { definePlugin } from 'better-drizzle';
import type { TimestampsOptions } from './types';

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

/**
 * Adds automatic `createdAt` / `updatedAt` handling to Better Drizzle models.
 *
 * In `app` mode the plugin updates the payload before the database call:
 * - `create` / `createMany`: sets both `createdAt` and `updatedAt`
 * - `update`: sets `updatedAt`
 * - `upsert`: sets both on the create payload and `updatedAt` on the update payload
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
		version: '1.0.0',
	});
};

export default timestamps;

export type { TimestampsOptions } from './types';
