import { createBetterClient } from './internal/runtime';

export * from './shared/errors';

import type {
	AnySchema,
	BetterClientOptions,
	BetterDrizzleClient,
	BetterMeta,
} from './types';

export const better = <Schema extends AnySchema, Meta = BetterMeta>(
	drizzle: Parameters<typeof createBetterClient<Schema, Meta>>[0],
	options: BetterClientOptions<Schema, Meta>,
) => {
	return createBetterClient(drizzle, options) as BetterDrizzleClient<
		Schema,
		Meta
	>;
};

export * from './types';
