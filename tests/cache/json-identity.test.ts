import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';
import { cache } from '../../src/plugins/cache';
import { defaultSerializer } from '../../src/plugins/cache/shared/serializer';
import { createMemoryStore } from './memory-store';

const documents = sqliteTable('cache_json_documents', {
	id: integer('id').primaryKey(),
	payload: text('payload', { mode: 'json' }).$type<{
		a: number;
		b: number;
	}>(),
	nested: text('nested', { mode: 'json' }).$type<{
		outer: { a: number; b: number };
	}>(),
});

const createFixture = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE cache_json_documents (id INTEGER PRIMARY KEY, payload TEXT, nested TEXT);
		INSERT INTO cache_json_documents VALUES
			(1, '{"a":1,"b":2}', '{"outer":{"a":1,"b":2}}'),
			(2, '{"b":2,"a":1}', '{"outer":{"b":2,"a":1}}');
	`);
	const client = better(
		drizzle({ client: sqlite, relations: defineRelations({ documents }) }),
		{
			plugins: [
				cache({
					namespace: `json-audit-${crypto.randomUUID()}`,
					store: createMemoryStore().store,
					ttl: 60,
				}),
			],
		},
	);
	return { client, sqlite };
};

describe('cache JSON comparison identity', () => {
	test('whole-document equals preserves JSON object insertion order', async () => {
		const { client, sqlite } = createFixture();
		try {
			const firstWhere = { payload: { equals: { a: 1, b: 2 } } };
			const secondWhere = { payload: { equals: { b: 2, a: 1 } } };
			const first = await client.documents.findMany({
				cache: true,
				where: firstWhere,
			});
			const uncached = await client.documents.findMany({
				where: secondWhere,
			});
			const cached = await client.documents.findMany({
				cache: true,
				where: secondWhere,
			});
			expect(first.map((row) => row.id)).toEqual([1]);
			expect(uncached.map((row) => row.id)).toEqual([2]);
			expect(cached).toEqual(uncached);
		} finally {
			sqlite.close();
		}
	});

	test('direct nested JSON documents preserve nested insertion order', async () => {
		const { client, sqlite } = createFixture();
		try {
			const firstWhere = { nested: { outer: { a: 1, b: 2 } } };
			const secondWhere = { nested: { outer: { b: 2, a: 1 } } };
			const first = await client.documents.findMany({
				cache: true,
				where: firstWhere,
			});
			const uncached = await client.documents.findMany({
				where: secondWhere,
			});
			const cached = await client.documents.findMany({
				cache: true,
				where: secondWhere,
			});
			expect(first.map((row) => row.id)).toEqual([1]);
			expect(uncached.map((row) => row.id)).toEqual([2]);
			expect(cached).toEqual(uncached);
		} finally {
			sqlite.close();
		}
	});

	test('escaped serializer tag keys still revive tagged values', () => {
		const serialized = defaultSerializer.serialize({ date: new Date(123) });
		const escaped = serialized.replaceAll('$bd', '\\u0024bd');
		expect(defaultSerializer.deserialize(escaped)).toEqual({
			date: new Date(123),
		});
	});
});
