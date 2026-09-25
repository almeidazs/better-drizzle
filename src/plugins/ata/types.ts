import type { AnySchema, TableKey } from 'better-drizzle';

import type { ResidueKind } from './shared/column';

/**
 * The plugin's public types.
 *
 * Deliberately smaller than the zod plugin's. Most of that file tracks an input
 * type separately from an output type, because `z.coerce` accepts one thing and
 * produces another. ata validates and does not transform, so a value that passes
 * is the value you handed in, and one type describes both ends.
 */

/** A JSON Schema, as this plugin builds them. */
export type JsonSchema = Record<string, unknown>;

/** Every operation whose validation can be turned on or off. */
export type AtaValidateKey =
	| 'count'
	| 'create'
	| 'createMany'
	| 'cursor'
	| 'delete'
	| 'deleteMany'
	| 'exists'
	| 'findFirst'
	| 'findMany'
	| 'findOne'
	| 'findUnique'
	| 'paginate'
	| 'query'
	| 'result'
	| 'update'
	| 'updateEach'
	| 'updateMany'
	| 'upsert'
	| 'upsertMany';

/**
 * Which operations to validate. Anything left out keeps its default: payloads
 * and results are checked, reads are not.
 */
export type AtaPluginValidateOptions = Partial<Record<AtaValidateKey, boolean>>;

/**
 * Per-table overrides.
 *
 * `columns` replaces what this plugin derived for one column. A JSON Schema of
 * your own goes in as-is; `false` drops the column from the generated schemas,
 * which is how you stop claiming anything about a type the classifier got wrong.
 */
export type AtaPluginTableConfig = {
	columns?: Record<string, false | JsonSchema>;
};

export type AtaPluginOptions<Schema extends AnySchema = AnySchema> = {
	/**
	 * Build the standalone modules ahead of time instead of compiling on first
	 * use. Off by default, because it only pays for itself when the schema is
	 * large and the process is short-lived.
	 */
	precompile?: boolean;
	tables?: Partial<Record<TableKey<Schema> & string, AtaPluginTableConfig>>;
	validate?: AtaPluginValidateOptions;
};

/** A compiled validator, as the registry hands it out. */
export type AtaCompiledSchema = {
	/** The JSON Schema itself, which is a plain object you can print or ship. */
	schema: JsonSchema;
	validate(value: unknown): {
		errors?: readonly { message?: string; path?: string }[];
		valid: boolean;
	};
};

/**
 * The schemas a model carries, reachable as `db.user.$ata`.
 *
 * Every one of these is a plain JSON Schema object as well as a compiled
 * validator, so the same value can be handed to an HTTP layer, written to a
 * file, or used to generate types, which is most of the reason to describe a
 * table in JSON Schema rather than in a validator's own vocabulary.
 */
export type BetterDrizzleAtaModelSchemas = {
	count: AtaCompiledSchema;
	create: AtaCompiledSchema;
	cursor: AtaCompiledSchema;
	delete: AtaCompiledSchema;
	deleteMany: AtaCompiledSchema;
	orderBy: AtaCompiledSchema;
	pagination: AtaCompiledSchema;
	query: AtaCompiledSchema;
	/** A row as it comes back from the database. This is what a result is. */
	row: AtaCompiledSchema;
	/** The `select` projection: which columns and relations to return. */
	select: AtaCompiledSchema;
	update: AtaCompiledSchema;
	where: AtaCompiledSchema;
	/** Column name to the check JSON Schema cannot express. */
	residues: Record<string, ResidueKind>;
};

export type BetterDrizzleAtaModelExtension = {
	$ata: BetterDrizzleAtaModelSchemas;
};

export type { ResidueKind };
