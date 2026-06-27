import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BetterDrizzleClient } from '../packages/core/src';
import { better } from '../packages/core/src';
import type { BenchmarkSchema } from './schema';
import { createTablesSql, schema } from './schema';

const USER_COUNT = 400;
const POSTS_PER_USER = 4;
const COMMENTS_PER_POST = 3;
const BENCH_WRITE_COUNT = 2048;

const createRawBenchmarkClient = (sqlite: Database) =>
	drizzle(sqlite, { schema });

type BenchmarkRawClient = ReturnType<typeof createRawBenchmarkClient>;

export type BenchmarkContext = {
	better: BetterDrizzleClient<BenchmarkSchema>;
	counters: {
		createDeleteId: number;
		createDeleteToken: number;
		updateOffset: number;
	};
	ids: {
		cursorAfterId: number;
		relationLimit: number;
		updatePoolSize: number;
		userLookupId: number;
	};
	raw: BenchmarkRawClient;
	sqlite: Database;
	close(): void;
};

export const createBenchmarkContext = (): BenchmarkContext => {
	const dir = mkdtempSync(join(tmpdir(), 'bench-'));
	const sqlite = new Database(join(dir, 'bench.db'));

	sqlite.exec(`
PRAGMA journal_mode = MEMORY;
PRAGMA synchronous = OFF;
PRAGMA temp_store = MEMORY;
PRAGMA foreign_keys = ON;
${createTablesSql}
`);

	const seed = sqlite.transaction(() => {
		const insertUser = sqlite.prepare(
			'INSERT INTO users (id, email, name, age, active) VALUES (?, ?, ?, ?, ?)',
		);
		const insertPost = sqlite.prepare(
			'INSERT INTO posts (id, user_id, title, body, score, published) VALUES (?, ?, ?, ?, ?, ?)',
		);
		const insertComment = sqlite.prepare(
			'INSERT INTO comments (id, post_id, author_id, body, likes) VALUES (?, ?, ?, ?, ?)',
		);
		const insertWrite = sqlite.prepare(
			'INSERT INTO bench_writes (id, token, value, payload) VALUES (?, ?, ?, ?)',
		);

		let postId = 1;
		let commentId = 1;

		for (let userId = 1; userId <= USER_COUNT; userId += 1)
			insertUser.run(
				userId,
				`user-${userId}@example.com`,
				`User ${userId}`,
				18 + (userId % 52),
				userId % 3 !== 0 ? 1 : 0,
			);

		for (let userId = 1; userId <= USER_COUNT; userId += 1) {
			for (
				let postIndex = 0;
				postIndex < POSTS_PER_USER;
				postIndex += 1
			) {
				insertPost.run(
					postId,
					userId,
					`Post ${postId}`,
					`Body ${postId}`,
					(postId * 17) % 1000,
					postId % 2 === 0 ? 1 : 0,
				);

				for (
					let commentIndex = 0;
					commentIndex < COMMENTS_PER_POST;
					commentIndex += 1
				) {
					const authorId =
						((userId + commentIndex + 17) % USER_COUNT) + 1;
					insertComment.run(
						commentId,
						postId,
						authorId,
						`Comment ${commentId}`,
						(commentId * 13) % 250,
					);
					commentId += 1;
				}

				postId += 1;
			}
		}

		for (let id = 1; id <= BENCH_WRITE_COUNT; id += 1)
			insertWrite.run(id, `seed-${id}`, id % 1000, `payload-${id}`);
	});

	seed();

	const raw = createRawBenchmarkClient(sqlite);
	const client: BetterDrizzleClient<BenchmarkSchema> = better(raw, {
		schema,
	});

	return {
		better: client,
		counters: {
			createDeleteId: BENCH_WRITE_COUNT + 1,
			createDeleteToken: 1,
			updateOffset: 0,
		},
		ids: {
			cursorAfterId: 120,
			relationLimit: 8,
			updatePoolSize: BENCH_WRITE_COUNT,
			userLookupId: 177,
		},
		raw,
		sqlite,
		close() {
			sqlite.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
};

export const resetGc = () => {
	Bun.gc(true);
	Bun.gc(true);
};

export const snapshotMemory = () => {
	const memory = process.memoryUsage();

	return {
		arrayBuffers: memory.arrayBuffers,
		external: memory.external,
		heapTotal: memory.heapTotal,
		heapUsed: memory.heapUsed,
		rss: memory.rss,
	};
};
