import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

import type { CacheStore } from '../types';

/** Runs one Redis command, e.g. `['SET', key, value, 'EX', '60']`. */
export type RedisCommand = (args: string[]) => Promise<unknown>;

/**
 * Redis clients the store can drive: Bun's `RedisClient` (`send`),
 * ioredis (`call`), and node-redis (`sendCommand`).
 */
export type RedisClientLike =
	| { send(command: string, args: string[]): Promise<unknown> }
	| { call(command: string, ...args: string[]): Promise<unknown> }
	| { sendCommand(args: string[]): Promise<unknown> };

export type RedisStoreOptions = (
	| { client: RedisClientLike; command?: never }
	| { client?: never; command: RedisCommand }
) & {
	/**
	 * Read keys one by one instead of `MGET`, so keys may live in different
	 * cluster slots. Detected for ioredis `Cluster` clients.
	 */
	cluster?: boolean;
};

const toCommand = (client: RedisClientLike): RedisCommand => {
	if ('send' in client && typeof client.send === 'function')
		return ([command, ...args]) => client.send(command as string, args);
	if ('call' in client && typeof client.call === 'function')
		return ([command, ...args]) => client.call(command as string, ...args);
	if ('sendCommand' in client && typeof client.sendCommand === 'function')
		return (args) => client.sendCommand(args);
	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.CacheInvalidOptions,
		message:
			'Unsupported Redis client. Pass a Bun RedisClient, an ioredis client, a node-redis client, or a `command` function.',
	});
};

const toValue = (value: unknown) =>
	value === null || value === undefined ? null : String(value);

/**
 * Redis store for `better-drizzle/cache`. It never opens or closes
 * connections: pass the client your app already uses.
 */
export const redis = (options: RedisStoreOptions): CacheStore => {
	const command = options.command ?? toCommand(options.client);
	const cluster =
		options.cluster ??
		Boolean(
			(options.client as { isCluster?: boolean } | undefined)?.isCluster,
		);

	return {
		async delete(keys) {
			if (!keys.length) return;
			if (cluster)
				await Promise.all(keys.map((key) => command(['DEL', key])));
			else await command(['DEL', ...keys]);
		},
		async get(keys) {
			if (!keys.length) return [];
			if (cluster)
				return Promise.all(
					keys.map(async (key) =>
						toValue(await command(['GET', key])),
					),
				);
			const values = (await command(['MGET', ...keys])) as unknown[];
			return keys.map((_, index) => toValue(values[index]));
		},
		async set(entries) {
			await Promise.all(
				entries.map(({ key, ttl, value }) =>
					command(['SET', key, value, 'EX', String(ttl)]),
				),
			);
		},
	};
};

export default redis;
