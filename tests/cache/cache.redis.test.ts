import { afterAll } from 'bun:test';

import { RedisClient } from 'bun';

import { redis } from '../../src/plugins/cache/redis';
import { defineCacheSuite } from './suite';

const REDIS_URL = process.env.REDIS_URL;

if (REDIS_URL) {
	const client = new RedisClient(REDIS_URL);
	afterAll(() => client.close());
	defineCacheSuite('redis', () => redis({ client }));
}
