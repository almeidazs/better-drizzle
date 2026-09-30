import { expect, test } from 'bun:test';

import { sql } from 'drizzle-orm';

import { better } from '../../src';
import { cache, type CacheStore } from '../../src/plugins/cache';
import { createMemoryStore } from './memory-store';
import { createClient, createDatabase } from './suite';

const gate = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

test('audit: expired invalidation cannot revive an initially unversioned delayed read', async () => {
	const memory = createMemoryStore();
	const reached = gate();
	const release = gate();
	let delayed = true;
	const store: CacheStore = {
		...memory.store,
		async set(entries) {
			if (delayed && entries.some(({ key }) => key.includes(':q:'))) {
				delayed = false;
				reached.resolve();
				await release.promise;
			}
			return memory.store.set(entries);
		},
	};
	const { client } = createClient(store, { ttl: 10, versionTtl: 10 });
	const read = () =>
		client.users.findUnique({ cache: true, where: { id: 1 } });
	const old = Promise.resolve(read());
	await reached.promise;
	await client.users.update({ data: { name: 'New' }, where: { id: 1 } });
	memory.advance(10_001);
	release.resolve();
	expect((await old)?.name).toBe('Ada');
	expect((await read())?.name).toBe('New');
});

test('audit: custom-key invalidation prevents delayed reads from repopulating the deleted key', async () => {
	const memory = createMemoryStore();
	const reached = gate();
	const release = gate();
	let delayed = true;
	const store: CacheStore = {
		...memory.store,
		async set(entries) {
			if (delayed && entries.some(({ key }) => key.includes(':k:'))) {
				delayed = false;
				reached.resolve();
				await release.promise;
			}
			return memory.store.set(entries);
		},
	};
	const { client, db } = createClient(store);
	const read = () =>
		client.users.findUnique({ cache: 'person', where: { id: 1 } });
	const old = Promise.resolve(read());
	await reached.promise;
	db.run(sql`UPDATE cache_users SET name = 'New' WHERE id = 1`);
	await client.$cache.invalidate({ keys: ['person'] });
	release.resolve();
	await old;
	expect((await read())?.name).toBe('New');
});

test('audit: eviction of version keys cannot revive initially unversioned entries', async () => {
	const memory = createMemoryStore();
	const { client } = createClient(memory.store);
	const read = () =>
		client.users.findUnique({ cache: true, where: { id: 1 } });
	await read();
	await client.users.update({ data: { name: 'New' }, where: { id: 1 } });
	for (const key of memory.values.keys())
		if (key.includes(':v:')) memory.values.delete(key);
	expect((await read())?.name).toBe('New');
});

test('audit: committed writes invalidate despite a failing transaction commit hook', async () => {
	const memory = createMemoryStore();
	const { db } = createDatabase();
	const client = better(db, {
		hooks: {
			afterTransactionCommit() {
				throw new Error('commit observer failed');
			},
		},
		plugins: [cache({ store: memory.store, ttl: 60 })],
	});
	const read = () =>
		client.users.findUnique({ cache: true, where: { id: 1 } });
	await read();
	await expect(
		client.transaction(async (tx) => {
			await tx.users.update({ data: { name: 'New' }, where: { id: 1 } });
		}),
	).rejects.toThrow('commit observer failed');
	expect((await client.users.findUnique({ where: { id: 1 } }))?.name).toBe(
		'New',
	);
	expect((await read())?.name).toBe('New');
});

test('audit: committed writes invalidate despite an earlier failing afterCommit callback', async () => {
	const { client } = createClient(createMemoryStore().store);
	const read = () =>
		client.users.findUnique({ cache: true, where: { id: 1 } });
	await read();
	await expect(
		client.transaction(async (tx) => {
			tx.afterCommit(() => {
				throw new Error('callback failed');
			});
			await tx.users.update({ data: { name: 'New' }, where: { id: 1 } });
		}),
	).rejects.toThrow('callback failed');
	expect((await read())?.name).toBe('New');
});

test('audit: successful raw writes invalidate despite a failing client afterRaw hook', async () => {
	const { db } = createDatabase();
	const client = better(db, {
		hooks: {
			afterRaw() {
				throw new Error('raw observer failed');
			},
		},
		plugins: [cache({ store: createMemoryStore().store, ttl: 60 })],
	});
	const read = () =>
		client.users.findUnique({ cache: true, where: { id: 1 } });
	await read();
	await expect(
		client.$executeRaw(
			sql`UPDATE cache_users SET name = 'New' WHERE id = 1`,
			{
				cache: { invalidate: { models: ['users'] } },
			},
		),
	).rejects.toThrow('raw observer failed');
	expect((await read())?.name).toBe('New');
});
