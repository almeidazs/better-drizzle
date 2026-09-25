import { describe, expect, test } from 'bun:test';

import { Validator } from 'ata-validator';
import { getTableColumns } from 'drizzle-orm';
import {
	boolean,
	integer,
	pgTable,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core';
import {
	blob,
	integer as sqliteInt,
	sqliteTable,
} from 'drizzle-orm/sqlite-core';

import { createWhereSchema } from '../../src/plugins/ata/shared/where';

// The where clause is recursive in two places: a filter's `not` can be another
// filter, and AND/OR/NOT take the whole clause again. JSON Schema says that with
// $defs and $ref, which ata resolves locally, so the whole thing still compiles
// to one validator.

const users = pgTable('users', {
	id: integer('id').primaryKey(),
	name: varchar('name', { length: 80 }).notNull(),
	active: boolean('active').notNull(),
	created: timestamp('created').notNull(),
});

const schema = createWhereSchema(getTableColumns(users));
const v = new Validator(schema);
const ok = (where: unknown) => v.validate(where).valid;

describe('createWhereSchema', () => {
	test('it compiles', () => {
		expect(v.engine()).toBe('codegen');
	});

	test('a bare value is a where clause', () => {
		expect(ok({ id: 1 })).toBe(true);
		expect(ok({ name: 'ada' })).toBe(true);
		expect(ok({ active: true })).toBe(true);
	});

	test('a value of the wrong type is refused', () => {
		expect(ok({ id: 'one' })).toBe(false);
		expect(ok({ active: 'yes' })).toBe(false);
	});

	test('comparable columns take the comparison operators', () => {
		expect(ok({ id: { gt: 3 } })).toBe(true);
		expect(ok({ id: { gte: 3, lte: 9 } })).toBe(true);
		expect(ok({ id: { in: [1, 2, 3] } })).toBe(true);
		expect(ok({ id: { gt: 'three' } })).toBe(false);
		expect(ok({ id: { in: ['x'] } })).toBe(false);
	});

	test('string columns take the string operators', () => {
		expect(ok({ name: { contains: 'ad' } })).toBe(true);
		expect(ok({ name: { startsWith: 'a', mode: 'insensitive' } })).toBe(
			true,
		);
		expect(ok({ name: { mode: 'sideways' } })).toBe(false);
		expect(ok({ name: { gt: 'a' } })).toBe(false);
	});

	test('boolean columns take equals and not, and nothing else', () => {
		expect(ok({ active: { equals: true } })).toBe(true);
		expect(ok({ active: { not: false } })).toBe(true);
		expect(ok({ active: { contains: 'x' } })).toBe(false);
	});

	test('a filter nests in its own not', () => {
		expect(ok({ id: { not: { gt: 3 } } })).toBe(true);
		expect(ok({ id: { not: { not: { gt: 3 } } } })).toBe(true);
		expect(ok({ id: { not: { gt: 'three' } } })).toBe(false);
	});

	test('AND, OR and NOT take the whole clause again', () => {
		expect(ok({ AND: [{ id: 1 }, { name: { contains: 'a' } }] })).toBe(
			true,
		);
		expect(ok({ OR: [{ id: 1 }, { id: { gt: 9 } }] })).toBe(true);
		expect(ok({ NOT: { id: 1 } })).toBe(true);
		expect(ok({ NOT: [{ id: 1 }, { id: 2 }] })).toBe(true);
		expect(ok({ AND: [{ id: 'one' }] })).toBe(false);
		expect(ok({ AND: { id: 1 } })).toBe(false);
	});

	test('nesting goes as deep as it likes', () => {
		expect(
			ok({
				AND: [
					{ OR: [{ NOT: { AND: [{ id: { not: { in: [1] } } }] } }] },
				],
			}),
		).toBe(true);
	});

	test('a column that is not on the table is refused', () => {
		expect(ok({ nope: 1 })).toBe(false);
	});

	// A timestamp column has no schema of its own, so the clause must not
	// pretend to check its values. It still checks the operator shape: a Date has
	// no own keys, so a bare one satisfies the operator object, and a misspelled
	// operator does not.
	test('a residue column accepts its operators without claiming a value type', () => {
		expect(ok({ created: new Date() })).toBe(true);
		expect(ok({ created: { gt: new Date() } })).toBe(true);
		expect(ok({ created: { gt: 'anything' } })).toBe(true);
		expect(ok({ created: { nope: 1 } })).toBe(false);
	});

	// The one residue kind the clause cannot check, written down rather than left
	// to be discovered. A Buffer is an object whose own keys are indices, so it
	// matches neither the operator object nor "not an object"; refusing a real
	// Buffer would be worse than accepting a bad operator here.
	test('a buffer column is documented as unchecked', () => {
		const files = sqliteTable('files', {
			id: sqliteInt('id').primaryKey(),
			payload: blob('payload').notNull(),
		});
		const bv = new Validator(createWhereSchema(getTableColumns(files)));
		const okFile = (where: unknown) => bv.validate(where).valid;

		expect(okFile({ payload: new Uint8Array([1, 2]) })).toBe(true);
		expect(okFile({ payload: { equals: new Uint8Array([1]) } })).toBe(true);
		// the limitation: a misspelled operator is not caught on this one kind
		expect(okFile({ payload: { nope: 1 } })).toBe(true);
		// the column list is still enforced
		expect(okFile({ nope: 1 })).toBe(false);
	});

	test('an empty clause is a clause', () => {
		expect(ok({})).toBe(true);
	});
});
