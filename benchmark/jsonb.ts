import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core';
import { bench, do_not_optimize, run } from 'mitata';
import { Client } from 'pg';
import { better } from '../packages/core/src';

type Metadata = { profile: { age: number; active: boolean; name: string } };
const events = pgTable('better_drizzle_jsonb_benchmark_events', {
	id: integer('id').primaryKey(),
	metadata: jsonb('metadata').$type<Metadata>().notNull(),
});
const schema = { events };
const connectionString = process.env.DATABASE_URL;
if (!connectionString)
	throw new Error('DATABASE_URL is required for the JSONB benchmark.');
const client = new Client({ connectionString });
await client.connect();
await client.query(
	'drop table if exists better_drizzle_jsonb_benchmark_events',
);
await client.query(
	'create table better_drizzle_jsonb_benchmark_events (id integer primary key, metadata jsonb not null)',
);
await client.query(
	"create index better_drizzle_jsonb_benchmark_age_idx on better_drizzle_jsonb_benchmark_events (((metadata #>> '{profile,age}')::numeric))",
);
const values: unknown[] = [];
const placeholders: string[] = [];
for (let id = 1; id <= 100_000; id += 1) {
	placeholders.push(`(${values.length + 1}, ${values.length + 2}::jsonb)`);
	values.push(
		id,
		JSON.stringify({
			profile: {
				age: 18 + (id % 60),
				active: id % 2 === 0,
				name: `User ${id}`,
			},
		}),
	);
}
await client.query(
	'insert into better_drizzle_jsonb_benchmark_events (id, metadata) values ' +
		placeholders.join(', '),
	values,
);
const raw = drizzle(client, { schema });
const db = better(raw, { schema }) as unknown as {
	events: { findMany(args: unknown): Promise<unknown> };
};
bench('drizzle: JSONB profile.age >= 40', async () =>
	do_not_optimize(
		await raw
			.select()
			.from(events)
			.where(
				sql`jsonb_typeof(${events.metadata} #> ARRAY['profile', 'age']::text[]) = 'number' and (${events.metadata} #>> ARRAY['profile', 'age']::text[])::numeric >= 40`,
			),
	),
);
bench('better: JSONB profile.age >= 40', async () =>
	do_not_optimize(
		await db.events.findMany({
			where: { metadata: { json: { 'profile.age': { gte: 40 } } } },
		}),
	),
);
await run();
await client.query(
	'drop table if exists better_drizzle_jsonb_benchmark_events',
);
await client.end();
