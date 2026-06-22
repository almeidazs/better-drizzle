import { bench, do_not_optimize, group, run, summary } from 'mitata';

import {
	betterActiveCount,
	betterComplexJoinEquivalent,
	betterCreateDeleteRoundtrip,
	betterCursorPaginate,
	betterExists,
	betterFilteredList,
	betterOffsetPaginate,
	betterPointLookup,
	betterRelationGraph,
	betterUpdateAndLoad,
	rawActiveCount,
	rawComplexJoinFlat,
	rawComplexRelationFilter,
	rawCreateDeleteBare,
	rawCreateDeleteRoundtrip,
	rawCursorPaginate,
	rawExists,
	rawFilteredList,
	rawOffsetPaginate,
	rawPointLookup,
	rawRelationGraph,
	rawUpdateAndLoad,
} from './scenarios';
import { createBenchmarkContext } from './setup';

const rawContext = createBenchmarkContext();
const betterContext = createBenchmarkContext();

group('api parity: reads', () => {
	summary(() => {
		bench('drizzle: point lookup', async () =>
			do_not_optimize(await rawPointLookup(rawContext)),
		);
		bench('better: point lookup', async () =>
			do_not_optimize(await betterPointLookup(betterContext)),
		);

		bench('drizzle: filtered list', async () =>
			do_not_optimize(await rawFilteredList(rawContext)),
		);
		bench('better: filtered list', async () =>
			do_not_optimize(await betterFilteredList(betterContext)),
		);

		bench('drizzle: relation graph', async () =>
			do_not_optimize(await rawRelationGraph(rawContext)),
		);
		bench('better: relation graph', async () =>
			do_not_optimize(await betterRelationGraph(betterContext)),
		);

		bench('drizzle: active count', async () =>
			do_not_optimize(await rawActiveCount(rawContext)),
		);
		bench('better: active count', async () =>
			do_not_optimize(await betterActiveCount(betterContext)),
		);

		bench('drizzle: exists', async () =>
			do_not_optimize(await rawExists(rawContext)),
		);
		bench('better: exists', async () =>
			do_not_optimize(await betterExists(betterContext)),
		);

		bench('drizzle: offset pagination', async () =>
			do_not_optimize(await rawOffsetPaginate(rawContext)),
		);
		bench('better: offset pagination', async () =>
			do_not_optimize(await betterOffsetPaginate(betterContext)),
		);

		bench('drizzle: cursor pagination', async () =>
			do_not_optimize(await rawCursorPaginate(rawContext)),
		);
		bench('better: cursor pagination', async () =>
			do_not_optimize(await betterCursorPaginate(betterContext)),
		);

		bench('drizzle: complex relation filter', async () =>
			do_not_optimize(await rawComplexRelationFilter(rawContext)),
		);
		bench('better: complex relation filter', async () =>
			do_not_optimize(await betterComplexJoinEquivalent(betterContext)),
		);
	});
});

group('api parity: writes', () => {
	summary(() => {
		bench('drizzle: create + delete roundtrip', async () =>
			do_not_optimize(await rawCreateDeleteRoundtrip(rawContext)),
		);
		bench('better: create + delete roundtrip', async () =>
			do_not_optimize(await betterCreateDeleteRoundtrip(betterContext)),
		);

		bench('drizzle: update + reload', async () =>
			do_not_optimize(await rawUpdateAndLoad(rawContext)),
		);
		bench('better: update + reload', async () =>
			do_not_optimize(await betterUpdateAndLoad(betterContext)),
		);
	});
});

group('manual drizzle reference', () => {
	summary(() => {
		bench('drizzle manual: complex join flat', async () =>
			do_not_optimize(await rawComplexJoinFlat(rawContext)),
		);
		bench('drizzle parity: complex relation filter', async () =>
			do_not_optimize(await rawComplexRelationFilter(rawContext)),
		);
		bench('better: complex relation filter', async () =>
			do_not_optimize(await betterComplexJoinEquivalent(betterContext)),
		);

		bench('drizzle parity: create + delete roundtrip', async () =>
			do_not_optimize(await rawCreateDeleteRoundtrip(rawContext)),
		);
		bench('better: create + delete roundtrip', async () =>
			do_not_optimize(await betterCreateDeleteRoundtrip(betterContext)),
		);
		bench('drizzle manual: create + delete bare', async () =>
			do_not_optimize(await rawCreateDeleteBare(rawContext)),
		);
	});
});

await run();

rawContext.close();
betterContext.close();
