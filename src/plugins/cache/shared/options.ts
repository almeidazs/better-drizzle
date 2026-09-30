import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

import type {
	CacheDuration,
	CacheModelOptions,
	CacheOptions,
	CacheReadArg,
} from '../types';

export type ReadSettings = {
	afterHooks: boolean;
	key: string | undefined;
	negativeTtl: number;
	refresh: boolean;
	tags: readonly string[];
	ttl: number;
	vary: unknown;
};
type ModelDefaults = {
	enabled: boolean;
	negativeTtl: number | undefined;
	tags: readonly string[];
	ttl: number | undefined;
};

const UNITS = { d: 86_400, h: 3600, m: 60, s: 1 } as const;
const DURATION = /^(\d+(?:\.\d+)?)(s|m|h|d)$/;

const invalidOptions = (message: string) =>
	new BetterDrizzleError({
		code: BetterDrizzleErrorCode.CacheInvalidOptions,
		message,
	});

const toSeconds = (value: CacheDuration, name: string) => {
	const match = typeof value === 'string' ? DURATION.exec(value) : null;
	const seconds =
		typeof value === 'number'
			? value
			: match
				? Number(match[1]) * UNITS[match[2] as keyof typeof UNITS]
				: Number.NaN;
	if (!Number.isFinite(seconds) || seconds <= 0)
		throw invalidOptions(
			`Cache option "${name}" must be a positive number of seconds or a duration such as "5m", got ${JSON.stringify(value)}.`,
		);
	return Math.ceil(seconds);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const createReadSettings = (options: CacheOptions) => {
	const { store } = options;
	if (!store) throw invalidOptions('The cache plugin requires a `store`.');
	if (options.ttl === undefined)
		throw invalidOptions('The cache plugin requires a default `ttl`.');

	const versionTtl = toSeconds(options.versionTtl ?? '7d', 'versionTtl');
	const clampTtl = (value: CacheDuration, name: string) => {
		const seconds = toSeconds(value, name);
		if (seconds > versionTtl)
			throw invalidOptions(
				`Cache option "${name}" (${seconds}s) cannot exceed "versionTtl" (${versionTtl}s).`,
			);
		return seconds;
	};
	const ttl = clampTtl(options.ttl, 'ttl');
	const negativeTtl =
		options.negativeTtl === undefined
			? Math.min(ttl, 30)
			: clampTtl(options.negativeTtl, 'negativeTtl');
	const maxSize = options.maxSize ?? 1024 * 1024;
	if (!Number.isFinite(maxSize) || maxSize <= 0)
		throw invalidOptions(
			'Cache option "maxSize" must be a positive finite number of bytes.',
		);
	const afterHooksOnHit = options.afterHooksOnHit ?? true;
	const enabled = options.enabled ?? false;

	const modelDefaults = Object.create(null) as Record<string, ModelDefaults>;
	for (const [model, value] of Object.entries(options.models ?? {}) as Array<
		[string, CacheModelOptions]
	>)
		modelDefaults[model] =
			typeof value === 'boolean'
				? {
						enabled: value,
						negativeTtl: undefined,
						tags: [],
						ttl: undefined,
					}
				: {
						enabled: value.enabled ?? true,
						negativeTtl:
							value.negativeTtl === undefined
								? undefined
								: clampTtl(
										value.negativeTtl,
										`models.${model}.negativeTtl`,
									),
						tags: value.tags ?? [],
						ttl:
							value.ttl === undefined
								? undefined
								: clampTtl(value.ttl, `models.${model}.ttl`),
					};

	const resolveRead = (
		model: string,
		arg: CacheReadArg | undefined,
	): ReadSettings | undefined => {
		if (arg === false) return;
		const defaults = modelDefaults[model];
		if (arg === undefined && !(defaults ? defaults.enabled : enabled))
			return;
		const call = isRecord(arg) ? arg : undefined;
		return {
			afterHooks: call?.afterHooks ?? afterHooksOnHit,
			key: typeof arg === 'string' ? arg : call?.key,
			negativeTtl:
				call?.negativeTtl !== undefined
					? clampTtl(call.negativeTtl, 'negativeTtl')
					: (defaults?.negativeTtl ?? negativeTtl),
			refresh: call?.refresh ?? false,
			tags:
				call?.tags && defaults?.tags.length
					? [...defaults.tags, ...call.tags]
					: (call?.tags ?? defaults?.tags ?? []),
			ttl:
				call?.ttl !== undefined
					? clampTtl(call.ttl, 'ttl')
					: (defaults?.ttl ?? ttl),
			vary: call?.vary,
		};
	};

	return { maxSize, resolveRead, versionTtl };
};
