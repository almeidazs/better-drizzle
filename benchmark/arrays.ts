import { deepStrictEqual, ok } from 'node:assert';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { bench, do_not_optimize, group, run } from 'mitata';
import { Client } from 'pg';

import { better } from '../src';

const TABLE = 'better_drizzle_array_benchmark';
const ROWS = 100_000;
const entries = pgTable(TABLE, {
	id: integer('id').primaryKey(),
	tags: text('tags').array().notNull(),
});
const schema = { entries };
const connectionString = Bun.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const client = new Client({ connectionString });
await client.connect();
await client.query(`drop table if exists ${TABLE}`);
await client.query(
	`create table ${TABLE} (id integer primary key, tags text[] not null)`,
);
await client.query(`insert into ${TABLE}
	select g, array['tag-' || (g % 100), 'common'] from generate_series(1, ${ROWS}) g`);
await client.query(
	`create index ${TABLE}_tags_gin on ${TABLE} using gin (tags)`,
);
await client.query(`analyze ${TABLE}`);

const raw = drizzle(client, { schema });
const db = better(raw, { schema });
const rawQuery = () =>
	raw
		.select()
		.from(entries)
		.where(sql`${entries.tags} @> ${sql.param(['tag-42'], entries.tags)}`);
const betterQuery = () =>
	db.entries.findMany({ where: { tags: { has: 'tag-42' } } });
const [rawRows, betterRows] = await Promise.all([rawQuery(), betterQuery()]);
ok(rawRows.length > 0);
deepStrictEqual(
	[...betterRows].sort((left, right) => left.id - right.id),
	[...rawRows].sort((left, right) => left.id - right.id),
);
const rawStatement = rawQuery().toSQL();
const rawPlan = await client.query(
	`explain ${rawStatement.sql}`,
	rawStatement.params,
);
const betterPlan = await betterQuery().explain();
const indexName = `${TABLE}_tags_gin`;
ok(JSON.stringify(rawPlan.rows).includes(indexName));
ok(JSON.stringify(betterPlan.statements[0]?.raw).includes(indexName));

group('PostgreSQL array has (GIN)', () => {
	bench('Drizzle', async () => do_not_optimize(await rawQuery()));
	bench('better-drizzle', async () => do_not_optimize(await betterQuery()));
});

await run();
await client.query(`drop table if exists ${TABLE}`);
await client.end();
