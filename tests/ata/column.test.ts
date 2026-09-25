import { describe, expect, test } from 'bun:test';

import { getTableColumns } from 'drizzle-orm';
import {
	bigint,
	boolean,
	jsonb,
	numeric,
	pgTable,
	timestamp,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core';
import { integer, sqliteTable, text, blob } from 'drizzle-orm/sqlite-core';

import { columnToSchema } from '../../src/plugins/ata/shared/column';

// A drizzle column becomes a JSON Schema for ata to compile, plus a residue
// kind for what JSON Schema cannot say. `date`, `bigint` and `buffer` are JS
// runtime types, not JSON shapes, so ata checks everything it can express and a
// small predicate checks the rest. That is the same split `@ata-project/zod`
// makes for `z.date()` and friends: ata rejecting is final and fast, ata
// accepting hands the value on.

const pg = pgTable('t', {
	id: integer('id').primaryKey(),
	name: varchar('name', { length: 80 }).notNull(),
	email: text('email').notNull(),
	uid: uuid('uid').notNull(),
	price: numeric('price').notNull(),
	big: bigint('big', { mode: 'bigint' }).notNull(),
	flag: boolean('flag').notNull(),
	created: timestamp('created').notNull(),
	meta: jsonb('meta').notNull(),
});

const lite = sqliteTable('l', {
	id: integer('id').primaryKey(),
	title: text('title').notNull(),
	active: integer('active', { mode: 'boolean' }).notNull(),
	payload: blob('payload').notNull(),
});

const pgCols = getTableColumns(pg);
const liteCols = getTableColumns(lite);

describe('columnToSchema', () => {
	test('integers and numbers carry their JSON Schema type', () => {
		expect(columnToSchema(pgCols.id).schema).toEqual({ type: 'integer' });
		expect(columnToSchema(pgCols.id).residue).toBeUndefined();
	});

	test('a length-limited varchar keeps its maximum', () => {
		expect(columnToSchema(pgCols.name).schema).toEqual({
			type: 'string',
			maxLength: 80,
		});
	});

	test('text is a plain string', () => {
		expect(columnToSchema(pgCols.email).schema).toEqual({ type: 'string' });
	});

	test('uuid becomes a string with the format', () => {
		expect(columnToSchema(pgCols.uid).schema).toEqual({
			type: 'string',
			format: 'uuid',
		});
	});

	test('numeric is a string, the way the zod plugin has it', () => {
		expect(columnToSchema(pgCols.price).schema).toEqual({ type: 'string' });
	});

	test('boolean', () => {
		expect(columnToSchema(pgCols.flag).schema).toEqual({ type: 'boolean' });
		expect(columnToSchema(liteCols.active).schema).toEqual({
			type: 'boolean',
		});
	});

	test('json is unconstrained, as it is in the zod plugin', () => {
		expect(columnToSchema(pgCols.meta).schema).toEqual({});
	});

	// The three JSON Schema cannot express.
	test('a timestamp asks ata for nothing and names a date residue', () => {
		const { schema, residue } = columnToSchema(pgCols.created);
		expect(schema).toEqual({});
		expect(residue).toBe('date');
	});

	test('a bigint column names a bigint residue', () => {
		const { schema, residue } = columnToSchema(pgCols.big);
		expect(schema).toEqual({});
		expect(residue).toBe('bigint');
	});

	test('a blob column names a buffer residue', () => {
		const { schema, residue } = columnToSchema(liteCols.payload);
		expect(schema).toEqual({});
		expect(residue).toBe('buffer');
	});

	test('a nullable column is nullable in the schema, residue unchanged', () => {
		const nullablePg = pgTable('n', {
			when: timestamp('when'),
			count: integer('count'),
		});
		const cols = getTableColumns(nullablePg);
		expect(columnToSchema(cols.count).schema).toEqual({
			type: ['integer', 'null'],
		});
		const when = columnToSchema(cols.when);
		expect(when.schema).toEqual({});
		expect(when.residue).toBe('date');
		expect(when.nullable).toBe(true);
	});
});
