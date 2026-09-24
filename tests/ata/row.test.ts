import { describe, expect, test } from 'bun:test';

import { getTableColumns } from 'drizzle-orm';
import {
	bigint,
	boolean,
	integer,
	pgTable,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core';

import { createRowValidator } from '../../src/plugins/ata/shared/row';

// The whole design in one place: ata compiles the part of a table row it can
// describe, and the columns it cannot describe are checked by a predicate that
// only runs on rows ata has already accepted. A row is valid when both agree.

const users = pgTable('users', {
	id: integer('id').primaryKey(),
	name: varchar('name', { length: 80 }).notNull(),
	age: integer('age'),
	active: boolean('active').notNull(),
	created: timestamp('created').notNull(),
	views: bigint('views', { mode: 'bigint' }).notNull(),
});

const columns = getTableColumns(users);
const validator = createRowValidator(columns);

const row = () => ({
	id: 1,
	name: 'ada',
	age: 36,
	active: true,
	created: new Date('2026-01-01T00:00:00Z'),
	views: 10n,
});

describe('createRowValidator', () => {
	test('a well-formed row passes', () => {
		expect(validator.validate(row())).toEqual({ valid: true });
	});

	test('the schema carries what ata can describe, and nothing it cannot', () => {
		expect(validator.schema.properties.id).toEqual({ type: 'integer' });
		expect(validator.schema.properties.name).toEqual({
			type: 'string',
			maxLength: 80,
		});
		expect(validator.schema.properties.age).toEqual({
			type: ['integer', 'null'],
		});
		expect(validator.schema.properties.created).toEqual({});
		expect(validator.schema.properties.views).toEqual({});
		expect(validator.residues).toEqual({
			created: 'date',
			views: 'bigint',
		});
	});

	test('ata catches a structural error and names the column', () => {
		const bad = { ...row(), id: 'one' };
		const r = validator.validate(bad);
		expect(r.valid).toBe(false);
		expect(r.errors?.[0]?.instancePath).toBe('/id');
	});

	test('a required column that is missing is caught', () => {
		const bad = row();
		delete (bad as Record<string, unknown>).name;
		expect(validator.validate(bad).valid).toBe(false);
	});

	test('null is accepted where the column allows it and refused where it does not', () => {
		expect(validator.validate({ ...row(), age: null }).valid).toBe(true);
		expect(validator.validate({ ...row(), name: null }).valid).toBe(false);
	});

	// The residue: ata has nothing to say about these, so the predicate does.
	test('a timestamp column refuses a value that is not a Date', () => {
		const r = validator.validate({ ...row(), created: '2026-01-01' });
		expect(r.valid).toBe(false);
		expect(r.errors?.[0]?.instancePath).toBe('/created');
		expect(r.errors?.[0]?.keyword).toBe('type');
	});

	test('and refuses an invalid Date', () => {
		expect(
			validator.validate({ ...row(), created: new Date('nope') }).valid,
		).toBe(false);
	});

	test('a bigint column refuses a number', () => {
		const r = validator.validate({ ...row(), views: 10 });
		expect(r.valid).toBe(false);
		expect(r.errors?.[0]?.instancePath).toBe('/views');
	});

	test('a structural error is reported without running the residue', () => {
		// `created` is also wrong here; ata rejects first and that is the answer,
		// which is what keeps the fast path fast.
		const r = validator.validate({ ...row(), id: 'one', created: 'nope' });
		expect(r.valid).toBe(false);
		expect(r.errors?.every((e) => e.instancePath !== '/created')).toBe(
			true,
		);
	});
});
