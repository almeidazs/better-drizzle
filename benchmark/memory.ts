import {
	betterActiveCount,
	betterComplexJoinEquivalent,
	betterCreateDeleteRoundtrip,
	betterCursorPaginate,
	betterExists,
	betterFilteredList,
	betterMultiOpTransaction,
	betterNestedTransaction,
	betterOffsetPaginate,
	betterPointLookup,
	betterReadOnlyTransaction,
	betterRelationCounts,
	betterRelationGraph,
	betterSimpleTransaction,
	betterUpdateAndLoad,
	rawActiveCount,
	rawComplexRelationFilter,
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
import {
	type BenchmarkContext,
	createBenchmarkContext,
	resetGc,
	snapshotMemory,
} from './setup';

type MemorySnapshot = ReturnType<typeof snapshotMemory>;

type SuiteResult = {
	durationMs: number;
	heapDelta: number;
	heapPeak: number;
	nsPerOp: number;
	opsPerSec: number;
	rssDelta: number;
	rssPeak: number;
};

const formatBytes = (value: number) => {
	const units = ['B', 'KB', 'MB', 'GB'];
	let amount = Math.abs(value);
	let unitIndex = 0;

	while (amount >= 1024 && unitIndex < units.length - 1) {
		amount /= 1024;
		unitIndex += 1;
	}

	const sign = value < 0 ? '-' : '';
	return `${sign}${amount.toFixed(2)} ${units[unitIndex]}`;
};

const formatPct = (base: number, next: number) => {
	if (base === 0) return 'n/a';
	return `${(((next - base) / base) * 100).toFixed(2)}%`;
};

const samplePeak = (peak: MemorySnapshot) => {
	const current = snapshotMemory();

	return {
		arrayBuffers: Math.max(peak.arrayBuffers, current.arrayBuffers),
		external: Math.max(peak.external, current.external),
		heapTotal: Math.max(peak.heapTotal, current.heapTotal),
		heapUsed: Math.max(peak.heapUsed, current.heapUsed),
		rss: Math.max(peak.rss, current.rss),
	};
};

const measure = async (
	iterations: number,
	execute: (context: BenchmarkContext, iteration: number) => Promise<void>,
) => {
	const context = createBenchmarkContext();

	resetGc();
	const before = snapshotMemory();
	let peak = before;
	const start = Bun.nanoseconds();

	for (let iteration = 0; iteration < iterations; iteration += 1) {
		await execute(context, iteration);
		if (iteration % 25 === 0) peak = samplePeak(peak);
	}

	const end = Bun.nanoseconds();
	peak = samplePeak(peak);
	resetGc();
	const after = snapshotMemory();
	context.close();

	const durationNs = end - start;

	return {
		durationMs: durationNs / 1_000_000,
		heapDelta: after.heapUsed - before.heapUsed,
		heapPeak: peak.heapUsed - before.heapUsed,
		nsPerOp: durationNs / iterations,
		opsPerSec: (iterations * 1_000_000_000) / durationNs,
		rssDelta: after.rss - before.rss,
		rssPeak: peak.rss - before.rss,
	} satisfies SuiteResult;
};

const runReadSuite = async (
	_label: string,
	execute: (context: BenchmarkContext) => Promise<unknown>,
) => measure(2_000, async (context) => void (await execute(context)));

const runMixedReadSuite = async (
	_label: string,
	execute: {
		activeCount(context: BenchmarkContext): Promise<unknown>;
		cursor(context: BenchmarkContext): Promise<unknown>;
		exists(context: BenchmarkContext): Promise<unknown>;
		complex(context: BenchmarkContext): Promise<unknown>;
		filtered(context: BenchmarkContext): Promise<unknown>;
		offset(context: BenchmarkContext): Promise<unknown>;
		point(context: BenchmarkContext): Promise<unknown>;
		relation(context: BenchmarkContext): Promise<unknown>;
	},
) =>
	measure(600, async (context, iteration) => {
		await execute.point(context);
		await execute.filtered(context);
		if (iteration % 2 === 0) await execute.activeCount(context);
		if (iteration % 3 === 0) await execute.exists(context);
		if (iteration % 4 === 0) await execute.offset(context);
		if (iteration % 5 === 0) await execute.cursor(context);
		if (iteration % 6 === 0) await execute.relation(context);
		if (iteration % 7 === 0) await execute.complex(context);
	});

const runWriteSuite = async (
	_label: string,
	execute: {
		createDelete(context: BenchmarkContext): Promise<unknown>;
		update(context: BenchmarkContext): Promise<unknown>;
	},
) =>
	measure(1_200, async (context, iteration) => {
		await execute.update(context);
		if (iteration % 2 === 0) await execute.createDelete(context);
	});

const runTransactionSuite = async (
	_label: string,
	execute: {
		simple(context: BenchmarkContext): Promise<unknown>;
		multiOp(context: BenchmarkContext): Promise<unknown>;
		readOnly(context: BenchmarkContext): Promise<unknown>;
		nested?(context: BenchmarkContext): Promise<unknown>;
	},
) =>
	measure(800, async (context, iteration) => {
		await execute.simple(context);
		if (iteration % 2 === 0) await execute.multiOp(context);
		if (iteration % 3 === 0) await execute.readOnly(context);
		if (execute.nested && iteration % 4 === 0)
			await execute.nested(context);
	});

const printSuite = (title: string, raw: SuiteResult, better: SuiteResult) => {
	console.log(`\n${title}`);
	console.log(
		`raw    time=${raw.durationMs.toFixed(2)}ms ops/s=${raw.opsPerSec.toFixed(2)} ns/op=${raw.nsPerOp.toFixed(2)} heapΔ=${formatBytes(raw.heapDelta)} rssΔ=${formatBytes(raw.rssDelta)} heapPeak=${formatBytes(raw.heapPeak)} rssPeak=${formatBytes(raw.rssPeak)}`,
	);
	console.log(
		`better time=${better.durationMs.toFixed(2)}ms ops/s=${better.opsPerSec.toFixed(2)} ns/op=${better.nsPerOp.toFixed(2)} heapΔ=${formatBytes(better.heapDelta)} rssΔ=${formatBytes(better.rssDelta)} heapPeak=${formatBytes(better.heapPeak)} rssPeak=${formatBytes(better.rssPeak)}`,
	);
	console.log(
		`overhead time=${formatPct(raw.durationMs, better.durationMs)} ns/op=${formatPct(raw.nsPerOp, better.nsPerOp)} heapΔ=${formatPct(raw.heapDelta, better.heapDelta)} rssΔ=${formatPct(raw.rssDelta, better.rssDelta)}`,
	);
};

const rawSingleRead = await runReadSuite('raw point', rawPointLookup);
const betterSingleRead = await runReadSuite('better point', betterPointLookup);
const rawRelationCountRead = await runReadSuite(
	'raw relation counts',
	rawRelationCounts,
);
const betterRelationCountRead = await runReadSuite(
	'better relation counts',
	betterRelationCounts,
);

const rawMixedReads = await runMixedReadSuite('raw mixed', {
	activeCount: rawActiveCount,
	cursor: rawCursorPaginate,
	exists: rawExists,
	complex: rawComplexRelationFilter,
	filtered: rawFilteredList,
	offset: rawOffsetPaginate,
	point: rawPointLookup,
	relation: rawRelationGraph,
});
const betterMixedReads = await runMixedReadSuite('better mixed', {
	activeCount: betterActiveCount,
	complex: betterComplexJoinEquivalent,
	cursor: betterCursorPaginate,
	exists: betterExists,
	filtered: betterFilteredList,
	offset: betterOffsetPaginate,
	point: betterPointLookup,
	relation: betterRelationGraph,
});

const rawWrites = await runWriteSuite('raw writes', {
	createDelete: rawCreateDeleteRoundtrip,
	update: rawUpdateAndLoad,
});
const betterWrites = await runWriteSuite('better writes', {
	createDelete: betterCreateDeleteRoundtrip,
	update: betterUpdateAndLoad,
});

const rawTransactions = await runTransactionSuite('raw transactions', {
	multiOp: rawMultiOpTransaction,
	readOnly: rawReadOnlyTransaction,
	simple: rawSimpleTransaction,
});
const betterTransactions = await runTransactionSuite('better transactions', {
	multiOp: betterMultiOpTransaction,
	nested: betterNestedTransaction,
	readOnly: betterReadOnlyTransaction,
	simple: betterSimpleTransaction,
});

console.log('Benchmark memory and overhead summary');
printSuite('Single Read Batch', rawSingleRead, betterSingleRead);
printSuite(
	'Relation Count Batch',
	rawRelationCountRead,
	betterRelationCountRead,
);
printSuite('Mixed Read Batch', rawMixedReads, betterMixedReads);
printSuite('Write Batch', rawWrites, betterWrites);
printSuite('Transaction Batch', rawTransactions, betterTransactions);
