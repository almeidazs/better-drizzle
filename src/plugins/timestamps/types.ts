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
export type TimestampsOptions<
	CreatedAt extends string = string,
	UpdatedAt extends string = string,
	Models extends Readonly<Record<string, TimestampModelOptions>> = Readonly<
		Record<string, TimestampModelOptions>
	>,
	Mode extends TimestampMode = TimestampMode,
> = {
	/**
	 * Column name used for the creation timestamp.
	 *
	 * @default 'createdAt'
	 */
	createdAt?: CreatedAt;
	/**
	 * Timestamp management strategy.
	 *
	 * @default 'app'
	 */
	mode?: Mode;
	/**
	 * Overrides keyed by table key. Unknown keys are ignored.
	 */
	models?: Models;
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
	updatedAt?: UpdatedAt;
};
