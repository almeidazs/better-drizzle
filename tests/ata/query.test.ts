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
	createCursorSchema,
	createOrderBySchema,
	createQueryArgsSchema,
	createSelectSchema,
} from '../../src/plugins/ata/shared/query';

// The query arguments, as JSON Schema. Each one is a plain object shape, so the
// interesting cases are the ones where a typo has to be refused: a column that
// is not on the table, a sort order that is not asc or desc, a take that is not
// an integer.

const users = pgTable('users', {
	id: integer('id').primaryKey(),
	name: varchar('name', { length: 80 }).notNull(),
	active: boolean('active').notNull(),
	created: timestamp('created').notNull(),
});

const columns = getTableColumns(users);
const relations = ['posts', 'profile'];

const check = (schema: Record<string, unknown>) => {
	const v = new Validator(schema);
	return (data: unknown) => v.validate(data).valid;
};

describe('createOrderBySchema', () => {
	const ok = check(createOrderBySchema(columns));

	test('a single field map', () => {
		expect(ok({ name: 'asc' })).toBe(true);
		expect(ok({ created: 'desc' })).toBe(true);
	});

	test('several fields at once', () => {
		expect(ok({ active: 'asc', name: 'desc' })).toBe(true);
	});

	test('an array of field maps, for multi-column ordering', () => {
		expect(ok([{ active: 'asc' }, { name: 'desc' }])).toBe(true);
		expect(ok([])).toBe(true);
	});

	test('a direction that is not asc or desc is refused', () => {
		expect(ok({ name: 'sideways' })).toBe(false);
		expect(ok([{ name: 'ASC' }])).toBe(false);
	});

	test('a column that is not on the table is refused', () => {
		expect(ok({ nope: 'asc' })).toBe(false);
		expect(ok([{ nope: 'asc' }])).toBe(false);
	});
});

describe('createCursorSchema', () => {
	const ok = check(createCursorSchema(columns));

	test('any subset of the scalar columns', () => {
		expect(ok({ id: 1 })).toBe(true);
		expect(ok({ id: 1, name: 'ada' })).toBe(true);
		expect(ok({})).toBe(true);
	});

	test('a value of the wrong type is refused', () => {
		expect(ok({ id: 'one' })).toBe(false);
	});

	test('a residue column takes its value unchecked', () => {
		expect(ok({ created: new Date() })).toBe(true);
	});

	test('a column that is not on the table is refused', () => {
		expect(ok({ nope: 1 })).toBe(false);
	});
});

describe('createSelectSchema', () => {
	const ok = check(createSelectSchema(columns, relations));

	test('scalar columns take a boolean', () => {
		expect(ok({ id: true, name: false })).toBe(true);
	});

	test('a relation takes true or its own query arguments', () => {
		expect(ok({ posts: true })).toBe(true);
		expect(ok({ posts: { where: { published: true } } })).toBe(true);
	});

	test('a scalar column does not take a query argument object', () => {
		expect(ok({ id: { where: {} } })).toBe(false);
	});

	test('a key that is neither a column nor a relation is refused', () => {
		expect(ok({ nope: true })).toBe(false);
	});
});

describe('createQueryArgsSchema', () => {
	const ok = check(createQueryArgsSchema(columns, relations));

	test('an empty argument object', () => {
		expect(ok({})).toBe(true);
	});

	test('the arguments together', () => {
		expect(
			ok({
				where: { active: true },
				select: { id: true },
				orderBy: { name: 'asc' },
				take: 10,
				skip: 0,
			}),
		).toBe(true);
	});

	test('take and skip are integers', () => {
		expect(ok({ take: 10 })).toBe(true);
		// a negative take reverses the ordering, so it is allowed
		expect(ok({ take: -10 })).toBe(true);
		expect(ok({ take: 1.5 })).toBe(false);
		expect(ok({ take: '10' })).toBe(false);
		expect(ok({ skip: -1 })).toBe(false);
	});

	test('cursor and include are checked', () => {
		expect(ok({ cursor: { id: 1 } })).toBe(true);
		expect(ok({ cursor: { nope: 1 } })).toBe(false);
		expect(ok({ include: { posts: true } })).toBe(true);
		expect(ok({ include: { _count: { select: { posts: true } } } })).toBe(
			true,
		);
	});

	test('meta is free-form, because it is the caller"s own', () => {
		expect(ok({ meta: { userId: 1, trace: 'abc' } })).toBe(true);
	});

	test('a misspelled argument is refused', () => {
		expect(ok({ wher: { active: true } })).toBe(false);
		expect(ok({ orderby: { name: 'asc' } })).toBe(false);
	});

	test('the where clause inside the arguments is the real one', () => {
		expect(ok({ where: { id: { gt: 3 } } })).toBe(true);
		expect(ok({ where: { id: { gt: 'three' } } })).toBe(false);
		expect(ok({ where: { nope: 1 } })).toBe(false);
	});
});
