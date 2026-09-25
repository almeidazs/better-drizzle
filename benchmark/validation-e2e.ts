import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { bench, do_not_optimize, group, run, summary } from 'mitata';

import { better } from '../src';
import { ata } from '../src/plugins/ata';
import { zod } from '../src/plugins/zod';
import { createTablesSql, schema } from './schema';

/**
 * What validation costs as a share of a real operation.
 *
 * `validation.ts` compares the two plugins' schemas in isolation, which answers
 * "which validator is faster" and not "does it matter". This one runs the same
 * operations through Better Drizzle against a real SQLite database, with no
 * plugin, with the zod plugin, and with the ata plugin, so the overhead is a
 * fraction of something rather than a number on its own.
 *
 * All three clients share one database file, so the query work is identical and
 * the difference between rows is the plugin.
 *
 * Validation is on for reads here, which is not the default for either plugin.
 * Left at the default, a read costs the same in all three rows and the
 * comparison says nothing, so `query` and `result` are turned on deliberately
 * and the default-configuration rows are reported separately.
 */

const USER_COUNT = 400;
const POSTS_PER_USER = 4;

const dir = mkdtempSync(join(tmpdir(), 'bench-e2e-'));
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
	let postId = 1;
	for (let userId = 1; userId <= USER_COUNT; userId += 1) {
		insertUser.run(
			userId,
			`user-${userId}@example.com`,
			`User ${userId}`,
			18 + (userId % 52),
			userId % 3 !== 0 ? 1 : 0,
		);
		for (let i = 0; i < POSTS_PER_USER; i += 1) {
			insertPost.run(
				postId,
				userId,
				`Post ${postId}`,
				`Body ${postId}`,
				(postId * 17) % 1000,
				postId % 2,
			);
			postId += 1;
		}
	}
});
seed();

const raw = drizzle(sqlite, { schema });

// Everything on, so the plugins are actually doing work on every operation.
const ALL_ON = {
	count: true,
	create: true,
	findFirst: true,
	findMany: true,
	query: true,
	result: true,
} as const;

/**
 * Only the three calls this file makes. The plugins' own generics are deep
 * enough that instantiating the full client type three times over trips
 * TS2589, and nothing here needs the inference: the operations are fixed and
 * the return values are only handed to do_not_optimize.
 */
type BenchClient = {
	users: {
		create(args: { data: Record<string, unknown> }): Promise<unknown>;
		findFirst(args: { where: Record<string, unknown> }): Promise<unknown>;
		findMany(args: {
			take?: number;
			where?: Record<string, unknown>;
		}): Promise<unknown[]>;
	};
};

const asBench = (client: unknown) => client as BenchClient;

const plain = asBench(better(raw, { schema }));
const withZod = asBench(
	better(raw, {
		plugins: [
			zod({ behavior: { unknownKeys: 'strict' }, validate: ALL_ON }),
		],
		schema,
	}),
);
const withAta = asBench(
	better(raw, { plugins: [ata({ validate: ALL_ON })], schema }),
);

// Defaults: reads unvalidated, writes validated. What a user actually gets.
const zodDefaults = asBench(
	better(raw, {
		plugins: [zod({ behavior: { unknownKeys: 'strict' } })],
		schema,
	}),
);
const ataDefaults = asBench(better(raw, { plugins: [ata()], schema }));

// --- writes, where both plugins validate by default -------------------------

let nextId = USER_COUNT * 10;
const newUser = () => {
	nextId += 1;
	return {
		active: true,
		age: 30,
		email: `bench-${nextId}@example.com`,
		id: nextId,
		name: `Bench ${nextId}`,
	};
};

group('create one row (validated by default in both plugins)', () => {
	summary(() => {
		bench('no plugin', async () =>
			do_not_optimize(await plain.users.create({ data: newUser() })));
		bench('zod', async () =>
			do_not_optimize(
				await zodDefaults.users.create({ data: newUser() }),
			));
		bench('ata', async () =>
			do_not_optimize(
				await ataDefaults.users.create({ data: newUser() }),
			));
	});
});

// --- reads with validation forced on ----------------------------------------

group('findMany, 20 rows, validation forced on', () => {
	summary(() => {
		bench('no plugin', async () =>
			do_not_optimize(
				await plain.users.findMany({
					take: 20,
					where: { active: true },
				}),
			));
		bench('zod', async () =>
			do_not_optimize(
				await withZod.users.findMany({
					take: 20,
					where: { active: true },
				}),
			));
		bench('ata', async () =>
			do_not_optimize(
				await withAta.users.findMany({
					take: 20,
					where: { active: true },
				}),
			));
	});
});

group('findMany, 200 rows, validation forced on', () => {
	summary(() => {
		bench('no plugin', async () =>
			do_not_optimize(
				await plain.users.findMany({
					take: 200,
					where: { active: true },
				}),
			));
		bench('zod', async () =>
			do_not_optimize(
				await withZod.users.findMany({
					take: 200,
					where: { active: true },
				}),
			));
		bench('ata', async () =>
			do_not_optimize(
				await withAta.users.findMany({
					take: 200,
					where: { active: true },
				}),
			));
	});
});

group('findFirst by id, validation forced on', () => {
	summary(() => {
		bench('no plugin', async () =>
			do_not_optimize(await plain.users.findFirst({ where: { id: 7 } })));
		bench('zod', async () =>
			do_not_optimize(
				await withZod.users.findFirst({ where: { id: 7 } }),
			));
		bench('ata', async () =>
			do_not_optimize(
				await withAta.users.findFirst({ where: { id: 7 } }),
			));
	});
});

group('findMany, 20 rows, plugin defaults (reads unvalidated)', () => {
	summary(() => {
		bench('no plugin', async () =>
			do_not_optimize(
				await plain.users.findMany({
					take: 20,
					where: { active: true },
				}),
			));
		bench('zod', async () =>
			do_not_optimize(
				await zodDefaults.users.findMany({
					take: 20,
					where: { active: true },
				}),
			));
		bench('ata', async () =>
			do_not_optimize(
				await ataDefaults.users.findMany({
					take: 20,
					where: { active: true },
				}),
			));
	});
});

await run();

// --- the three clients must agree about the data, or the timings are noise ---

const same = async () => {
	const a = await plain.users.findMany({ take: 5, where: { active: true } });
	const b = await withZod.users.findMany({
		take: 5,
		where: { active: true },
	});
	const c = await withAta.users.findMany({
		take: 5,
		where: { active: true },
	});
	const j = (v: unknown) => JSON.stringify(v);
	return j(a) === j(b) && j(a) === j(c);
};
console.log(`\nall three clients returned the same rows: ${await same()}`);

sqlite.close();
rmSync(dir, { force: true, recursive: true });
