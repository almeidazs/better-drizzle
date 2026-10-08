import { deepStrictEqual } from 'node:assert';

import { bench, do_not_optimize, group, run, summary } from 'mitata';

import {
	betterActiveCount,
	betterAtomicUpdateAndLoad,
	betterComplexJoinEquivalent,
	betterCreateDeleteRoundtrip,
	betterCursorPaginate,
	betterExists,
	betterFilteredList,
	betterMultiOpTransaction,
	betterNullsLastOrder,
	betterNestedTransaction,
	betterOffsetPaginate,
	betterPointLookup,
	betterReadOnlyTransaction,
	betterRelationCountOrder,
	betterRelationFieldOrder,
	betterThroughCountOrder,
	betterRelationCounts,
	betterRelationGraph,
	betterSimpleTransaction,
	betterUpdateAndLoad,
	createBetterPreparedScenarios,
	createRawPreparedScenarios,
	rawActiveCount,
	rawAtomicUpdateAndLoad,
	rawComplexJoinFlat,
	rawComplexRelationFilter,
	rawCreateDeleteBare,
	rawCreateDeleteRoundtrip,
	rawCursorManualOneQuery,
	rawCursorPaginate,
	rawExists,
	rawFilteredList,
	rawMultiOpTransaction,
	rawNullsLastOrder,
	rawOffsetPaginate,
	rawPointLookup,
	rawReadOnlyTransaction,
	rawRelationCountOrder,
	rawRelationFieldOrder,
	rawThroughCountOrder,
	rawRelationCounts,
	rawRelationGraph,
	rawSimpleTransaction,
	rawUpdateAndLoad,
} from './scenarios';
import { createBenchmarkContext } from './setup';

const rawContext = createBenchmarkContext();
const betterContext = createBenchmarkContext();

const [rawNullsLast, betterNullsLast] = await Promise.all([
	rawNullsLastOrder(rawContext),
	betterNullsLastOrder(betterContext),
]);
if (
	rawNullsLast.map((row: { id: number }) => row.id).join(',') !==
	betterNullsLast.map((row: { id: number }) => row.id).join(',')
)
	throw new Error('NULLS LAST benchmark parity validation failed.');

const relationOrderPairs = [
	[
		'one relation field order',
		rawRelationFieldOrder,
		betterRelationFieldOrder,
	],
	['to-many count order', rawRelationCountOrder, betterRelationCountOrder],
	['through count order', rawThroughCountOrder, betterThroughCountOrder],
] as const;
for (const [name, raw, better] of relationOrderPairs)
	deepStrictEqual(
		await better(betterContext),
		await raw(rawContext),
		`Relation order benchmark parity failed: ${name}`,
	);

group('api parity: reads', () => {
	summary(() => {
		bench('drizzle: point lookup', async () =>
			do_not_optimize(await rawPointLookup(rawContext)));
		bench('better: point lookup', async () =>
			do_not_optimize(await betterPointLookup(betterContext)));

		bench('drizzle: filtered list', async () =>
			do_not_optimize(await rawFilteredList(rawContext)));
		bench('better: filtered list', async () =>
			do_not_optimize(await betterFilteredList(betterContext)));

		bench('drizzle: NULLS LAST order', async () =>
			do_not_optimize(await rawNullsLastOrder(rawContext)));
		bench('better: NULLS LAST order', async () =>
			do_not_optimize(await betterNullsLastOrder(betterContext)));

		for (const [name, raw, better] of relationOrderPairs) {
			bench(`drizzle: ${name}`, async () =>
				do_not_optimize(await raw(rawContext)));
			bench(`better: ${name}`, async () =>
				do_not_optimize(await better(betterContext)));
		}

		bench('drizzle: relation graph', async () =>
			do_not_optimize(await rawRelationGraph(rawContext)));
		bench('better: relation graph', async () =>
			do_not_optimize(await betterRelationGraph(betterContext)));

		bench('drizzle: relation counts', async () =>
			do_not_optimize(await rawRelationCounts(rawContext)));
		bench('better: relation counts', async () =>
			do_not_optimize(await betterRelationCounts(betterContext)));

		bench('drizzle: active count', async () =>
			do_not_optimize(await rawActiveCount(rawContext)));
		bench('better: active count', async () =>
			do_not_optimize(await betterActiveCount(betterContext)));

		bench('drizzle: exists', async () =>
			do_not_optimize(await rawExists(rawContext)));
		bench('better: exists', async () =>
			do_not_optimize(await betterExists(betterContext)));

		bench('drizzle: offset pagination', async () =>
			do_not_optimize(await rawOffsetPaginate(rawContext)));
		bench('better: offset pagination', async () =>
			do_not_optimize(await betterOffsetPaginate(betterContext)));

		bench('drizzle: cursor pagination', async () =>
			do_not_optimize(await rawCursorPaginate(rawContext)));
		bench('better: cursor pagination', async () =>
			do_not_optimize(await betterCursorPaginate(betterContext)));

		bench('drizzle: complex relation filter', async () =>
			do_not_optimize(await rawComplexRelationFilter(rawContext)));
		bench('better: complex relation filter', async () =>
			do_not_optimize(await betterComplexJoinEquivalent(betterContext)));
	});
});

const rawPrepared = createRawPreparedScenarios(rawContext);
const betterPrepared = createBetterPreparedScenarios(betterContext);

group('api parity: prepared reads', () => {
	summary(() => {
		for (const scenario of [
			'pointLookup',
			'filteredList',
			'activeCount',
			'offsetPaginate',
			'cursorPaginate',
		] as const) {
			bench(`drizzle prepared: ${scenario}`, async () =>
				do_not_optimize(await rawPrepared[scenario]()));
			bench(`better prepared: ${scenario}`, async () =>
				do_not_optimize(await betterPrepared[scenario]()));
		}
		bench('better unprepared: pointLookup', async () =>
			do_not_optimize(await betterPointLookup(betterContext)));
	});
});

group('api parity: writes', () => {
	summary(() => {
		bench('drizzle: create + delete roundtrip', async () =>
			do_not_optimize(await rawCreateDeleteRoundtrip(rawContext)));
		bench('better: create + delete roundtrip', async () =>
			do_not_optimize(await betterCreateDeleteRoundtrip(betterContext)));

		bench('drizzle: update + reload', async () =>
			do_not_optimize(await rawUpdateAndLoad(rawContext)));
		bench('better: update + reload', async () =>
			do_not_optimize(await betterUpdateAndLoad(betterContext)));

		bench('drizzle: atomic update + reload', async () =>
			do_not_optimize(await rawAtomicUpdateAndLoad(rawContext)));
		bench('better: atomic update + reload', async () =>
			do_not_optimize(await betterAtomicUpdateAndLoad(betterContext)));
	});
});

group('api parity: transactions', () => {
	summary(() => {
		bench('drizzle: simple transaction', async () =>
			do_not_optimize(await rawSimpleTransaction(rawContext)));
		bench('better: simple transaction', async () =>
			do_not_optimize(await betterSimpleTransaction(betterContext)));

		bench('drizzle: multi-op transaction', async () =>
			do_not_optimize(await rawMultiOpTransaction(rawContext)));
		bench('better: multi-op transaction', async () =>
			do_not_optimize(await betterMultiOpTransaction(betterContext)));

		bench('drizzle: read-only transaction', async () =>
			do_not_optimize(await rawReadOnlyTransaction(rawContext)));
		bench('better: read-only transaction', async () =>
			do_not_optimize(await betterReadOnlyTransaction(betterContext)));

		bench('better: nested transaction (savepoint)', async () =>
			do_not_optimize(await betterNestedTransaction(betterContext)));
	});
});

group('manual drizzle reference', () => {
	summary(() => {
		bench('drizzle manual: cursor data only', async () =>
			do_not_optimize(await rawCursorManualOneQuery(rawContext)));
		bench('drizzle manual: complex join flat', async () =>
			do_not_optimize(await rawComplexJoinFlat(rawContext)));
		bench('drizzle parity: complex relation filter', async () =>
			do_not_optimize(await rawComplexRelationFilter(rawContext)));
		bench('better: complex relation filter', async () =>
			do_not_optimize(await betterComplexJoinEquivalent(betterContext)));

		bench('drizzle parity: create + delete roundtrip', async () =>
			do_not_optimize(await rawCreateDeleteRoundtrip(rawContext)));
		bench('better: create + delete roundtrip', async () =>
			do_not_optimize(await betterCreateDeleteRoundtrip(betterContext)));
		bench('drizzle manual: create + delete bare', async () =>
			do_not_optimize(await rawCreateDeleteBare(rawContext)));
	});
});

await run();

rawContext.close();
betterContext.close();
