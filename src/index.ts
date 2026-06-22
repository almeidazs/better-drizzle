import { createBetterClient } from './internal/runtime';

export * from './shared/errors';

import type {
	AnySchema,
	BetterClientOptions,
	BetterDrizzleClient,
} from './types';

export const better = <Schema extends AnySchema>(
	drizzle: Parameters<typeof createBetterClient<Schema>>[0],
	options: BetterClientOptions<Schema>,
) => {
	return createBetterClient(drizzle, options) as BetterDrizzleClient<Schema>;
};

export * from './types';
