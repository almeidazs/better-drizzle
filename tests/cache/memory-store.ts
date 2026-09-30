import type { CacheStore } from '../../src/plugins/cache';

/** In-memory store for tests. It is not exported by the package. */
export const createMemoryStore = () => {
	const values = new Map<string, { expiresAt: number; value: string }>();
	const calls = { delete: 0, get: 0, set: 0 };
	let failing = false;
	let now = 0;

	const check = () => {
		if (failing) throw new Error('store unavailable');
	};
	const store: CacheStore = {
		async delete(keys) {
			calls.delete++;
			check();
			for (const key of keys) values.delete(key);
		},
		async get(keys) {
			calls.get++;
			check();
			return keys.map((key) => {
				const entry = values.get(key);
				if (!entry) return null;
				if (entry.expiresAt <= now) {
					values.delete(key);
					return null;
				}
				return entry.value;
			});
		},
		async set(entries) {
			calls.set++;
			check();
			for (const { key, ttl, value } of entries)
				values.set(key, { expiresAt: now + ttl * 1000, value });
		},
	};

	return {
		advance(ms: number) {
			now += ms;
		},
		calls,
		close() {},
		fail(value: boolean) {
			failing = value;
		},
		store,
		ttl(key: string) {
			const entry = values.get(key);
			return entry ? (entry.expiresAt - now) / 1000 : undefined;
		},
		values,
	};
};
