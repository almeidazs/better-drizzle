import { Validator } from 'ata-validator';
import type { AnyColumn } from 'drizzle-orm';

import { checkResidue, columnToSchema, type ResidueKind } from './column';

type RowError = {
	instancePath: string;
	keyword: string;
	message: string;
};

export type RowValidator = {
	/** The JSON Schema ata compiles. Columns with a residue appear as `{}`. */
	schema: {
		type: 'object';
		properties: Record<string, Record<string, unknown>>;
		required: string[];
	};
	/** Column name to the kind of check ata cannot express. */
	residues: Record<string, ResidueKind>;
	validate(row: unknown): { valid: boolean; errors?: RowError[] };
};

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
): RowValidator => {
	const properties: Record<string, Record<string, unknown>> = {};
	const required: string[] = [];
	const residues: Record<string, ResidueKind> = {};

	for (const [name, column] of Object.entries(columns)) {
		const { schema, residue, nullable } = columnToSchema(column);
		properties[name] = schema;
		if (!nullable) required.push(name);
		if (residue) residues[name] = residue;
	}

	const schema = { type: 'object' as const, properties, required };
	const engine = new Validator(schema);
	const residueEntries = Object.entries(residues);

	return {
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
				if (!checkResidue(kind, value)) {
					errors.push({
						instancePath: `/${name}`,
						keyword: 'type',
						message: `must be a ${kind === 'buffer' ? 'Buffer' : kind === 'date' ? 'valid Date' : 'BigInt'}`,
					});
				}
			}

			return errors.length ? { errors, valid: false } : { valid: true };
		},
	};
};
