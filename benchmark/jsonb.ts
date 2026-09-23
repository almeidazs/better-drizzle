import { deepStrictEqual, ok } from 'node:assert';

import { type AnyColumn, and, eq, gte, like, type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core';
import { bench, do_not_optimize, group, run, summary } from 'mitata';
import { Client } from 'pg';

import { better } from '../src';

type Metadata = {
	profile: { age: number; active: boolean; name: string };
};

const TABLE = 'better_drizzle_jsonb_benchmark_events';
const ROWS = 100_000;

const events = pgTable(TABLE, {
	id: integer('id').primaryKey(),
	metadata: jsonb('metadata').$type<Metadata>().notNull(),
});
const schema = { events };

const connectionString = Bun.env.DATABASE_URL;
if (!connectionString)
	throw new Error('DATABASE_URL is required for the JSONB benchmark.');

const client = new Client({ connectionString });
await client.connect();

// Seeded server-side: 100k rows would blow past PostgreSQL's 65535 bind
// parameter limit if they were sent as placeholders.
await client.query(`drop table if exists ${TABLE}`);
await client.query(
	`create table ${TABLE} (id integer primary key, metadata jsonb not null)`,
);
await client.query(`
	insert into ${TABLE} (id, metadata)
	select g, jsonb_build_object('profile', jsonb_build_object(
		'age', 18 + (g % 60),
		'active', g % 2 = 0,
		'name', 'User ' || g
	))
	from generate_series(1, ${ROWS}) g
`);
await client.query(
	`create index ${TABLE}_age_idx on ${TABLE} (((metadata #>> '{profile,age}')::numeric))`,
);
await client.query(`analyze ${TABLE}`);

const raw = drizzle(client, { schema });
// oxlint-disable-next-line typescript/no-explicit-any -- Benchmark type erasure.
const db = better(raw, { schema }) as any;

/**
 * Rebuilds the exact path expression the query compiler emits, so the raw
 * Drizzle side is not a different (easier) query.
 */
const path = (parts: readonly string[]) =>
	sql`ARRAY[${sql.join(
		parts.map((part) => sql`${part}`),
		sql`, `,
	)}]::text[]`;

const jsonText = (parts: readonly string[]) =>
	sql`${events.metadata} #>> ${path(parts)}`;

const jsonType = (parts: readonly string[]) =>
	sql`jsonb_typeof(${events.metadata} #> ${path(parts)})`;

const AGE = ['profile', 'age'] as const;
const NAME = ['profile', 'name'] as const;
const ACTIVE = ['profile', 'active'] as const;

type Scenario = {
	name: string;
	/** Set when the expression index should be used by both sides. */
	indexed: boolean;
	where: SQL;
	json: Record<string, unknown>;
};

const scenarios: readonly Scenario[] = [
	{
		name: 'number equality (indexed)',
		indexed: true,
		where: and(
			eq(jsonType(AGE), 'number'),
			eq(sql`(${jsonText(AGE)})::numeric`, 25),
		) as SQL,
		json: { 'profile.age': 25 },
	},
	{
		name: 'number range (indexed)',
		indexed: true,
		where: and(
			eq(jsonType(AGE), 'number'),
			gte(sql`(${jsonText(AGE)})::numeric`, 70),
		) as SQL,
		json: { 'profile.age': { gte: 70 } },
	},
	{
		name: 'string prefix (sequential)',
		indexed: false,
		where: and(
			eq(jsonType(NAME), 'string'),
			like(jsonText(NAME) as unknown as AnyColumn, 'User 999%'),
		) as SQL,
		json: { 'profile.name': { startsWith: 'User 999' } },
	},
	{
		name: 'boolean equality (sequential)',
		indexed: false,
		where: and(
			eq(jsonType(ACTIVE), 'boolean'),
			eq(sql`(${jsonText(ACTIVE)})::boolean`, true),
		) as SQL,
		json: { 'profile.active': true },
	},
];

const rawQuery = (scenario: Scenario) =>
	raw.select().from(events).where(scenario.where);

const betterQuery = (scenario: Scenario) =>
	db.events.findMany({ where: { metadata: { json: scenario.json } } });

const byId = (rows: readonly { id: number }[]) =>
	[...rows].sort((left, right) => left.id - right.id);

const planOf = async (statement: { sql: string; params: unknown[] }) => {
	const explained = await client.query(
		`explain ${statement.sql}`,
		statement.params as unknown[],
	);
	return explained.rows.map((row) => String(row['QUERY PLAN'])).join('\n');
};

/**
 * Parity has two halves: the two sides must return the same rows, and they
 * must reach them the same way. Matching rows through a sequential scan on one
 * side and an index scan on the other would not be a fair comparison.
 */
const verifyParity = async () => {
	for (const scenario of scenarios) {
		const [rawRows, betterRows] = await Promise.all([
			rawQuery(scenario),
			betterQuery(scenario),
		]);

		ok(
			rawRows.length > 0,
			`Scenario "${scenario.name}" matched no rows; it would measure nothing.`,
		);
		deepStrictEqual(
			byId(betterRows),
			byId(rawRows),
			`Row parity failed: ${scenario.name}`,
		);

		const rawPlan = await planOf(rawQuery(scenario).toSQL());
		const betterStatement = (
			await betterQuery(scenario).explain()
		).statements.find(({ key }: { key: string }) => key === 'data');
		ok(betterStatement, `No data statement explained: ${scenario.name}`);
		const betterPlan = await planOf(betterStatement);

		const indexName = `${TABLE}_age_idx`;
		const rawIndexed = rawPlan.includes(indexName);
		const betterIndexed = betterPlan.includes(indexName);
		deepStrictEqual(
			betterIndexed,
			rawIndexed,
			`Plan parity failed: ${scenario.name}\nraw:\n${rawPlan}\nbetter:\n${betterPlan}`,
		);
		deepStrictEqual(
			betterIndexed,
			scenario.indexed,
			`Expected indexed=${scenario.indexed}: ${scenario.name}\n${betterPlan}`,
		);

		console.log(
			`  ${scenario.name}: ${rawRows.length} rows, ${
				betterIndexed ? 'index scan' : 'sequential scan'
			} on both sides`,
		);
	}
};

console.log('JSONB parity validation:');
await verifyParity();
console.log('JSONB benchmark parity validation passed.');

if (Bun.env.BENCH_VERIFY_ONLY !== '1') {
	group('jsonb parity', () => {
		summary(() => {
			for (const scenario of scenarios) {
				bench(`drizzle: ${scenario.name}`, async () =>
					do_not_optimize(await rawQuery(scenario)));
				bench(`better: ${scenario.name}`, async () =>
					do_not_optimize(await betterQuery(scenario)));
			}
		});
	});

	await run();
}

await client.query(`drop table if exists ${TABLE}`);
await client.end();
