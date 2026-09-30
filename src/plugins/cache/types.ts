import type { BetterDrizzleError } from 'better-drizzle';

/**
 * A duration in seconds, or a string such as `'30s'`, `'5m'`, `'1h'`, `'1d'`.
 */
export type CacheDuration =
	| number
	| `${number}s`
	| `${number}m`
	| `${number}h`
	| `${number}d`;

/** One value written by the plugin. `ttl` is in whole seconds. */
export type CacheStoreEntry = {
	key: string;
	ttl: number;
	value: string;
};

/**
 * Storage used by the cache plugin. `get` returns one value per key, in
 * order, with `null` for missing keys.
 */
export interface CacheStore {
	delete(keys: readonly string[]): Promise<void>;
	get(keys: readonly string[]): Promise<ReadonlyArray<string | null>>;
	set(entries: readonly CacheStoreEntry[]): Promise<void>;
}

/** Converts results to strings and back. */
export type CacheSerializer = {
	deserialize(value: string): unknown;
	serialize(value: unknown): string;
};

/** Per-call cache settings for reads. */
export type CacheReadOptions = {
	/** Run after hooks on a hit. Defaults to the plugin's `afterHooksOnHit`. */
	afterHooks?: boolean;
	/** Custom key. Namespace, version, and dependencies still apply. */
	key?: string;
	/** TTL for `null` results of `findFirst`, `findOne`, and `findUnique`. */
	negativeTtl?: CacheDuration;
	/** Skip the cached value, run the query, and store the fresh result. */
	refresh?: boolean;
	/** Tags that `$cache.invalidate({ tags })` and write hints can target. */
	tags?: readonly string[];
	ttl?: CacheDuration;
	/** Extra value hashed into the key. */
	vary?: unknown;
};

/**
 * The `cache` argument accepted by reads. `true` enables caching with
 * defaults, `false` disables it, and a string sets a custom key.
 */
export type CacheReadArg = boolean | string | CacheReadOptions;

/** Models and tags to invalidate after a write succeeds or commits. */
export type CacheInvalidateHint = {
	models?: readonly string[];
	tags?: readonly string[];
};

/** The `cache` argument accepted by writes and raw SQL calls. */
export type CacheWriteArg = {
	invalidate?: CacheInvalidateHint;
};

/** Targets for `$cache.invalidate()`. `keys` are custom read keys. */
export type CacheInvalidateTarget = CacheInvalidateHint & {
	keys?: readonly string[];
};

/** Per-model defaults. `true` enables caching for every read of the model. */
export type CacheModelOptions =
	| boolean
	| {
			enabled?: boolean;
			negativeTtl?: CacheDuration;
			tags?: readonly string[];
			ttl?: CacheDuration;
	  };

/** Values available to the `vary` option. */
export type CacheVaryContext = {
	meta: unknown;
	model: string;
	operation: string;
	state: Readonly<Record<string, unknown>>;
	transactionContext: Record<string, unknown> | undefined;
};

export type CacheOptions = {
	/** Run after hooks on a hit. Defaults to `true`. */
	afterHooksOnHit?: boolean;
	/** Cache every read unless a model or call disables it. Defaults to `false`. */
	enabled?: boolean;
	/** Largest serialized entry in bytes. Defaults to 1 MiB. */
	maxSize?: number;
	models?: Readonly<Record<string, CacheModelOptions>>;
	/** Key prefix. Defaults to `'better-drizzle'`. */
	namespace?: string;
	/** TTL for `null` single-row results. Defaults to `min(ttl, 30s)`. */
	negativeTtl?: CacheDuration;
	/**
	 * Called when the store fails or a value cannot be cached. Reads fall
	 * back to the database and writes still succeed.
	 */
	onError?: (error: BetterDrizzleError) => void;
	serializer?: CacheSerializer;
	store: CacheStore;
	/** Default entry TTL. */
	ttl: CacheDuration;
	/** Values hashed into every key, e.g. the current tenant. */
	vary?: (context: CacheVaryContext) => unknown;
	/** Bump to drop every entry written by another version. Defaults to `1`. */
	version?: number | string;
	/**
	 * Lifetime of dependency versions. Entry TTLs cannot exceed it.
	 * Defaults to `'7d'`.
	 */
	versionTtl?: CacheDuration;
};

export type CacheClient = {
	/** Invalidates every entry written under the current namespace and version. */
	clear(): Promise<void>;
	/** Invalidates entries that depend on the given models, tags, or keys. */
	invalidate(target: CacheInvalidateTarget): Promise<void>;
};

export type CacheClientExtension = {
	$cache: CacheClient;
};

type ReadArgs = { cache?: CacheReadArg };
type WriteArgs = { cache?: CacheWriteArg };

export type CacheOperationArgs = {
	count: ReadArgs;
	create: WriteArgs;
	createMany: WriteArgs;
	cursor: ReadArgs;
	delete: WriteArgs;
	deleteMany: WriteArgs;
	exists: ReadArgs;
	findFirst: ReadArgs;
	findMany: ReadArgs;
	findOne: ReadArgs;
	findUnique: ReadArgs;
	paginate: ReadArgs;
	update: WriteArgs;
	updateEach: WriteArgs;
	updateMany: WriteArgs;
	upsert: WriteArgs;
	upsertMany: WriteArgs;
};
