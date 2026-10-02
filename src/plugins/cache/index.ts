import { randomUUID } from 'node:crypto';

import type { PluginModelInfo } from 'better-drizzle';
import {
	BetterDrizzleError,
	BetterDrizzleErrorCode,
	definePlugin,
} from 'better-drizzle';

import {
	isEmptyResult,
	prepareCascadeDependencies,
	readDependencies,
	type ReadDependencies,
	type VersionKeys,
	writeDependencies,
} from './shared/dependencies';
import { createReadSettings, type ReadSettings } from './shared/options';
import {
	byteLength,
	canonicalizeQueryArgs,
	canonicalizeRead,
	defaultSerializer,
	hash,
	UncacheableValueError,
} from './shared/serializer';
import { createVersionInitializer } from './shared/versions';
import type {
	CacheClientExtension,
	CacheInvalidateHint,
	CacheInvalidateTarget,
	CacheOperationArgs,
	CacheOptions,
	CacheReadArg,
	CacheWriteArg,
} from './types';
import { version } from './version';

type MutableRecord = Record<string, unknown>;
type Models = Readonly<Record<string, PluginModelInfo | undefined>>;

const isRecord = (value: unknown): value is MutableRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const READ_KINDS = new Set([
	'count',
	'cursor',
	'exists',
	'findFirst',
	'findMany',
	'findOne',
	'findUnique',
	'paginate',
]);
const SINGLE_KINDS = new Set(['findFirst', 'findOne', 'findUnique']);
// Keys that never change a result: the cache setting itself and hook meta.
const IGNORED_ARGS = new Set(['cache', 'meta']);

export const cache = (options: CacheOptions) => {
	const { store } = options;
	const preparedQueries = new WeakMap<object, string>();
	const serializer = options.serializer ?? defaultSerializer;
	const { maxSize, resolveRead, versionTtl } = createReadSettings(options);
	const prefix = `${options.namespace ?? 'better-drizzle'}:${options.version ?? 1}:`;
	const keys: VersionKeys = {
		all: `${prefix}v:all`,
		entity: (model, id) => `${prefix}v:e:${model}:${id}`,
		epoch: (model) => `${prefix}v:m:${model}:epoch`,
		rows: (model) => `${prefix}v:m:${model}:rows`,
		tag: (tag) => `${prefix}v:t:${tag}`,
	};
	const customKey = (key: string) => `${prefix}k:${key}`;
	const registries = new WeakMap<object, Models>();
	const inflight = new Map<string, Promise<string | undefined>>();
	const pending = new WeakMap<object, Set<string>>();
	const initializeVersions = createVersionInitializer(store, versionTtl);

	const report = (
		error: unknown,
		code: BetterDrizzleErrorCode,
		details?: MutableRecord,
	) => {
		try {
			options.onError?.(
				BetterDrizzleError.from(error, {
					code,
					details,
				}),
			);
		} catch {}
	};

	const bump = (targets: Iterable<string>) => {
		const entries = [];
		for (const key of targets)
			entries.push({ key, ttl: versionTtl, value: randomUUID() });
		return entries.length ? store.set(entries) : Promise.resolve();
	};

	const hintTargets = (hint: CacheInvalidateHint | undefined) => {
		const targets = new Set<string>();
		for (const model of hint?.models ?? []) {
			targets.add(keys.epoch(model));
			targets.add(keys.rows(model));
		}
		for (const tag of hint?.tags ?? []) targets.add(keys.tag(tag));
		return targets;
	};

	// Inside a transaction, targets wait for the outermost commit. Each
	// (sub)transaction client gets one afterCommit callback; savepoint
	// callbacks merge into the parent and are dropped on rollback.
	const invalidate = async (
		context: {
			afterCommit(callback: () => unknown): void;
			afterRollback(callback: () => unknown): void;
			isInTransaction: boolean;
			transaction: unknown;
		},
		targets: Set<string>,
	) => {
		if (!targets.size) return;
		const transaction = context.transaction;
		if (context.isInTransaction && isRecord(transaction)) {
			const queued = pending.get(transaction);
			if (queued) {
				for (const key of targets) queued.add(key);
				return;
			}
			pending.set(transaction, targets);
			context.afterRollback(() => pending.delete(transaction));
			context.afterCommit(() => {
				pending.delete(transaction);
				return bump(targets).catch((error) =>
					report(error, BetterDrizzleErrorCode.CacheStoreError, {
						stage: 'invalidate',
					}),
				);
			});
			return;
		}
		try {
			await bump(targets);
		} catch (error) {
			report(error, BetterDrizzleErrorCode.CacheStoreError, {
				stage: 'invalidate',
			});
		}
	};

	const entryKey = (
		context: {
			args: MutableRecord;
			kind: string;
			meta: unknown;
			params?: Readonly<MutableRecord>;
			state: Readonly<MutableRecord>;
			table: string;
			transactionContext: MutableRecord | undefined;
		},
		settings: ReadSettings,
	) => {
		if (settings.key !== undefined) return customKey(settings.key);
		const { params } = context;
		// A prepared statement passes the same args on every execution, so
		// their canonical text is computed once and joined with the values.
		let query = params ? preparedQueries.get(context.args) : undefined;
		try {
			let args: MutableRecord | null = null;
			if (query === undefined) {
				args = Object.create(null) as MutableRecord;
				for (const key in context.args)
					if (!IGNORED_ARGS.has(key)) args[key] = context.args[key];
				if (params) {
					query = canonicalizeQueryArgs(args);
					preparedQueries.set(context.args, query);
					args = null;
				}
			}
			const identity: unknown[] = [
				context.table,
				context.kind,
				args,
				settings.tags,
				settings.vary,
				options.vary?.({
					meta: context.meta,
					model: context.table,
					operation: context.kind,
					state: context.state,
					transactionContext: context.transactionContext,
				}),
			];
			if (query === undefined)
				return `${prefix}q:${hash(canonicalizeRead(identity))}`;
			identity.push(params);
			return `${prefix}q:${hash(`${query}\n${canonicalizeRead(identity)}`)}`;
		} catch (error) {
			if (error instanceof UncacheableValueError) return;
			throw error;
		}
	};

	// Entry layout: `[versions, empty]\n<serialized result>`.
	const readEntry = (
		entry: string,
		versions: ReadonlyArray<string | null>,
		dependencies: ReadDependencies,
	) => {
		const newline = entry.indexOf('\n');
		if (newline < 0) return;
		const [stored, empty] = JSON.parse(entry.slice(0, newline)) as [
			Array<string | null>,
			boolean,
		];
		if (stored.length !== versions.length) return;
		for (let index = 0; index < versions.length; index++)
			if (
				stored[index] !== versions[index] &&
				(empty || !dependencies.emptyOnly[index])
			)
				return;
		return { value: serializer.deserialize(entry.slice(newline + 1)) };
	};

	const read = async (context: MutableRecord & InterceptContext) => {
		const settings = resolveRead(
			context.table,
			(context.args as { cache?: CacheReadArg }).cache,
		);
		if (!settings) return context.next();
		if (context.isInTransaction || context.args.lock) {
			context.annotate('cache', 'bypass');
			return context.next();
		}
		const key = entryKey(context, settings);
		if (!key) {
			context.annotate('cache', 'bypass');
			return context.next();
		}
		const models = registries.get(context.schema) ?? {};
		const dependencies = readDependencies(
			keys,
			models,
			context.model,
			context,
			settings.tags,
			context.params as MutableRecord | undefined,
		);

		if (settings.key !== undefined) {
			dependencies.keys.push(`${prefix}v:k:${settings.key}`);
			dependencies.emptyOnly.push(false);
		}

		let versions: Array<string | null>;
		let entry: string | null;
		try {
			const values = await store.get([key, ...dependencies.keys]);
			entry = values[0] ?? null;
			versions = [];
			for (let index = 1; index <= dependencies.keys.length; index++)
				versions.push(values[index] ?? null);
			versions = await initializeVersions(dependencies.keys, versions);
		} catch (error) {
			report(error, BetterDrizzleErrorCode.CacheStoreError, {
				stage: 'read',
			});
			context.annotate('cache', 'bypass');
			return context.next();
		}

		if (entry && !settings.refresh) {
			let hit: { value: unknown } | undefined;
			try {
				hit = readEntry(entry, versions, dependencies);
			} catch (error) {
				report(error, BetterDrizzleErrorCode.CacheSerializationError, {
					stage: 'deserialize',
				});
			}
			if (hit) {
				context.annotate('cache', 'hit');
				if (!settings.afterHooks) context.skipAfterHooks();
				return hit.value;
			}
		}

		// Versions are part of the flight key: a read that starts after an
		// invalidation never joins a query that started before it.
		const flight = `${key}\n${versions.join('\n')}`;
		const shared = settings.refresh ? undefined : inflight.get(flight);
		if (shared) {
			const serialized = await shared;
			if (serialized !== undefined) {
				try {
					const value = serializer.deserialize(serialized);
					context.annotate('cache', 'hit');
					if (!settings.afterHooks) context.skipAfterHooks();
					return value;
				} catch (error) {
					report(
						error,
						BetterDrizzleErrorCode.CacheSerializationError,
						{ stage: 'deserialize' },
					);
				}
			}
		}

		let settle!: (value: string | undefined) => void;
		const promise = new Promise<string | undefined>((resolve) => {
			settle = resolve;
		});
		inflight.set(flight, promise);
		let serialized: string | undefined;
		try {
			const result = await context.next();
			try {
				serialized = serializer.serialize(result);
			} catch (error) {
				report(error, BetterDrizzleErrorCode.CacheSerializationError, {
					stage: 'serialize',
				});
			}
			settle(serialized);
			context.annotate('cache', 'miss');
			if (serialized === undefined) return result;

			const value = `${JSON.stringify([versions, isEmptyResult(result)])}\n${serialized}`;
			const size = byteLength(value);
			if (size > maxSize) {
				report(
					new Error(
						`Cached value for "${context.table}.${context.kind}" is ${size} bytes, over maxSize (${maxSize}).`,
					),
					BetterDrizzleErrorCode.CacheValueTooLarge,
					{ maxSize, size },
				);
				return result;
			}
			try {
				await store.set([
					{
						key,
						ttl:
							result === null && SINGLE_KINDS.has(context.kind)
								? settings.negativeTtl
								: settings.ttl,
						value,
					},
				]);
			} catch (error) {
				report(error, BetterDrizzleErrorCode.CacheStoreError, {
					stage: 'write',
				});
			}
			return result;
		} finally {
			settle(serialized);
			if (inflight.get(flight) === promise) inflight.delete(flight);
		}
	};

	const write = async (context: MutableRecord & InterceptContext) => {
		const result = await context.next();
		const hint = (context.args as { cache?: CacheWriteArg }).cache
			?.invalidate;
		const unchanged =
			result === null ||
			((context.kind.endsWith('Many') || context.kind === 'updateEach') &&
				isRecord(result) &&
				result.count === 0);
		if (unchanged && !hint) return result;
		const models = registries.get(context.schema) ?? {};
		const targets = unchanged
			? new Set<string>()
			: writeDependencies(keys, models, context.model, context);
		if (hint) for (const key of hintTargets(hint)) targets.add(key);
		await invalidate(context, targets);
		return result;
	};

	return definePlugin<
		CacheOptions,
		CacheClientExtension,
		Record<never, never>,
		Record<string, unknown>,
		CacheOperationArgs
	>({
		description:
			'Caches opted-in reads and invalidates them after writes commit.',
		extendClient() {
			return {
				$cache: {
					async clear() {
						try {
							await bump([keys.all]);
						} catch (error) {
							throw BetterDrizzleError.from(error, {
								code: BetterDrizzleErrorCode.CacheStoreError,
							});
						}
					},
					async invalidate(target: CacheInvalidateTarget) {
						try {
							await Promise.all([
								bump([
									...hintTargets(target),
									...(target.keys ?? []).map(
										(key) => `${prefix}v:k:${key}`,
									),
								]),
								target.keys?.length
									? store.delete(target.keys.map(customKey))
									: undefined,
							]);
						} catch (error) {
							throw BetterDrizzleError.from(error, {
								code: BetterDrizzleErrorCode.CacheStoreError,
							});
						}
					},
				},
			};
		},
		hooks: {
			afterRaw(context) {
				const hint = (context.rawOptions as { cache?: CacheWriteArg })
					.cache?.invalidate;
				if (hint) return invalidate(context, hintTargets(hint));
			},
		},
		id: 'better-drizzle/cache',
		intercept(context) {
			const input = context as unknown as MutableRecord &
				InterceptContext;
			return READ_KINDS.has(context.kind) ? read(input) : write(input);
		},
		name: 'Cache',
		operationArgs: {
			count: { cache: undefined },
			create: { cache: undefined },
			createMany: { cache: undefined },
			cursor: { cache: undefined },
			delete: { cache: undefined },
			deleteMany: { cache: undefined },
			exists: { cache: undefined },
			findFirst: { cache: undefined },
			findMany: { cache: undefined },
			findOne: { cache: undefined },
			findUnique: { cache: undefined },
			paginate: { cache: undefined },
			update: { cache: undefined },
			updateEach: { cache: undefined },
			updateMany: { cache: undefined },
			upsert: { cache: undefined },
			upsertMany: { cache: undefined },
		},
		options,
		setup({ models, schema }) {
			prepareCascadeDependencies(models as unknown as Models, schema);
			registries.set(schema as object, models as unknown as Models);
		},
		version,
	});
};

type InterceptContext = {
	afterCommit(callback: () => unknown): void;
	afterRollback(callback: () => unknown): void;
	annotate(key: string, value: unknown): void;
	args: MutableRecord;
	data?: unknown;
	include?: unknown;
	isInTransaction: boolean;
	kind: string;
	meta: unknown;
	model: PluginModelInfo;
	next(): Promise<unknown>;
	params?: Readonly<MutableRecord>;
	schema: object;
	select?: unknown;
	skipAfterHooks(): void;
	state: Readonly<MutableRecord>;
	table: string;
	transaction: unknown;
	transactionContext: MutableRecord | undefined;
	where?: unknown;
};

declare module 'better-drizzle' {
	interface RawOptionsExtensions {
		/** Cache invalidation applied after the raw call succeeds or commits. */
		cache?: CacheWriteArg;
	}
}

export default cache;

export type * from './types';

export { version };
