import {
	createTableRelationsHelpers,
	extractTablesRelationalConfig,
	isTable,
} from 'drizzle-orm';

import { createModelDelegate } from './shared/client';

export * from './shared/errors';

import type {
	AnySchema,
	BetterClientOptions,
	BetterDrizzleClient,
	BetterMeta,
	BetterTableKey,
	RuntimeContext,
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
	drizzle: unknown,
	options: BetterClientOptions<Schema, Meta>,
) => {
	const client = {} as Record<string, unknown>;

	const context = {
		db: drizzle as RuntimeContext<Schema, Meta>['db'],
		options,
		fullSchema: options.schema,
		relational: extractTablesRelationalConfig(
			options.schema,
			createTableRelationsHelpers,
		),
		repositories: {},
	} as RuntimeContext<Schema, Meta>;

	for (const [tableName, table] of Object.entries(options.schema)) {
		if (!isTable(table)) continue;

		const delegate = createModelDelegate(
			context,
			tableName as BetterTableKey<Schema>,
		);
		const dbName =
			context.relational.tables[tableName as BetterTableKey<Schema>]
				?.dbName ?? tableName;

		client[tableName] = delegate;
		context.repositories[tableName] = delegate;
		context.repositories[dbName] = delegate;
	}

	client.repository = (name: string) => {
		const repository = context.repositories[name];

		if (!repository) throw new Error(`Repository "${name}" not found.`);

		return repository;
	};

	return client as BetterDrizzleClient<Schema, Meta>;
};

export * from './types';
