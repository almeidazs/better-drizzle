import { createBetterClient } from './internal/runtime';

export * from './shared/errors';

import type {
	AnySchema,
	BetterClientOptions,
	BetterDrizzleClient,
	BetterMeta,
} from './types';

/**
 * Creates a Better Drizzle client that wraps an existing Drizzle ORM database
 * instance with enhanced type-safe querying capabilities, lifecycle hooks,
 * and a repository-based access pattern.
 *
 * @typeParam Schema - The Drizzle schema type representing all tables and their
 *   relations.
 * @typeParam Meta - Custom metadata type attached to operations. Defaults to
 *   {@link BetterMeta}.
 * @param drizzle - The Drizzle database instance to wrap.
 * @param options - Configuration including the schema reference, plugins, and
 *   lifecycle hooks.
 * @returns A fully typed {@link BetterDrizzleClient} with delegates for every
 *   table and a unified `repository()` accessor.
 *
 * @example
 * ```ts
 * import { better } from 'better-drizzle';
 * import { db } from './drizzle';
 * import { schema } from './schema';
 *
 * const client = better(db, { schema });
 *
 * const users = await client.user.findMany({ where: { active: true } });
 * ```
 */
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
