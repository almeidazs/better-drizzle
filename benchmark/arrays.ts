import { deepStrictEqual, ok } from 'node:assert';

import { eq, sql } from 'drizzle-orm';
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
const mutationValues = ['common', 'better-drizzle-array-mutation'];
const rawMutation = () =>
	raw
		.update(entries)
		.set({
			tags: sql`case when ${entries.tags} is null then ${entries.tags} else array_cat(${entries.tags}, coalesce((select array_agg(array_mutation_item order by array_mutation_position) from (select array_mutation_item, min(array_mutation_position) as array_mutation_position from unnest(${sql.param(mutationValues, entries.tags)}::text[]) with ordinality as array_mutation_input(array_mutation_item, array_mutation_position) where not (${entries.tags} @> array[array_mutation_item]) group by array_mutation_item) as array_mutation_missing), ${entries.tags}[0:0])) end`,
		})
		.where(eq(entries.id, 1))
		.returning();
const betterMutation = () =>
	db.entries.update({
		data: { tags: { addUnique: mutationValues } },
		where: { id: 1 },
	});
const rawAppend = () =>
	raw
		.update(entries)
		.set({
			tags: sql`array_append(${entries.tags}, ${'append-benchmark'})`,
		})
		.where(eq(entries.id, 2))
		.returning();
const betterAppend = () =>
	db.entries.update({
		data: { tags: { append: 'append-benchmark' } },
		where: { id: 2 },
	});
const rawPrepend = () =>
	raw
		.update(entries)
		.set({
			tags: sql`array_prepend(${'prepend-benchmark'}, ${entries.tags})`,
		})
		.where(eq(entries.id, 3))
		.returning();
const betterPrepend = () =>
	db.entries.update({
		data: { tags: { prepend: 'prepend-benchmark' } },
		where: { id: 3 },
	});
const rawRemove = () =>
	raw
		.update(entries)
		.set({ tags: sql`array_remove(${entries.tags}, ${'not-present'})` })
		.where(eq(entries.id, 4))
		.returning();
const betterRemove = () =>
	db.entries.update({
		data: { tags: { remove: 'not-present' } },
		where: { id: 4 },
	});
const rawReplace = () =>
	raw
		.update(entries)
		.set({
			tags: sql`array_replace(${entries.tags}, ${'not-present'}, ${'replacement'})`,
		})
		.where(eq(entries.id, 5))
		.returning();
const betterReplace = () =>
	db.entries.update({
		data: { tags: { replace: { from: 'not-present', to: 'replacement' } } },
		where: { id: 5 },
	});
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
const [rawMutationRows, betterMutationRow] = await Promise.all([
	rawMutation(),
	betterMutation(),
]);
deepStrictEqual(betterMutationRow, rawMutationRows[0]);

group('PostgreSQL array has (GIN)', () => {
	bench('Drizzle', async () => do_not_optimize(await rawQuery()));
	bench('better-drizzle', async () => do_not_optimize(await betterQuery()));
});

group('PostgreSQL array addUnique (row parity)', () => {
	bench('Drizzle', async () => do_not_optimize(await rawMutation()));
	bench('better-drizzle', async () =>
		do_not_optimize(await betterMutation()));
});

group('PostgreSQL array native mutations', () => {
	bench('Drizzle append', async () => do_not_optimize(await rawAppend()));
	bench('better-drizzle append', async () =>
		do_not_optimize(await betterAppend()));
	bench('Drizzle prepend', async () => do_not_optimize(await rawPrepend()));
	bench('better-drizzle prepend', async () =>
		do_not_optimize(await betterPrepend()));
	bench('Drizzle remove', async () => do_not_optimize(await rawRemove()));
	bench('better-drizzle remove', async () =>
		do_not_optimize(await betterRemove()));
	bench('Drizzle replace', async () => do_not_optimize(await rawReplace()));
	bench('better-drizzle replace', async () =>
		do_not_optimize(await betterReplace()));
});

await run();
await client.query(`drop table if exists ${TABLE}`);
await client.end();
