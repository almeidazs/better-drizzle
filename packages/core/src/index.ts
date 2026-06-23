import { isTable } from 'drizzle-orm';

import {
	applyClientExtensions,
	applyModelExtensions,
	createModelDelegate,
	createRuntimeContext,
	initializePlugins,
} from './shared/client';

export * from './shared/errors';

import type {
	AnyPlugin,
	AnySchema,
	BetterClientOptions,
	BetterDrizzleClient,
	BetterMeta,
	BetterTableKey,
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
export const better = <
	Schema extends AnySchema,
	Meta = BetterMeta,
	const Plugins extends readonly AnyPlugin[] = [],
>(
	drizzle: unknown,
	options: BetterClientOptions<Schema, Meta, Plugins>,
) => {
	const client = Object.create(null) as Record<string, unknown>;
	const context = createRuntimeContext(drizzle, options);

	initializePlugins(context);

	for (const [tableName, table] of Object.entries(options.schema)) {
		if (!isTable(table)) continue;

		const delegate = applyModelExtensions(
			context,
			tableName as BetterTableKey<Schema>,
			createModelDelegate(context, tableName as BetterTableKey<Schema>),
		);

		const dbName = context.tables[tableName]?.dbName ?? tableName;

		client[tableName] = delegate;
		context.repositories[tableName] = delegate;
		context.repositories[dbName] = delegate;
	}

	client.repository = (name: string) => {
		const repository = context.repositories[name];

		if (!repository) throw new Error(`Repository "${name}" not found.`);

		return repository;
	};

	applyClientExtensions(
		context,
		client as BetterDrizzleClient<Schema, Meta, Plugins>,
	);

	return client as BetterDrizzleClient<Schema, Meta, Plugins>;
};

export * from './types';
