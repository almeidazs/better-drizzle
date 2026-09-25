import { getTableColumns } from 'drizzle-orm';
import {
	boolean,
	integer,
	pgTable,
	serial,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core';
import { bench, do_not_optimize, group, run, summary } from 'mitata';
import { z } from 'zod';

import { createAtaSchemasRegistry } from '../src/plugins/ata/shared/registry';
import { createZodSchemasRegistry } from '../src/plugins/zod/shared/registry';

/**
 * The two validation plugins on the same table, without a database.
 *
 * What is being compared is the work each plugin does per operation: building
 * and compiling a table's schemas once, then validating a payload, a set of
 * query arguments, and a page of results.
 *
 * Fairness notes, because they change the numbers:
 *
 * - zod runs with `unknownKeys: 'strict'`. Its default is `strip`, which refuses
 *   nothing and allocates a narrowed copy of every accepted object. ata refuses
 *   an unknown key instead, so `strict` is the setting where the two answer the
 *   same question. Measuring against `strip` would compare validation against
 *   validation plus a rebuild.
 * - Coercion is off. ata does not coerce at all, so leaving zod's coercion on
 *   would be charging it for a feature the other side does not offer.
 * - Every cold case builds a fresh registry from a fresh schema object. ata
 *   caches a compiled validator against the schema object it was given, so
 *   reusing one would report the cache rather than the compile.
 * - Every warm case rotates over a pool of distinct payload objects rather than
 *   validating one hoisted constant. With a single constant input V8 folds the
 *   whole call away: a hand-written predicate for the same constraints measured
 *   65 picoseconds that way, which is not a validation cost, it is the absence
 *   of one. Rotating inputs also keeps the accepting and rejecting paths from
 *   being predicted perfectly, which is closer to a real workload than either
 *   extreme.
 */

/** Rotate over a pool so nothing is a compile-time constant. */
const rotate = <T>(pool: readonly T[]) => {
	let i = 0;
	return () => pool[i++ % pool.length] as T;
};

const POOL = 64;

const users = pgTable('users', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 80 }).notNull(),
	email: varchar('email', { length: 120 }).notNull(),
	active: boolean('active').notNull().default(true),
	age: integer('age'),
	created: timestamp('created').notNull().defaultNow(),
});

const table = () => ({ users });
const columns = getTableColumns(users);
const columnKeys = Object.keys(columns);

const ZOD_BEHAVIOR = { behavior: { unknownKeys: 'strict' as const } };

// --- the payloads -----------------------------------------------------------

const goodCreate = { email: 'ada@example.com', name: 'ada' };
// wrong type on the second column, so both sides walk about as far in
const badCreate = { email: 'ada@example.com', name: 42 };
const goodQuery = {
	orderBy: { name: 'asc' as const },
	skip: 0,
	take: 20,
	where: { active: true, age: { gte: 18 } },
};
const badQuery = { ordrBy: { name: 'asc' }, where: { active: true } };

const nextGoodCreate = rotate(
	Array.from({ length: POOL }, (_, i) => ({
		email: `user${i}@example.com`,
		name: `user ${i}`,
	})),
);
const nextBadCreate = rotate(
	Array.from({ length: POOL }, (_, i) => ({
		email: `user${i}@example.com`,
		name: i,
	})),
);
const nextGoodQuery = rotate(
	Array.from({ length: POOL }, (_, i) => ({
		orderBy: { name: 'asc' as const },
		skip: i,
		take: 20,
		where: { active: true, age: { gte: i } },
	})),
);
const nextBadQuery = rotate(
	Array.from({ length: POOL }, (_, i) => ({
		ordrBy: { name: 'asc' },
		where: { active: true, age: { gte: i } },
	})),
);
const nextRow = rotate(
	Array.from({ length: POOL }, (_, i) => ({
		active: true,
		age: 20 + i,
		created: new Date(Date.UTC(2026, 0, 1 + (i % 28))),
		email: `user${i}@example.com`,
		id: i + 1,
		name: `user ${i}`,
	})),
);

const row = {
	active: true,
	age: 36,
	created: new Date('2026-01-01T00:00:00Z'),
	email: 'ada@example.com',
	id: 1,
	name: 'ada',
};
const page = Array.from({ length: 100 }, (_, i) => ({ ...row, id: i + 1 }));

// --- warm validators --------------------------------------------------------

const ataRegistry = createAtaSchemasRegistry(table());
const zodRegistry = createZodSchemasRegistry(table() as never, ZOD_BEHAVIOR);

const ataCreate = ataRegistry.getCreate('users');
const ataQuery = ataRegistry.getQueryArgs('users');
const ataRow = ataRegistry.get('users')?.schemas.row;
const ataPage = ataRegistry.getResult('users', true);

const zodEntry = zodRegistry.get('users');
const zodCreate = zodEntry?.schemas.create;
const zodQuery = zodRegistry.getQueryArgsSchema('users');
const zodRow = zodEntry?.schemas.select;
// The zod plugin checks a batch result with `z.array(row)`, so the page case
// uses that rather than a loop of per-row parses, which would charge zod a
// hundred call overheads ata does not pay.
const zodPage = z.array(zodRow ?? z.unknown());

group('cold: build and compile one table', () => {
	summary(() => {
		bench('ata: registry + compile create', () => {
			const registry = createAtaSchemasRegistry(table());
			// compile, which is what a first call pays for
			do_not_optimize(registry.getCreate('users').validate(goodCreate));
		});
		bench('zod: registry + first parse', () => {
			const registry = createZodSchemasRegistry(
				table() as never,
				ZOD_BEHAVIOR,
			);
			do_not_optimize(
				registry.get('users')?.schemas.create.safeParse(goodCreate),
			);
		});
	});
});

group('warm: accept a create payload', () => {
	summary(() => {
		bench('ata', () =>
			do_not_optimize(ataCreate.validate(nextGoodCreate()).valid));
		bench('zod', () =>
			do_not_optimize(zodCreate?.safeParse(nextGoodCreate()).success));
	});
});

group('warm: reject a create payload', () => {
	summary(() => {
		bench('ata', () =>
			do_not_optimize(ataCreate.validate(nextBadCreate()).valid));
		bench('zod', () =>
			do_not_optimize(zodCreate?.safeParse(nextBadCreate()).success));
	});
});

group('warm: reject a create payload, reading the errors', () => {
	summary(() => {
		bench('ata', () =>
			do_not_optimize(
				ataCreate.validate(nextBadCreate()).errors?.length,
			));
		bench('zod', () =>
			do_not_optimize(
				zodCreate?.safeParse(nextBadCreate()).error?.issues.length,
			));
	});
});

group('warm: accept query arguments', () => {
	summary(() => {
		bench('ata', () =>
			do_not_optimize(ataQuery.validate(nextGoodQuery()).valid));
		bench('zod', () =>
			do_not_optimize(zodQuery.safeParse(nextGoodQuery()).success));
	});
});

group('warm: reject query arguments (misspelled argument)', () => {
	summary(() => {
		bench('ata', () =>
			do_not_optimize(ataQuery.validate(nextBadQuery()).valid));
		bench('zod', () =>
			do_not_optimize(zodQuery.safeParse(nextBadQuery()).success));
	});
});

group('warm: one result row', () => {
	summary(() => {
		bench('ata', () => do_not_optimize(ataRow?.validate(nextRow()).valid));
		bench('zod', () =>
			do_not_optimize(zodRow?.safeParse(nextRow()).success));
	});
});

group('warm: a page of 100 result rows', () => {
	summary(() => {
		bench('ata', () => do_not_optimize(ataPage.validate(page)));
		bench('zod', () => do_not_optimize(zodPage.safeParse(page)));
	});
});

await run();

// --- what the two actually answered, so a wrong verdict cannot look fast ----

const agree = (label: string, a: boolean, z: boolean, want: boolean) => {
	const mark = a === want && z === want ? 'ok  ' : 'FAIL';
	console.log(`${mark} ${label}: ata=${a} zod=${z} expected=${want}`);
};

console.log('\nverdict agreement');
agree(
	'create, good',
	ataCreate.validate(goodCreate).valid,
	zodCreate?.safeParse(goodCreate).success ?? false,
	true,
);
agree(
	'create, bad',
	ataCreate.validate(badCreate).valid,
	zodCreate?.safeParse(badCreate).success ?? false,
	false,
);
agree(
	'query, good',
	ataQuery.validate(goodQuery).valid,
	zodQuery.safeParse(goodQuery).success,
	true,
);
agree(
	'query, bad',
	ataQuery.validate(badQuery).valid,
	zodQuery.safeParse(badQuery).success,
	false,
);
agree(
	'row',
	ataRow?.validate(row).valid ?? false,
	zodRow?.safeParse(row).success ?? false,
	true,
);

console.log(`\ncolumns: ${columnKeys.length} (${columnKeys.join(', ')})`);
