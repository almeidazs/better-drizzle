import { describe, expect, test } from 'bun:test';

import { BetterDrizzleError, BetterDrizzleErrorCode } from '../../src';
import { cache } from '../../src/plugins/cache';
import { redis } from '../../src/plugins/cache/redis';
import { defaultSerializer } from '../../src/plugins/cache/shared/serializer';
import { createMemoryStore } from './memory-store';
import { createClient, defineCacheSuite } from './suite';

defineCacheSuite('memory fake', () => createMemoryStore().store);

describe('better-drizzle/cache options and failures', () => {
	test('rejects invalid options', () => {
		const { store } = createMemoryStore();
		expect(() => cache({ store, ttl: 0 })).toThrow(/positive number/);
		for (const maxSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => cache({ store, ttl: 1, maxSize })).toThrow(/maxSize/);
		expect(() => cache({ store, ttl: '5 minutes' as never })).toThrow(
			/duration/,
		);
		expect(() => cache({ store, ttl: '8d' })).toThrow(/versionTtl/);
		expect(() => cache({ store: undefined as never, ttl: 1 })).toThrow(
			/store/,
		);
	});

	test('writes that change no rows preserve cache entries and skip version writes', async () => {
		const memory = createMemoryStore();
		const { client, count } = createClient(memory.store);
		const read = () => client.users.findMany({ cache: true });
		await read();
		const before = memory.calls.set;
		await client.users.update({
			where: { id: 99 },
			data: { name: 'Missing' },
		});
		await client.users.updateMany({
			where: { id: 99 },
			data: { name: 'Missing' },
		});
		await client.users.delete({ where: { id: 99 } });
		await client.users.deleteMany({ where: { id: 99 } });
		await client.users.createMany({
			data: [{ id: 1, name: 'Ada', tenantId: 1 }],
			skipDuplicates: true,
		});
		expect(memory.calls.set).toBe(before);
		expect(await count(read)).toBe(0);
		await client.users.update({
			where: { id: 99 },
			data: { name: 'Missing' },
			cache: { invalidate: { models: ['users'] } },
		});
		expect(await count(read)).toBe(1);
	});

	test('uses ttl, negativeTtl, and per-call ttl in seconds', async () => {
		const memory = createMemoryStore();
		const { client } = createClient(memory.store, { ttl: '5m' });
		const entryTtls = () =>
			[...memory.values.keys()]
				.filter((key) => key.includes(':q:'))
				.map((key) => memory.ttl(key));

		await client.users.findUnique({ cache: true, where: { id: 1 } });
		expect(entryTtls()).toEqual([300]);

		memory.values.clear();
		await client.users.findUnique({ cache: true, where: { id: 99 } });
		expect(entryTtls()).toEqual([30]);

		memory.values.clear();
		await client.users.findMany({ cache: { ttl: '2h' } });
		expect(entryTtls()).toEqual([7200]);
	});

	test('entries expire with their ttl', async () => {
		const memory = createMemoryStore();
		const { client, count } = createClient(memory.store, { ttl: 10 });
		const read = () => client.users.findMany({ cache: true });

		await read();
		memory.advance(9000);
		expect(await count(read)).toBe(0);
		memory.advance(2000);
		expect(await count(read)).toBe(1);
	});

	test('refresh reruns the query and stores the fresh result', async () => {
		const { client, count, sqlite } = createClient(
			createMemoryStore().store,
		);
		const read = () => client.users.findMany({ cache: true });

		await read();
		sqlite.exec(`UPDATE cache_users SET name = 'Raw' WHERE id = 1`);
		expect((await read())[0]?.name).toBe('Ada');
		expect(
			await count(() =>
				client.users.findMany({ cache: { refresh: true } }),
			),
		).toBe(1);
		expect((await read())[0]?.name).toBe('Raw');
	});

	test('store failures fall back to the database and report onError', async () => {
		const memory = createMemoryStore();
		const errors: BetterDrizzleError[] = [];
		const { client, count } = createClient(memory.store, {
			onError: (error) => errors.push(error),
		});

		memory.fail(true);
		expect(await count(() => client.users.findMany({ cache: true }))).toBe(
			1,
		);
		const updated = await client.users.update({
			data: { name: 'Offline' },
			where: { id: 1 },
		});
		expect(updated?.name).toBe('Offline');
		expect(errors.map((error) => error.code)).toEqual([
			BetterDrizzleErrorCode.CacheStoreError,
			BetterDrizzleErrorCode.CacheStoreError,
		]);
		expect(errors[0]?.details).toEqual({ stage: 'read' });
		expect(errors[1]?.details).toEqual({ stage: 'invalidate' });

		await expect(client.$cache.clear()).rejects.toBeInstanceOf(
			BetterDrizzleError,
		);
	});

	test('skips values over maxSize', async () => {
		const errors: BetterDrizzleError[] = [];
		const { client, count } = createClient(createMemoryStore().store, {
			maxSize: 64,
			onError: (error) => errors.push(error),
		});
		const read = () => client.users.findMany({ cache: true });

		await read();
		expect(await count(read)).toBe(1);
		expect(errors[0]?.code).toBe(BetterDrizzleErrorCode.CacheValueTooLarge);
	});

	test('normalizes keys as documented', async () => {
		const { client, count } = createClient(createMemoryStore().store);

		await client.users.findMany({
			cache: true,
			where: { id: 1, tenantId: 1 },
		});
		const same = [
			() =>
				client.users.findMany({
					cache: true,
					where: { tenantId: 1, id: 1 },
				}),
			() =>
				client.users.findMany({
					cache: { ttl: '1h' },
					meta: { requestId: 'other' },
					take: undefined,
					where: { id: 1, tenantId: 1 },
				}),
		];
		for (const read of same) expect(await count(read)).toBe(0);

		const different = [
			() =>
				client.users.findFirst({
					cache: true,
					where: { id: 1, tenantId: 1 },
				}),
			() =>
				client.users.findMany({
					cache: { tags: ['a'] },
					where: { id: 1, tenantId: 1 },
				}),
			() =>
				client.users.findMany({
					cache: true,
					select: { id: true },
					where: { id: 1, tenantId: 1 },
				}),
		];
		for (const read of different) expect(await count(read)).toBe(1);
	});

	test('bypasses reads it cannot hash', async () => {
		const { client, count } = createClient(createMemoryStore().store);
		const read = () =>
			client.users.findMany({
				cache: { vary: () => 'not hashable' },
			});

		expect(await count(read)).toBe(1);
		expect(await count(read)).toBe(1);
	});

	test('namespace and version isolate entries', async () => {
		const memory = createMemoryStore();
		const first = createClient(memory.store, {
			namespace: 'shared',
			version: 1,
		});
		const second = createClient(memory.store, {
			namespace: 'shared',
			version: 2,
		});

		await first.client.users.findMany({ cache: true });
		expect(
			await second.count(() =>
				second.client.users.findMany({ cache: true }),
			),
		).toBe(1);
	});
});

describe('better-drizzle/cache serializer', () => {
	test('round-trips tagged values and escapes the tag key', () => {
		const value = {
			binary: Buffer.from('hi'),
			bytes: new Uint8Array([1, 2, 3]),
			date: new Date(0),
			json: { $bd: 'd', v: 1 },
			list: [1n, null, 'x'],
		};
		const copy = defaultSerializer.deserialize(
			defaultSerializer.serialize(value),
		) as typeof value;

		expect(copy).toEqual(value);
		expect(Buffer.isBuffer(copy.binary)).toBe(true);
		expect(Buffer.isBuffer(copy.bytes)).toBe(false);
		expect(copy.bytes).toBeInstanceOf(Uint8Array);
	});
});

describe('better-drizzle/cache/redis', () => {
	const recorder = () => {
		const commands: string[][] = [];
		const reply = (args: string[]) => {
			commands.push(args);
			return Promise.resolve(
				args[0] === 'MGET' ? args.slice(1).map(() => null) : 'OK',
			);
		};
		return { commands, reply };
	};

	test('drives Bun, ioredis, and node-redis clients', async () => {
		const bun = recorder();
		const ioredis = recorder();
		const nodeRedis = recorder();
		const stores = [
			redis({
				client: {
					send: (command: string, args: string[]) =>
						bun.reply([command, ...args]),
				},
			}),
			redis({
				client: {
					call: (command: string, ...args: string[]) =>
						ioredis.reply([command, ...args]),
				},
			}),
			redis({ client: { sendCommand: nodeRedis.reply } }),
		];

		for (const store of stores) {
			expect(await store.get(['a', 'b'])).toEqual([null, null]);
			await store.set([{ key: 'a', ttl: 5, value: 'x' }]);
			await store.delete(['a', 'b']);
		}
		for (const { commands } of [bun, ioredis, nodeRedis])
			expect(commands).toEqual([
				['MGET', 'a', 'b'],
				['SET', 'a', 'x', 'EX', '5'],
				['DEL', 'a', 'b'],
			]);
	});

	test('reads keys one by one in cluster mode', async () => {
		const cluster = recorder();
		const store = redis({ cluster: true, command: cluster.reply });

		await store.get(['a', 'b']);
		await store.delete(['a', 'b']);
		expect(cluster.commands).toEqual([
			['GET', 'a'],
			['GET', 'b'],
			['DEL', 'a'],
			['DEL', 'b'],
		]);
	});

	test('rejects unsupported clients', () => {
		expect(() => redis({ client: {} as never })).toThrow(
			/Unsupported Redis client/,
		);
	});
});
