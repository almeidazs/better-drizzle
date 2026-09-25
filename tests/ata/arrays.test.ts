import { describe, expect, test } from 'bun:test';

import { Validator } from 'ata-validator';
import { getTableColumns } from 'drizzle-orm';
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { columnToSchema } from '../../src/plugins/ata/shared/column';
import { createRowValidator } from '../../src/plugins/ata/shared/row';
import { createWhereSchema } from '../../src/plugins/ata/shared/where';

// An array column, and the filters the core compiles for one. The element type is
// a column in its own right on the drizzle side, so the schema for `text[]` is
// the schema for `text` wrapped in an array, and a residue element makes the
// whole array a residue.

const posts = pgTable('posts', {
	id: integer('id').primaryKey(),
	tags: text('tags').array().notNull(),
	scores: integer('scores').array(),
	seen: timestamp('seen').array(),
});

const columns = getTableColumns(posts);

describe('columnToSchema on array columns', () => {
	test('an array of text is an array of strings', () => {
		expect(columnToSchema(columns.tags).schema).toEqual({
			type: 'array',
			items: { type: 'string' },
		});
	});

	test('an array of integers keeps the element type', () => {
		const { schema } = columnToSchema(columns.scores);
		// nullable, so the array itself may be null
		expect(schema).toEqual({
			type: ['array', 'null'],
			items: { type: 'integer' },
		});
	});

	test('an array whose element ata cannot describe is a residue', () => {
		const { schema, residue } = columnToSchema(columns.seen);
		expect(residue).toBe('date');
		// nothing is claimed about the values, but it is still an array
		expect(schema).toEqual({ type: ['array', 'null'], items: {} });
	});
});

describe('the where clause for an array column', () => {
	const v = new Validator(createWhereSchema(columns));
	const ok = (where: unknown) => v.validate(where).valid;

	test('it compiles', () => {
		expect(v.engine()).toBe('codegen');
	});

	test('a bare array is a clause', () => {
		expect(ok({ tags: ['a', 'b'] })).toBe(true);
		expect(ok({ tags: [1] })).toBe(false);
	});

	test('membership operators take an element or a list of them', () => {
		expect(ok({ tags: { has: 'a' } })).toBe(true);
		expect(ok({ tags: { hasEvery: ['a', 'b'] } })).toBe(true);
		expect(ok({ tags: { hasSome: ['a'] } })).toBe(true);
		expect(ok({ tags: { hasNone: ['a'] } })).toBe(true);
		expect(ok({ tags: { containedBy: ['a', 'b'] } })).toBe(true);
		// an element of the wrong type is refused in both spellings
		expect(ok({ tags: { has: 1 } })).toBe(false);
		expect(ok({ tags: { hasEvery: [1] } })).toBe(false);
		// and a list where an element belongs, or the reverse
		expect(ok({ tags: { has: ['a'] } })).toBe(false);
		expect(ok({ tags: { hasEvery: 'a' } })).toBe(false);
	});

	test('isEmpty and length', () => {
		expect(ok({ tags: { isEmpty: true } })).toBe(true);
		expect(ok({ tags: { isEmpty: 'yes' } })).toBe(false);
		expect(ok({ tags: { length: 3 } })).toBe(true);
		expect(ok({ tags: { length: { gte: 1, lt: 9 } } })).toBe(true);
		expect(ok({ tags: { length: { gte: 'one' } } })).toBe(false);
	});

	test('equals takes the whole array, not an element', () => {
		expect(ok({ tags: { equals: ['a'] } })).toBe(true);
		expect(ok({ tags: { equals: 'a' } })).toBe(false);
	});

	test('not takes an array or another array filter', () => {
		expect(ok({ tags: { not: ['a'] } })).toBe(true);
		expect(ok({ tags: { not: { has: 'a' } } })).toBe(true);
		expect(ok({ tags: { not: { not: { has: 'a' } } } })).toBe(true);
		expect(ok({ tags: { not: { has: 1 } } })).toBe(false);
	});

	test('some, none and every take a filter on the element', () => {
		expect(ok({ tags: { some: { contains: 'a' } } })).toBe(true);
		expect(ok({ tags: { none: { equals: 'a' } } })).toBe(true);
		expect(ok({ tags: { every: { startsWith: 'a' } } })).toBe(true);
		// the element is a string, so a numeric comparison is not one of its filters
		expect(ok({ tags: { some: { gt: 1 } } })).toBe(false);
		expect(ok({ tags: { some: { nope: 'a' } } })).toBe(false);
	});

	// The core refuses an element predicate that constrains nothing, since an
	// empty one silently matches every row.
	test('an element predicate has to say something', () => {
		expect(ok({ tags: { some: {} } })).toBe(false);
		expect(ok({ tags: { some: { mode: 'insensitive' } } })).toBe(false);
		expect(
			ok({ tags: { some: { mode: 'insensitive', contains: 'a' } } }),
		).toBe(true);
	});

	test('an integer array takes the comparisons on its elements', () => {
		expect(ok({ scores: { some: { gt: 3 } } })).toBe(true);
		expect(ok({ scores: { has: 3 } })).toBe(true);
		expect(ok({ scores: { has: 'three' } })).toBe(false);
	});

	test('a misspelled array operator is refused', () => {
		expect(ok({ tags: { hasAll: ['a'] } })).toBe(false);
		expect(ok({ tags: { contains: 'a' } })).toBe(false);
	});

	test('a residue array still checks the operator shape', () => {
		expect(ok({ seen: { isEmpty: true } })).toBe(true);
		expect(ok({ seen: { has: new Date() } })).toBe(true);
		expect(ok({ seen: { nope: 1 } })).toBe(false);
	});
});

// The row validator, which is where the residue actually runs. The where-clause
// tests above pass without this wiring, so they did not catch its absence.
describe('the row validator on array columns', () => {
	const validator = createRowValidator(columns, 'select');

	const row = (over: Record<string, unknown> = {}) => ({
		id: 1,
		tags: ['a'],
		scores: null,
		seen: null,
		...over,
	});

	test('it names the array columns whose residue is per element', () => {
		expect(validator.residues).toEqual({ seen: 'date' });
		expect(validator.residueArrays).toEqual({ seen: true });
	});

	test('an array of Dates passes', () => {
		expect(
			validator.validate(row({ seen: [new Date(), new Date()] })).valid,
		).toBe(true);
		expect(validator.validate(row({ seen: [] })).valid).toBe(true);
	});

	test('one bad entry is refused, and the error names its index', () => {
		const r = validator.validate(row({ seen: [new Date(), 'nope'] }));
		expect(r.valid).toBe(false);
		expect(r.errors?.[0]?.instancePath).toBe('/seen/1');
	});

	test('an invalid Date inside the array is refused too', () => {
		expect(
			validator.validate(row({ seen: [new Date('nope')] })).valid,
		).toBe(false);
	});

	test("the element types of a describable array are ata's job", () => {
		expect(validator.validate(row({ tags: ['a', 'b'] })).valid).toBe(true);
		expect(validator.validate(row({ tags: ['a', 2] })).valid).toBe(false);
		expect(validator.validate(row({ tags: 'a' })).valid).toBe(false);
	});
});
