import { Validator } from 'ata-validator';
import {
	createTableRelationsHelpers,
	extractTablesRelationalConfig,
	type AnyColumn,
	getTableColumns,
	is,
	Table,
} from 'drizzle-orm';

import type {
	AtaCompiledSchema,
	AtaPluginOptions,
	BetterDrizzleAtaModelSchemas,
	JsonSchema,
} from '../types';
import { checkResidue, type ResidueKind } from './column';
import {
	createCountArgsSchema,
	createCursorArgsSchema,
	createDeleteArgsSchema,
	createOrderBySchema,
	createPaginationArgsSchema,
	createQueryArgsSchema,
	createSelectSchema,
} from './query';
import { createRowValidator } from './row';
import { createWhereSchema } from './where';

/**
 * The compiled schemas for every table, built once.
 *
 * Each table's schemas are compiled the first time something asks for them
 * rather than at setup. A process that only ever writes to one table should not
 * pay to compile the query arguments of forty others, and compiling every shape
 * of every table eagerly is the one thing that would make this plugin slower to
 * start than the validator it replaces.
 */

export type TableEntry = {
	columns: Record<string, AnyColumn>;
	residueArrays: Record<string, true>;
	relations: readonly string[];
	schemas: BetterDrizzleAtaModelSchemas;
	tableName: string;
};

export type AtaSchemasRegistry = {
	get(tableName: string): TableEntry | undefined;
	getCountArgs(tableName: string): AtaCompiledSchema;
	getCreate(tableName: string): AtaCompiledSchema;
	getCursorArgs(tableName: string): AtaCompiledSchema;
	getDeleteArgs(tableName: string, many: boolean): AtaCompiledSchema;
	getPaginationArgs(tableName: string): AtaCompiledSchema;
	getQueryArgs(tableName: string): AtaCompiledSchema;
	getResult(
		tableName: string,
		many: boolean,
		args?: unknown,
	): AtaCompiledSchema;
	getUpdate(tableName: string): AtaCompiledSchema;
	tables(): readonly string[];
};

type CompiledSchema = AtaCompiledSchema & { warm(): void };

/** Wrap a JSON Schema in the validator, compiled the first time it is used. */
const compiled = (
	schema: JsonSchema,
	residues?: Record<string, ResidueKind>,
	residueArrays?: Record<string, true>,
): CompiledSchema => {
	let validator: Validator | null = null;
	const residueEntries = residues ? Object.entries(residues) : [];
	const get = () => (validator ??= new Validator(schema));
	return {
		schema,
		validate(value) {
			const result = get().validate(value);
			if (
				!result.valid ||
				residueEntries.length === 0 ||
				!value ||
				typeof value !== 'object'
			)
				return result;

			const rows = Array.isArray(value) ? value : [value];
			for (const row of rows) {
				if (!row || typeof row !== 'object') continue;
				for (const [name, kind] of residueEntries) {
					const entry = (row as Record<string, unknown>)[name];
					if (entry === null || entry === undefined) continue;
					if (residueArrays?.[name]) {
						if (!Array.isArray(entry))
							return {
								errors: [
									{
										instancePath: `/${name}`,
										message: `must be a ${kind === 'date' ? 'valid Date' : kind === 'buffer' ? 'Buffer' : 'BigInt'}`,
									},
								],
								valid: false,
							};
						for (const item of entry)
							if (!checkResidue(kind, item))
								return {
									errors: [
										{
											instancePath: `/${name}`,
											message: `must be a ${kind === 'date' ? 'valid Date' : kind === 'buffer' ? 'Buffer' : 'BigInt'}`,
										},
									],
									valid: false,
								};
					} else if (!checkResidue(kind, entry))
						return {
							errors: [
								{
									instancePath: `/${name}`,
									message: `must be a ${kind === 'date' ? 'valid Date' : kind === 'buffer' ? 'Buffer' : 'BigInt'}`,
								},
							],
							valid: false,
						};
				}
			}
			return result;
		},
		warm: () => {
			get();
		},
	};
};

/**
 * Apply the table's column overrides.
 *
 * `false` drops the column, which is how a caller stops this plugin claiming
 * something about a type the classifier read wrongly. Anything else replaces the
 * derived schema outright rather than merging into it, because a partial merge
 * of two JSON Schemas is ambiguous and quietly doing the wrong half of it is
 * worse than asking for the whole thing.
 */
const applyOverrides = (
	properties: Record<string, JsonSchema>,
	required: string[],
	overrides: Record<string, false | JsonSchema> | undefined,
): { properties: Record<string, JsonSchema>; required: string[] } => {
	if (!overrides) return { properties, required };

	const out: Record<string, JsonSchema> = {};
	for (const [name, schema] of Object.entries(properties)) {
		const override = overrides[name];
		if (override === false) continue;
		out[name] = override ?? schema;
	}

	return {
		properties: out,
		required: required.filter((name) => overrides[name] !== false),
	};
};

const rowSchema = (
	columns: Record<string, AnyColumn>,
	mode: 'create' | 'select' | 'update',
	overrides: Record<string, false | JsonSchema> | undefined,
): {
	residueArrays: Record<string, true>;
	residues: Record<string, ResidueKind>;
	schema: JsonSchema;
} => {
	const built = createRowValidator(columns, mode);
	const { properties, required } = applyOverrides(
		built.schema.properties,
		built.schema.required,
		overrides,
	);

	return {
		residueArrays: built.residueArrays,
		residues: built.residues,
		schema: {
			additionalProperties: false,
			properties,
			required,
			type: 'object',
		},
	};
};

/**
 * Relation names for a table.
 *
 * Read from the schema's relation config when one is present. A table with no
 * declared relations contributes none, and a projection then accepts only its
 * own columns, which is the honest answer rather than accepting any key.
 */
export const createAtaSchemasRegistry = <
	Schema extends Record<string, unknown>,
>(
	schema: Schema,
	options: AtaPluginOptions = {},
): AtaSchemasRegistry => {
	const entries = new Map<string, TableEntry>();
	const tableNames: string[] = [];
	const relational = extractTablesRelationalConfig(
		schema as never,
		createTableRelationsHelpers,
	) as { tables: Record<string, { relations: Record<string, unknown> }> };

	for (const [key, value] of Object.entries(schema)) {
		if (!is(value, Table)) continue;
		tableNames.push(key);
	}

	const build = (tableName: string): TableEntry | undefined => {
		const table = (schema as Record<string, unknown>)[tableName];
		if (!is(table, Table)) return undefined;

		const columns = getTableColumns(table) as Record<string, AnyColumn>;
		const relations = Object.keys(
			relational.tables[tableName]?.relations ?? {},
		);
		const overrides = (
			options.tables as
				| Record<
						string,
						{ columns?: Record<string, false | JsonSchema> }
				  >
				| undefined
		)?.[tableName]?.columns;

		const selectRow = rowSchema(columns, 'select', overrides);
		const create = rowSchema(columns, 'create', overrides);
		const update = rowSchema(columns, 'update', overrides);

		const entry: TableEntry = {
			columns,
			residueArrays: selectRow.residueArrays,
			relations,
			schemas: {
				count: compiled(createCountArgsSchema(columns, relations)),
				create: compiled(
					create.schema,
					create.residues,
					create.residueArrays,
				),
				cursor: compiled(createCursorArgsSchema(columns, relations)),
				delete: compiled(
					createDeleteArgsSchema(columns, relations, true),
				),
				deleteMany: compiled(
					createDeleteArgsSchema(columns, relations, false),
				),
				orderBy: compiled(createOrderBySchema(columns)),
				pagination: compiled(
					createPaginationArgsSchema(columns, relations),
				),
				query: compiled(createQueryArgsSchema(columns, relations)),
				residues: selectRow.residues,
				row: compiled(
					selectRow.schema,
					selectRow.residues,
					selectRow.residueArrays,
				),
				select: compiled(createSelectSchema(columns, relations)),
				update: compiled(
					update.schema,
					update.residues,
					update.residueArrays,
				),
				where: compiled(createWhereSchema(columns, relations)),
			},
			tableName,
		};

		// Compiling is what `precompile` asks for, so compile; do not validate a
		// stand-in value to get there, which would run the schema against
		// something no caller ever passed. `residues` is a plain record and is
		// the one entry here that is not a compiled schema.
		if (options.precompile)
			for (const [key, value] of Object.entries(entry.schemas))
				if (key !== 'residues') (value as CompiledSchema).warm();

		return entry;
	};

	const get = (tableName: string): TableEntry | undefined => {
		const known = entries.get(tableName);
		if (known) return known;
		const built = build(tableName);
		if (built) entries.set(tableName, built);
		return built;
	};

	/**
	 * A result is a row, a nullable row, or an array of them. It is built from
	 * the row shape, and only when something asks for it.
	 */
	const results = new Map<string, AtaCompiledSchema>();
	const getResult = (
		tableName: string,
		many: boolean,
		args?: unknown,
	): AtaCompiledSchema => {
		const input =
			args && typeof args === 'object'
				? (args as Record<string, unknown>)
				: undefined;
		const projection = input?.select ?? input?.include;
		const projectionKeys =
			projection && typeof projection === 'object'
				? Object.keys(projection as Record<string, unknown>).filter(
						(key) =>
							key === '_count' ||
							!(key in (get(tableName)?.columns ?? {})),
					)
				: [];
		const key = `${tableName}:${many ? 'many' : 'one'}:${projectionKeys.join(',')}`;
		const known = results.get(key);
		if (known) return known;

		const entry = get(tableName);
		const row = entry?.schemas.row.schema ?? {};
		// A projection narrows the row, so a result is checked for the columns it
		// does carry rather than for the ones it was not asked for.
		const relaxed = {
			...row,
			properties: {
				...((row.properties as
					| Record<string, JsonSchema>
					| undefined) ?? {}),
				...Object.fromEntries(projectionKeys.map((name) => [name, {}])),
			},
			required: [] as string[],
		};
		const built = compiled(
			many
				? { items: relaxed, type: 'array' }
				: { anyOf: [relaxed, { type: 'null' }] },
			entry?.schemas.residues,
			entry?.residueArrays,
		);
		results.set(key, built);
		return built;
	};

	const argsOf = (
		tableName: string,
		pick: (entry: TableEntry) => AtaCompiledSchema,
	): AtaCompiledSchema => {
		const entry = get(tableName);
		// A table this plugin does not know is not a table this plugin should
		// refuse rows for; an empty schema accepts, and the core reports the
		// unknown table itself.
		return entry ? pick(entry) : compiled({});
	};

	return {
		get,
		getCountArgs: (t) => argsOf(t, (e) => e.schemas.count),
		getCreate: (t) => argsOf(t, (e) => e.schemas.create),
		getCursorArgs: (t) => argsOf(t, (e) => e.schemas.cursor),
		getDeleteArgs: (t, many) =>
			argsOf(t, (e) => (many ? e.schemas.deleteMany : e.schemas.delete)),
		getPaginationArgs: (t) => argsOf(t, (e) => e.schemas.pagination),
		getQueryArgs: (t) => argsOf(t, (e) => e.schemas.query),
		getResult,
		getUpdate: (t) => argsOf(t, (e) => e.schemas.update),
		tables: () => tableNames,
	};
};
