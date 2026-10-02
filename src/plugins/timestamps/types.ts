/**
 * Supported timestamp management modes.
 *
 * - `'app'`: Better Drizzle sets `createdAt` / `updatedAt` in plugin hooks.
 * - `'database'`: the database is responsible for populating and updating the
 *   timestamp columns, so the plugin stays as a no-op.
 */
export type TimestampMode = 'app' | 'database';

/**
 * Per-model override. `false` turns the plugin off for that model.
 */
export type TimestampModelOptions =
	| false
	| {
			/** Creation timestamp column for this model. Must exist. */
			createdAt?: string;
			/** Update timestamp column for this model. Must exist. */
			updatedAt?: string;
	  };

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
	 * Overrides keyed by table key. Unknown keys are ignored.
	 */
	models?: Readonly<Record<string, TimestampModelOptions>>;
	/**
	 * Clock used for every timestamp the plugin writes. Called once per
	 * operation, so `createdAt` and `updatedAt` match.
	 *
	 * @default () => new Date()
	 */
	now?: () => Date;
	/**
	 * Column name used for the update timestamp.
	 *
	 * @default 'updatedAt'
	 */
	updatedAt?: string;
};
