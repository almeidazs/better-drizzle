import { Validator } from 'ata-validator';
import type { AnyColumn } from 'drizzle-orm';

import { checkResidue, columnToSchema, type ResidueKind } from './column';

type RowError = {
	instancePath: string;
	keyword: string;
	message: string;
};

/**
 * Which row a validator is for.
 *
 * `select` is a row as it comes back: every non-nullable column is present.
 * `create` is a row on the way in: a column the database fills in, a default or
 * a generated key, is optional even though it is not nullable. `update` is a
 * patch, so nothing is required.
 */
export type RowMode = 'create' | 'select' | 'update';

export type RowValidator = {
	/** The JSON Schema ata compiles. Columns with a residue appear as `{}`. */
	schema: {
		type: 'object';
		properties: Record<string, Record<string, unknown>>;
		required: string[];
	};
	/** Column name to the kind of check ata cannot express. */
	residues: Record<string, ResidueKind>;
	/** Of those, the columns whose residue applies to each array element. */
	residueArrays: Record<string, true>;
	validate(row: unknown): { valid: boolean; errors?: RowError[] };
};

/**
 * Whether a column has to be present.
 *
 * A generated column is never written, so it is not required on the way in and
 * is dropped from a create payload by the caller. A column with a default is
 * supplied by the database when it is left out, so requiring it here would
 * refuse a payload the database would have accepted.
 */
const isRequired = (
	column: AnyColumn,
	nullable: boolean,
	mode: RowMode,
): boolean => {
	if (mode === 'update') return false;
	if (nullable) return false;
	if (mode === 'select') return true;
	if (column.hasDefault) return false;
	return !isGenerated(column);
};

const kindName = (kind: ResidueKind): string =>
	kind === 'buffer' ? 'Buffer' : kind === 'date' ? 'valid Date' : 'BigInt';

const isGenerated = (column: AnyColumn): boolean =>
	Boolean(
		(column as { generated?: unknown }).generated ??
		(column as { generatedIdentity?: unknown }).generatedIdentity,
	);

/**
 * A validator for one table's rows.
 *
 * ata compiles the schema once and answers everything it can describe. The
 * columns it cannot describe, `Date`, `BigInt` and `Buffer` values, are checked
 * afterwards and only on a row ata has already accepted, so a malformed row
 * costs one compiled pass and nothing else. A row is valid when both agree.
 *
 * The order matters in both directions: ata first because it is the cheap and
 * complete half, and the residue only after, because running it on a row that is
 * already wrong would report a second problem the caller did not ask about.
 */
export const createRowValidator = (
	columns: Record<string, AnyColumn>,
	mode: RowMode = 'select',
): RowValidator => {
	const properties: Record<string, Record<string, unknown>> = {};
	const required: string[] = [];
	const residues: Record<string, ResidueKind> = {};
	const residueArrays: Record<string, true> = {};

	for (const [name, column] of Object.entries(columns)) {
		const { schema, residue, residueInArray, nullable } =
			columnToSchema(column);
		properties[name] = schema;
		if (isRequired(column, nullable, mode)) required.push(name);
		if (residue) residues[name] = residue;
		if (residue && residueInArray) residueArrays[name] = true;
	}

	const schema = { type: 'object' as const, properties, required };
	const engine = new Validator(schema);
	const residueEntries = Object.entries(residues);

	return {
		residueArrays,
		residues,
		schema,
		validate(row) {
			const result = engine.validate(row);
			if (!result.valid) {
				return {
					errors: result.errors.map((e) => ({
						instancePath: e.instancePath ?? '',
						keyword: e.keyword ?? 'validation',
						message: e.message ?? 'invalid',
					})),
					valid: false,
				};
			}

			if (residueEntries.length === 0) return { valid: true };

			const record = row as Record<string, unknown>;
			const errors: RowError[] = [];
			for (const [name, kind] of residueEntries) {
				const value = record[name];
				// A nullable column that is null, or an absent optional column, has
				// already been judged by the schema; the predicate speaks only about
				// a value that is present and not null.
				if (value === null || value === undefined) continue;

				// An array's residue belongs to its entries, not to the array. The
				// schema has already established that the value is an array, so what
				// is left is to judge each entry, and to name the one that failed.
				if (residueArrays[name]) {
					if (!Array.isArray(value)) continue;
					const bad = value.findIndex(
						(item) => !checkResidue(kind, item),
					);
					if (bad !== -1) {
						errors.push({
							instancePath: `/${name}/${bad}`,
							keyword: 'type',
							message: `must be a ${kindName(kind)}`,
						});
					}
					continue;
				}

				if (!checkResidue(kind, value)) {
					errors.push({
						instancePath: `/${name}`,
						keyword: 'type',
						message: `must be a ${kindName(kind)}`,
					});
				}
			}

			return errors.length ? { errors, valid: false } : { valid: true };
		},
	};
};
