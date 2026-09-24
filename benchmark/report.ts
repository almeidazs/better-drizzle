import { deepStrictEqual } from 'node:assert';

import { measure } from 'mitata';

import {
	betterActiveCount,
	betterCreateDeleteRoundtrip,
	betterCursorPaginate,
	betterExists,
	betterFilteredList,
	betterMultiOpTransaction,
	betterOffsetPaginate,
	betterPointLookup,
	betterReadOnlyTransaction,
	betterRelationCounts,
	betterRelationGraph,
	betterSimpleTransaction,
	betterUpdateAndLoad,
	rawActiveCount,
	rawCreateDeleteRoundtrip,
	rawCursorPaginate,
	rawExists,
	rawFilteredList,
	rawMultiOpTransaction,
	rawOffsetPaginate,
	rawPointLookup,
	rawReadOnlyTransaction,
	rawRelationCounts,
	rawRelationGraph,
	rawSimpleTransaction,
	rawUpdateAndLoad,
} from './scenarios';
import { type BenchmarkContext, createBenchmarkContext } from './setup';

/**
 * Absolute timings drift with machine load between runs, but the raw/better
 * ratio is stable. This report interleaves both sides inside one sampling
 * window so drift cancels, then reports the median ratio across samples -
 * numbers that survive being run on a different machine.
 */
type Operation = (context: BenchmarkContext) => Promise<unknown>;
type Pair = readonly [string, Operation, Operation];

const READS: readonly Pair[] = [
	['Point lookup', rawPointLookup, betterPointLookup],
	['Filtered list', rawFilteredList, betterFilteredList],
	['Relation graph', rawRelationGraph, betterRelationGraph],
	['Relation counts', rawRelationCounts, betterRelationCounts],
	['Active count', rawActiveCount, betterActiveCount],
	['Exists', rawExists, betterExists],
	['Offset pagination', rawOffsetPaginate, betterOffsetPaginate],
	['Cursor pagination', rawCursorPaginate, betterCursorPaginate],
];

const WRITES: readonly Pair[] = [
	[
		'Create + delete roundtrip',
		rawCreateDeleteRoundtrip,
		betterCreateDeleteRoundtrip,
	],
	['Update + reload', rawUpdateAndLoad, betterUpdateAndLoad],
];

const TRANSACTIONS: readonly Pair[] = [
	['Simple transaction', rawSimpleTransaction, betterSimpleTransaction],
	['Multi-op transaction', rawMultiOpTransaction, betterMultiOpTransaction],
	[
		'Read-only transaction',
		rawReadOnlyTransaction,
		betterReadOnlyTransaction,
	],
];

const SAMPLES = Number(Bun.env.BENCH_SAMPLES ?? 7);

const median = (values: readonly number[]) => {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Measurement is delegated to mitata's engine so warmup, JIT settling, GC
 * accounting and outlier trimming match `bun run bench` exactly. Only the
 * scheduling around it - interleaving and the median across samples - is ours.
 */
const timeOnce = async (operation: Operation, context: BenchmarkContext) => {
	const stats = await measure(async () => {
		await operation(context);
	});
	return stats.p50;
};

type Measurement = {
	name: string;
	raw: number;
	better: number;
	ratio: number;
};

const measurePairs = async (pairs: readonly Pair[]): Promise<Measurement[]> => {
	const context = createBenchmarkContext();
	const results: Measurement[] = [];

	try {
		for (const [name, rawOperation, betterOperation] of pairs) {
			const rawSamples: number[] = [];
			const betterSamples: number[] = [];

			// Alternate the leading side so a warming or cooling machine does
			// not systematically favour whichever one is measured first.
			for (let sample = 0; sample < SAMPLES; sample += 1) {
				if (sample % 2 === 0) {
					rawSamples.push(await timeOnce(rawOperation, context));
					betterSamples.push(
						await timeOnce(betterOperation, context),
					);
				} else {
					betterSamples.push(
						await timeOnce(betterOperation, context),
					);
					rawSamples.push(await timeOnce(rawOperation, context));
				}
			}

			const raw = median(rawSamples);
			const better = median(betterSamples);
			results.push({ name, raw, better, ratio: better / raw });
		}
	} finally {
		context.close();
	}

	return results;
};

const verifyParity = async (pairs: readonly Pair[]) => {
	const context = createBenchmarkContext();
	try {
		for (const [name, rawOperation, betterOperation] of pairs) {
			if (name.includes('transaction') || name.includes('Create'))
				continue;
			deepStrictEqual(
				await betterOperation(context),
				await rawOperation(context),
				`Parity failed: ${name}`,
			);
		}
	} finally {
		context.close();
	}
};

const microseconds = (nanoseconds: number) =>
	nanoseconds >= 1_000_000
		? `${(nanoseconds / 1_000_000).toFixed(2)} ms`
		: `${(nanoseconds / 1_000).toFixed(2)} µs`;

const overhead = (ratio: number) => {
	const percent = (ratio - 1) * 100;
	if (Math.abs(percent) < 100)
		return `${percent >= 0 ? '+' : '−'}${Math.abs(percent).toFixed(1)}%`;
	return ratio < 1
		? `**${(1 / ratio).toFixed(1)}× faster**`
		: `${ratio.toFixed(1)}× slower`;
};

const table = (title: string, rows: readonly Measurement[]) => {
	const lines = [
		`### ${title}`,
		'',
		'| Operation | Drizzle | better-drizzle | Overhead |',
		'| --- | --- | --- | --- |',
	];
	for (const row of rows)
		lines.push(
			`| ${row.name} | ${microseconds(row.raw)} | ${microseconds(row.better)} | ${overhead(row.ratio)} |`,
		);
	return `${lines.join('\n')}\n`;
};

await verifyParity(READS);
console.error('Report parity validation passed.');

const reads = await measurePairs(READS);
const writes = await measurePairs(WRITES);
const transactions = await measurePairs(TRANSACTIONS);

console.log(
	[
		`<!-- generated by \`bun run bench:report\` -->`,
		`<!-- mitata p50, ${SAMPLES} interleaved samples, median of samples -->`,
		'',
		table('Reads', reads),
		table('Writes', writes),
		table('Transactions', transactions),
	].join('\n'),
);
