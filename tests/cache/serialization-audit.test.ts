import { describe, expect, test } from 'bun:test';

import { BetterDrizzleErrorCode } from '../../src';
import { defaultSerializer } from '../../src/plugins/cache/shared/serializer';
import { createMemoryStore } from './memory-store';
import { createClient } from './suite';

describe('cache serialization audit', () => {
	test('preserves object orderBy priority in automatic cache identity', async () => {
		const { client } = createClient(createMemoryStore().store);
		const first = await client.users.findMany({
			cache: true,
			orderBy: { id: 'asc', name: 'desc' },
		});
		const second = await client.users.findMany({
			cache: true,
			orderBy: { name: 'desc', id: 'asc' },
		});
		const uncached = await client.users.findMany({
			orderBy: { name: 'desc', id: 'asc' },
		});
		expect(first.map((row) => row.id)).toEqual([1, 2, 3]);
		expect(second).toEqual(uncached);
	});

	test('cyclic vary values bypass caching without rejecting reads', async () => {
		const { client, count } = createClient(createMemoryStore().store);
		const vary: Record<string, unknown> = {};
		vary.self = vary;
		const read = () => client.users.findMany({ cache: { vary } });
		expect(await count(read)).toBe(1);
		expect(await count(read)).toBe(1);
	});

	test('invalid dates remain invalid instead of changing into epoch dates', () => {
		const decoded = defaultSerializer.deserialize(
			defaultSerializer.serialize({ value: new Date(Number.NaN) }),
		) as { value: Date };
		expect(Number.isNaN(decoded.value.getTime())).toBe(true);
	});

	test('custom serializer decode failures also fall back for concurrent readers', async () => {
		const errors: unknown[] = [];
		const { client } = createClient(createMemoryStore().store, {
			onError: (error) => errors.push(error.code),
			serializer: {
				deserialize() {
					throw new Error('invalid encoded value');
				},
				serialize: JSON.stringify,
			},
		});
		const reads = await Promise.allSettled([
			client.users.findMany({ cache: true }),
			client.users.findMany({ cache: true }),
		]);
		expect(reads.map((result) => result.status)).toEqual([
			'fulfilled',
			'fulfilled',
		]);
		expect(errors).toContain(
			BetterDrizzleErrorCode.CacheSerializationError,
		);
	});
});
