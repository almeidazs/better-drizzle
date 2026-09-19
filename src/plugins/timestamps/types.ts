/**
 * Supported timestamp management modes.
 *
 * - `'app'`: Better Drizzle sets `createdAt` / `updatedAt` in plugin hooks.
 * - `'database'`: the database is responsible for populating and updating the
 *   timestamp columns, so the plugin stays as a no-op.
 */
export type TimestampMode = 'app' | 'database';

/**
 * Configuration accepted by {@link timestamps}.
 */
export type TimestampsOptions = {
	/**
	 * Column name used for the creation timestamp.
	 *
	 * @default 'createdAt'
	 */
	createdAt?: string;
	/**
	 * Timestamp management strategy.
	 *
	 * @default 'app'
	 */
	mode?: TimestampMode;
	/**
	 * Column name used for the update timestamp.
	 *
	 * @default 'updatedAt'
	 */
	updatedAt?: string;
};
