import { Database } from 'bun:sqlite';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { RedisClient } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { bench, do_not_optimize, group, run, summary } from 'mitata';

import { better } from '../src';
import { cache, type CacheStore } from '../src/plugins/cache';
import { redis } from '../src/plugins/cache/redis';
import { createTablesSql, relations, users } from './schema';

// Map measurements isolate plugin, hashing, and serialization costs. They do
// not predict Redis latency or production throughput. TTL expiry is not modeled.
const localStore = (
	retainQueries: boolean,
	retainVersions = true,
): CacheStore => {
	const values = new Map<string, string>();
	return {
		async delete(keys) {
			for (const key of keys) values.delete(key);
		},
		async get(keys) {
			return keys.map((key) => values.get(key) ?? null);
		},
		async set(entries) {
			for (const { key, value } of entries)
				if (retainQueries || (retainVersions && !key.includes(':q:')))
					values.set(key, value);
		},
	};
};

type BenchClient = {
	users: {
		findFirst(args: { where: { id: number } }): PromiseLike<unknown>;
		findMany(args: {
			include?: { posts: true };
			orderBy: { id: 'asc' };
			take: number;
			where?: { id: { in: number[] } };
		}): PromiseLike<unknown>;
		updateEach(args: {
			by: typeof users.id;
			data: { age: number; id: number }[];
			update: { age(row: { age: number; id: number }): number };
		}): PromiseLike<unknown>;
		upsertMany(args: {
			data: {
				active: boolean;
				age: number;
				email: string;
				id: number;
				name: string;
			}[];
			target: 'id';
			update: readonly ['age'];
		}): PromiseLike<unknown>;
	};
};

const sqlite = new Database(':memory:');
sqlite.exec(createTablesSql);
const payload = 'x'.repeat(256);
sqlite.transaction(() => {
	const insert = sqlite.prepare(
		'INSERT INTO users (id, email, name, age, active) VALUES (?, ?, ?, 30, 1)',
	);
	const insertPost = sqlite.prepare(
		'INSERT INTO posts (id, user_id, title, body, score, published) VALUES (?, ?, ?, ?, 1, 1)',
	);
	for (let id = 1; id <= 10_000; id++) {
		insert.run(id, `user-${id}@example.com`, `${id}:${payload}`);
		for (let index = 0; index < 4; index++) {
			const postId = (id - 1) * 4 + index + 1;
			insertPost.run(postId, id, `Post ${postId}`, payload);
		}
	}
})();

const raw = drizzle({ client: sqlite, relations });
const failures: unknown[] = [];
const modes: { client: BenchClient; name: string }[] = [
	{ client: better(raw) as unknown as BenchClient, name: 'no plugin' },
];
const addMode = (name: string, store: CacheStore, enabled = true) => {
	modes.push({
		client: better(raw, {
			plugins: [
				cache({
					enabled,
					namespace: `cache-benchmark:${crypto.randomUUID()}`,
					onError: (error) => failures.push(error),
					store,
					ttl: '1h',
				}),
			],
		}) as unknown as BenchClient,
		name,
	});
};
let disabledLookups = 0;
const disabledStore = localStore(true);
addMode(
	'cache installed, reads disabled',
	{
		...disabledStore,
		get(keys) {
			disabledLookups++;
			return disabledStore.get(keys);
		},
	},
	false,
);
addMode('warm Map hit', localStore(true));
// Preserve version keys, discard query entries: every timed read misses without
// growing the store or paying an artificial invalidation/refresh call.
addMode('Map miss, existing versions', localStore(false));
// Discard every write to measure initialization on each read with bounded state.
addMode('Map miss, cold versions', localStore(false, false));

let redisClient: RedisClient | undefined;
const redisKeys = new Set<string>();
if (process.env.REDIS_URL) {
	redisClient = new RedisClient(process.env.REDIS_URL);
	await redisClient.connect();
	const store = redis({ client: redisClient });
	addMode('warm Redis hit', {
		delete: (keys) => store.delete(keys),
		get: (keys) => store.get(keys),
		set(entries) {
			for (const { key } of entries) redisKeys.add(key);
			return store.set(entries);
		},
	});
}

const point = { where: { id: 7 } };
const largeResult = { orderBy: { id: 'asc' }, take: 1000 } as const;
const largeArgs = {
	orderBy: { id: 'asc' },
	take: 1000,
	where: {
		id: { in: Array.from({ length: 1000 }, (_, index) => index + 1) },
	},
} as const;
const cases: {
	name: string;
	run(client: BenchClient): PromiseLike<unknown>;
}[] = [
	{ name: 'point lookup', run: (client) => client.users.findFirst(point) },
	{
		name: '1,000 rows, 256-byte names',
		run: (client) => client.users.findMany(largeResult),
	},
	{
		name: '1,000-value predicate and 1,000 rows',
		run: (client) => client.users.findMany(largeArgs),
	},
	{
		name: 'relation graph: 100 users with 4 posts each',
		run: (client) =>
			client.users.findMany({
				include: { posts: true },
				orderBy: { id: 'asc' },
				take: 100,
			}),
	},
];
for (const concurrency of [32, 256])
	cases.push({
		name: `${concurrency} simultaneous point reads (one batch per iteration)`,
		run: (client) =>
			Promise.all(
				Array.from({ length: concurrency }, () =>
					client.users.findFirst(point),
				),
			),
	});
for (const size of [100, 1000]) {
	const args = {
		by: users.id,
		data: Array.from({ length: size }, (_, index) => ({
			age: 30,
			id: index + 1,
		})),
		update: { age: (row: { age: number; id: number }) => row.age },
	} as const;
	cases.push({
		name: `updateEach ${size} fixed rows (SQL + invalidation)`,
		run: (client) => client.users.updateEach(args),
	});
	const upsertArgs = {
		data: args.data.map(({ age, id }) => ({
			active: true,
			age,
			email: `user-${id}@example.com`,
			id,
			name: `${id}:${payload}`,
		})),
		target: 'id',
		update: ['age'],
	} as const;
	cases.push({
		name: `upsertMany ${size} fixed rows (SQL + invalidation)`,
		run: (client) => client.users.upsertMany(upsertArgs),
	});
}

try {
	console.log(
		'Cache benchmark: real SQLite, 10,000 fixed rows; Map is an in-process cost reference.\nConcurrent rows report time per complete batch, not per individual read.',
	);
	for (const scenario of cases) {
		if (
			process.env.CACHE_BENCH_FILTER &&
			!scenario.name.includes(process.env.CACHE_BENCH_FILTER)
		)
			continue;
		const expected = await scenario.run(modes[0]!.client);
		for (const mode of modes) {
			deepStrictEqual(
				await scenario.run(mode.client),
				expected,
				`${scenario.name}: ${mode.name}`,
			);
			// A second pass validates deserialized hits as well as first misses.
			deepStrictEqual(
				await scenario.run(mode.client),
				expected,
				`${scenario.name}: ${mode.name} repeat`,
			);
		}
		strictEqual(
			failures.length,
			0,
			'Cache errors invalidate the benchmark',
		);
		console.log(`Parity verified: ${scenario.name}`);
		group(scenario.name, () => {
			summary(() => {
				for (const mode of modes)
					bench(mode.name, async () =>
						do_not_optimize(await scenario.run(mode.client)),
					);
			});
		});
	}
	// Bulk-write parity checks invalidate earlier reads; restore warm entries
	// before any measurement, independently of which scenario runs first.
	for (const scenario of cases)
		if (!scenario.name.includes('SQL + invalidation'))
			for (const mode of modes) await scenario.run(mode.client);
	if (!process.env.CACHE_BENCH_VERIFY_ONLY) await run();
	strictEqual(failures.length, 0, 'Cache errors invalidate the benchmark');
	strictEqual(
		disabledLookups,
		0,
		'Disabled reads must never look up the store',
	);
} finally {
	if (redisClient) {
		try {
			if (redisKeys.size) await redisClient.send('DEL', [...redisKeys]);
		} finally {
			redisClient.close();
		}
	}
	sqlite.close();
}
