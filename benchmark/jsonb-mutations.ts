import { deepStrictEqual, ok } from 'node:assert';

import { count, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core';
import { bench, do_not_optimize, group, run, summary } from 'mitata';
import { Client } from 'pg';

import { better } from '../src';

type Metadata = {
	profile?:
		| {
				active?: boolean;
				age?: number;
				name?: string;
				status?: { label?: string };
		  }
		| string;
	preferences?: { alerts?: { weekly?: boolean }; email?: boolean };
	untouched?: { marker: string };
};

const TABLE = 'better_drizzle_jsonb_mutation_benchmark_events';
const ROWS = 500;

const events = pgTable(TABLE, {
	id: integer('id').primaryKey(),
	metadata: jsonb('metadata').$type<Metadata | null>(),
});
const schema = { events };

const connectionString = Bun.env.DATABASE_URL;
if (!connectionString)
	throw new Error(
		'DATABASE_URL is required for the JSONB mutation benchmark.',
	);

const client = new Client({ connectionString });
await client.connect();
await client.query(`drop table if exists ${TABLE}`);
await client.query(
	`create table ${TABLE} (id integer primary key, metadata jsonb)`,
);
await client.query(`
	insert into ${TABLE} (id, metadata)
	select g, case
		when g % 17 = 0 then null::jsonb
		when g % 19 = 0 then jsonb_build_object('profile', 'stale', 'untouched', jsonb_build_object('marker', 'keep-' || g))
		when g % 23 = 0 then '[]'::jsonb
		else jsonb_build_object(
			'profile', jsonb_build_object('active', g % 2 = 0, 'age', 18 + g % 60, 'name', 'User ' || g),
			'preferences', jsonb_build_object('email', g % 3 = 0, 'alerts', jsonb_build_object('weekly', g % 2 = 0)),
			'untouched', jsonb_build_object('marker', 'keep-' || g)
		)
	end
	from generate_series(1, ${ROWS}) g
`);

const raw = drizzle(client, { schema });
// oxlint-disable-next-line typescript/no-explicit-any -- Benchmark type erasure.
const db = better(raw, { schema }) as any;

type JsonbMutationNode = {
	children?: Map<string, JsonbMutationNode>;
	value?: SQL;
};

const compileJsonbPathNode = (base: SQL, node: JsonbMutationNode): SQL => {
	if (!node.children) return node.value!;
	const object = sql`case when jsonb_typeof(${base}) = 'object' then ${base} else '{}'::jsonb end`;
	let expression = object;

	for (const [key, child] of node.children) {
		const value =
			child.value ??
			compileJsonbPathNode(sql`(${object} -> ${key})`, child);
		expression = sql`jsonb_set(${expression}, ARRAY[${key}]::text[], ${value}, true)`;
	}
	return expression;
};

const patchExpression = (patch: Record<string, unknown>) => {
	const root: JsonbMutationNode = { children: new Map() };
	for (const [path, value] of Object.entries(patch)) {
		let node = root;
		for (const part of path.split('.')) {
			let child = node.children?.get(part);
			if (!child) {
				child = {};
				(node.children ??= new Map()).set(part, child);
			}
			node = child;
		}
		node.value = sql`${sql.param(JSON.stringify(value))}::jsonb`;
	}
	return compileJsonbPathNode(sql`${events.metadata}`, root);
};

const initialMetadata = (id: number): Metadata | null | unknown => {
	if (id % 17 === 0) return null;
	if (id % 19 === 0)
		return { profile: 'stale', untouched: { marker: `keep-${id}` } };
	if (id % 23 === 0) return [];
	return {
		profile: {
			active: id % 2 === 0,
			age: 18 + (id % 60),
			name: `User ${id}`,
		},
		preferences: {
			alerts: { weekly: id % 2 === 0 },
			email: id % 3 === 0,
		},
		untouched: { marker: `keep-${id}` },
	};
};

const reset = async (ids: readonly number[]) => {
	for (const id of ids) {
		const metadata = initialMetadata(id);
		await client.query(
			`update ${TABLE} set metadata = $1::jsonb where id = $2`,
			[metadata === null ? null : JSON.stringify(metadata), id],
		);
	}
};

const snapshot = async (ids: readonly number[]) =>
	raw
		.select({ id: events.id, metadata: events.metadata })
		.from(events)
		.where(inArray(events.id, [...ids]))
		.orderBy(events.id);

type Scenario = {
	name: string;
	ids: readonly number[];
	result: 'single' | 'count' | 'batch';
	raw: () => Promise<unknown>;
	better: () => Promise<unknown>;
};

const profilePatch = {
	'preferences.email': false,
	'profile.active': true,
	'profile.age': 42,
};

const nestedPatch = {
	'audit.lastSeen.source': 'web-app',
	'audit.lastSeen.timestamp': '2026-09-27T12:00:00.000Z',
	'preferences.alerts.weekly': false,
};

const fullDocument: Metadata = {
	profile: {
		active: true,
		age: 43,
		name: 'User profile replacement',
		status: { label: 'verified' },
	},
	preferences: {
		alerts: { weekly: true },
		email: false,
	},
	untouched: { marker: 'replaced document' },
};

const batchIds = Array.from({ length: 32 }, (_, index) => index + 80);
const eachRows = [17, 18, 19, 23].map((id, index) => ({
	age: 50 + index,
	id,
	patch: {
		'preferences.email': index % 2 === 0,
		'profile.age': 50 + index,
		'profile.status.label': `tier-${index + 1}`,
	},
}));
const manyUpsertIds = [34, 38, 57, 69] as const;

const rawUpdateMany = async (
	ids: readonly number[],
	patch: Record<string, unknown>,
) => {
	const matched = await raw
		.select({ count: count() })
		.from(events)
		.where(inArray(events.id, [...ids]));
	await raw
		.update(events)
		.set({ metadata: patchExpression(patch) })
		.where(inArray(events.id, [...ids]));
	return { count: matched[0]?.count ?? 0 };
};

const scenarios: readonly Scenario[] = [
	{
		name: 'update / full-document replacement',
		ids: [21],
		result: 'single',
		raw: async () => {
			const rows = await raw
				.update(events)
				.set({ metadata: fullDocument })
				.where(eq(events.id, 21))
				.returning();
			return rows[0];
		},
		better: () =>
			db.events.update({
				data: { metadata: fullDocument },
				where: { id: 21 },
			}),
	},
	{
		name: 'update / profile refresh (3 paths)',
		ids: [17],
		result: 'single',
		raw: async () => {
			const rows = await raw
				.update(events)
				.set({ metadata: patchExpression(profilePatch) })
				.where(eq(events.id, 17))
				.returning();
			return rows[0];
		},
		better: () =>
			db.events.update({
				data: { metadata: profilePatch },
				where: { id: 17 },
			}),
	},
	{
		name: 'update / nested audit creation (3 paths)',
		ids: [18],
		result: 'single',
		raw: async () => {
			const rows = await raw
				.update(events)
				.set({ metadata: patchExpression(nestedPatch) })
				.where(eq(events.id, 18))
				.returning();
			return rows[0];
		},
		better: () =>
			db.events.update({
				data: { metadata: nestedPatch },
				where: { id: 18 },
			}),
	},
	{
		name: 'updateMany / profile refresh (3 paths, 32 rows)',
		ids: batchIds,
		result: 'count',
		raw: () => rawUpdateMany(batchIds, profilePatch),
		better: async () => {
			const result = await db.events.updateMany({
				data: { metadata: profilePatch },
				where: { id: { in: [...batchIds] } },
			});
			return { count: result.count };
		},
	},
	{
		name: 'updateMany / nested audit creation (3 paths, 32 rows)',
		ids: batchIds,
		result: 'count',
		raw: () => rawUpdateMany(batchIds, nestedPatch),
		better: async () => {
			const result = await db.events.updateMany({
				data: { metadata: nestedPatch },
				where: { id: { in: [...batchIds] } },
			});
			return { count: result.count };
		},
	},
	{
		name: 'updateEach / row-specific profile and preference patch (4 rows)',
		ids: eachRows.map(({ id }) => id),
		result: 'count',
		raw: async () => {
			const matched = await raw
				.select({ count: count() })
				.from(events)
				.where(
					inArray(
						events.id,
						eachRows.map(({ id }) => id),
					),
				);
			const cases = eachRows.map(
				({ id, patch }) =>
					sql`when ${events.id} = ${id} then ${patchExpression(patch)}`,
			);
			await raw
				.update(events)
				.set({
					metadata: sql`case ${sql.join(cases, sql.raw(' '))} else ${events.metadata} end`,
				})
				.where(
					inArray(
						events.id,
						eachRows.map(({ id }) => id),
					),
				);
			return { count: matched[0]?.count ?? 0 };
		},
		better: async () => {
			const result = await db.events.updateEach({
				by: events.id,
				data: eachRows,
				update: {
					metadata: (row: (typeof eachRows)[number]) => row.patch,
				},
			});
			return { count: result.count };
		},
	},
	{
		name: 'upsert / profile refresh (3 paths)',
		ids: [34],
		result: 'single',
		raw: async () => {
			const rows = await raw
				.insert(events)
				.values({
					id: 34,
					metadata: initialMetadata(34) as Metadata | null,
				})
				.onConflictDoUpdate({
					set: { metadata: patchExpression(profilePatch) },
					target: events.id,
				})
				.returning();
			return rows[0];
		},
		better: () =>
			db.events.upsert({
				create: { id: 34, metadata: initialMetadata(34) },
				update: { metadata: profilePatch },
				where: { id: 34 },
			}),
	},
	{
		name: 'upsert / nested audit creation (3 paths)',
		ids: [34],
		result: 'single',
		raw: async () => {
			const rows = await raw
				.insert(events)
				.values({
					id: 34,
					metadata: initialMetadata(34) as Metadata | null,
				})
				.onConflictDoUpdate({
					set: { metadata: patchExpression(nestedPatch) },
					target: events.id,
				})
				.returning();
			return rows[0];
		},
		better: () =>
			db.events.upsert({
				create: { id: 34, metadata: initialMetadata(34) },
				update: { metadata: nestedPatch },
				where: { id: 34 },
			}),
	},
	{
		name: 'upsertMany / profile refresh (3 paths, 4 rows)',
		ids: manyUpsertIds,
		result: 'batch',
		raw: async () => {
			const rows = await raw
				.insert(events)
				.values(
					manyUpsertIds.map((id) => ({
						id,
						metadata: initialMetadata(id) as Metadata | null,
					})),
				)
				.onConflictDoUpdate({
					set: { metadata: patchExpression(profilePatch) },
					target: events.id,
				})
				.returning();
			return { count: rows.length, data: rows };
		},
		better: async () => {
			const result = await db.events.upsertMany({
				data: manyUpsertIds.map((id) => ({
					id,
					metadata: initialMetadata(id),
				})),
				target: 'id',
				update: { metadata: profilePatch },
			});
			return result;
		},
	},
	{
		name: 'upsertMany / nested audit creation (3 paths, 4 rows)',
		ids: manyUpsertIds,
		result: 'batch',
		raw: async () => {
			const rows = await raw
				.insert(events)
				.values(
					manyUpsertIds.map((id) => ({
						id,
						metadata: initialMetadata(id) as Metadata | null,
					})),
				)
				.onConflictDoUpdate({
					set: { metadata: patchExpression(nestedPatch) },
					target: events.id,
				})
				.returning();
			return { count: rows.length, data: rows };
		},
		better: async () => {
			const result = await db.events.upsertMany({
				data: manyUpsertIds.map((id) => ({
					id,
					metadata: initialMetadata(id),
				})),
				target: 'id',
				update: { metadata: nestedPatch },
			});
			return result;
		},
	},
];

const byId = <T extends { id: number }>(rows: readonly T[]) =>
	[...rows].sort((left, right) => left.id - right.id);

const normalizeResult = (kind: Scenario['result'], result: unknown) => {
	if (kind === 'single') return result;
	if (kind === 'count') return result;
	const batch = result as { count: number; data?: { id: number }[] };
	return {
		count: batch.count,
		data: batch.data ? byId(batch.data) : undefined,
	};
};

const verifyParity = async () => {
	for (const scenario of scenarios) {
		await reset(scenario.ids);
		const rawResult = await scenario.raw();
		const rawRows = await snapshot(scenario.ids);

		await reset(scenario.ids);
		const betterResult = await scenario.better();
		const betterRows = await snapshot(scenario.ids);

		deepStrictEqual(
			normalizeResult(scenario.result, betterResult),
			normalizeResult(scenario.result, rawResult),
			`Result parity failed: ${scenario.name}`,
		);
		deepStrictEqual(
			byId(betterRows),
			byId(rawRows),
			`Stored-row parity failed: ${scenario.name}`,
		);
		ok(
			rawRows.length === scenario.ids.length,
			`Missing rows: ${scenario.name}`,
		);
		console.log(`  ${scenario.name}: ${scenario.ids.length} rows matched`);
	}
};

try {
	console.log('PostgreSQL JSONB mutation parity validation:');
	await verifyParity();
	console.log('JSONB mutation parity validation passed.');

	if (Bun.env.BENCH_VERIFY_ONLY !== '1') {
		group('jsonb mutation parity', () => {
			summary(() => {
				for (const scenario of scenarios) {
					bench(`drizzle: ${scenario.name}`, async () =>
						do_not_optimize(await scenario.raw()));
					bench(`better: ${scenario.name}`, async () =>
						do_not_optimize(await scenario.better()));
				}
			});
		});
		await run();
	}
} finally {
	await client.query(`drop table if exists ${TABLE}`);
	await client.end();
}
