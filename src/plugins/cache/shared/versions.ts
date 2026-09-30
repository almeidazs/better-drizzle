import { randomUUID } from 'node:crypto';

import type { CacheStore } from '../types';

/** Missing versions get fresh tokens before SQL, including after expiry or eviction. */
export const createVersionInitializer = (
	store: CacheStore,
	versionTtl: number,
) => {
	const initializing = new Map<string, Promise<Array<string | null>>>();
	return async (keys: string[], versions: Array<string | null>) => {
		if (!versions.includes(null)) return versions;
		const signature = JSON.stringify([keys, versions]);
		let initialization = initializing.get(signature);
		if (!initialization) {
			const sampled = versions;
			initialization = (async () => {
				const missing = [];
				for (let index = 0; index < sampled.length; index++) {
					if (sampled[index] !== null) continue;
					const value = randomUUID();
					sampled[index] = value;
					missing.push({ key: keys[index]!, ttl: versionTtl, value });
				}
				await store.set(missing);
				return sampled;
			})();
			initializing.set(signature, initialization);
		}
		try {
			versions = await initialization;
		} finally {
			if (initializing.get(signature) === initialization)
				initializing.delete(signature);
		}
		return versions;
	};
};
