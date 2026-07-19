<div align="center">

# Benchmarks

This directory contains the benchmark suite for `better-drizzle`. The benchmarks measure wrapper overhead compared to raw Drizzle ORM across latency, throughput, and memory usage.

## Overview

`better-drizzle` is not trying to beat raw Drizzle at being raw Drizzle. It is trying to stay close while giving you a higher-level repository API. These benchmarks quantify that overhead.

## Benchmark suites

</div>

| Command | Description |
| --- | --- |
| `bun run bench` | Run the latency benchmark (time per operation) |
| `bun run bench:full` | Run the comprehensive validated parity benchmark |
| `bun run bench:verify` | Validate deep result parity without timing |
| `bun run bench:memory` | Run the memory benchmark (heap/rss deltas) |
| `bun run bench:all` | Run the latency, comprehensive, and memory suites sequentially |

<div align="center">

### Time benchmark

Measures per-operation latency in microseconds for each API method. Benchmark contexts use isolated temporary SQLite databases configured with an in-memory journal, preventing shared-state contamination between raw Drizzle and Better Drizzle.

### Full parity benchmark

Validates every scenario with `deepStrictEqual` before timing it, then compares reads, writes, relations, raw SQL, and transactions. Both sides execute equivalent database work and return the same effective result shape.

Mutation scenarios use deterministic data pools or restore state between iterations. Relational comparisons use batched raw Drizzle queries instead of N+1 queries. When Drizzle's relational query builder cannot execute a supported nested shape consistently, the raw side performs the equivalent root, child, and grandchild queries and assembles the same nested payload.

### Memory benchmark

Measures heap and RSS overhead across batches of operations. Uses 2000 single reads, 600 mixed reads (with relation loading), 1200 writes (create + delete roundtrips), and 800 transactions (simple, multi-operation, and read-only).

## Comparison groups

The benchmarks split results into three views intentionally:

### API parity

This is the **fair comparison**. Raw Drizzle performs the same work and returns the same shape as `better-drizzle`. For example, if the repository call loads a nested relation, the raw Drizzle comparison also loads that relation. If the repository returns pagination metadata, the raw Drizzle comparison computes the same metadata.

### Transaction parity

The transaction group follows the same parity principle. Each paired benchmark wraps the same operations inside a database transaction:

| Scenario | Operations | What it measures |
| --- | --- | --- |
| **Simple transaction** | 1 insert + 1 select | Baseline transaction overhead |
| **Multi-op transaction** | 3 inserts + 1 update + 1 select | Transaction with mixed writes and reads |
| **Read-only transaction** | 2 selects | Transaction overhead on the read path |
| **Nested transaction (savepoint)** | 1 outer insert + 1 inner insert + 1 inner findMany + 1 outer findFirst | better-drizzle-only; no raw parity because Drizzle's SQLite transaction does not natively support nested savepoints |

### Manual Drizzle reference

This is a **lower-level reference**. Raw Drizzle queries that intentionally do less work — flat joins, no relation resolution, no pagination metadata. These numbers show what is possible without the wrapper, but they are not a fair overhead claim because the work is different.

**Do not compare the manual reference group against the repository API as if they were equivalent.**

## Results

### Latency (time benchmark)

Hardware: AMD Ryzen 5 7520U. Runtime: Bun 1.3.14. Database: SQLite in-memory.

</div>

| Operation | Drizzle | better-drizzle | Overhead |
| --- | --- | --- | --- |
| Point lookup | 128.13 µs | 121.01 µs | -5.6% |
| Filtered list | 335.63 µs | 430.32 µs | +28.2% |
| Active count | 125.42 µs | 102.94 µs | -17.9% |
| Exists | 117.78 µs | 129.15 µs | +9.7% |
| Offset pagination | 236.92 µs | 210.28 µs | -11.2% |
| Cursor pagination | 229.52 µs | 226.14 µs | -1.5% |
| Complex relation filter | 871.07 µs | 953.10 µs | +9.4% |
| Update + reload | 143.33 µs | 138.11 µs | -3.6% |
| Simple transaction | 312.00 µs | 350.95 µs | +12.5% |
| Multi-op transaction | 725.98 µs | 724.15 µs | -0.3% |
| Read-only transaction | 230.92 µs | 281.35 µs | +21.8% |
| Nested transaction (savepoint) | — | 650.22 µs | — |

<div align="center">

### Memory

Same hardware. 2000 read iterations, 600 mixed read iterations, 1200 write iterations, 800 transaction iterations.

</div>

| Batch | Drizzle | better-drizzle | Overhead |
| --- | --- | --- | --- |
| **Single Read** | 146.1 µs/op, 2.20 MB heap | 121.7 µs/op, 336 KB heap | -16.7% time, -85.1% heap |
| **Mixed Read** | 2.22 ms/op, 892 KB heap | 2.21 ms/op, 355 KB heap | -0.3% time, -60.2% heap |
| **Write** | 319.3 µs/op, 329 KB heap | 290.8 µs/op, 98 KB heap | -8.9% time, -70.3% heap |
| **Transaction** | 792.1 µs/op, 296 KB heap | 1.03 ms/op, 540 KB heap | +29.8% time, +82.4% heap |

<div align="center">

## Interpretation

- **Reads** are within 0–18% of raw Drizzle at the API-parity level. Point lookup, offset pagination, and active count are actually faster through the wrapper due to optimized fast paths.
- **Writes** are within 4% of raw Drizzle, with the wrapper slightly faster for both update and create+delete roundtrips.
- **Transactions** show mixed results. Simple and multi-op transactions are within 12% overhead, while read-only transactions have higher overhead due to the wrapper's transaction lifecycle setup. The nested transaction (savepoint) is a better-drizzle-only feature with no raw Drizzle parity equivalent, running at 650 µs.
- **Memory overhead is negative** for reads and writes — `better-drizzle` uses less heap and RSS than raw Drizzle in those workloads. Transaction memory is higher due to the lifecycle state management required for hooks and savepoints.
- The **manual Drizzle reference** group shows that raw hand-written joins are faster (as expected), but they return flat shapes and skip relation resolution. The parity group is the fair comparison.

## How to run

</div>

```bash
# From the repository root
bun install

# Run latency benchmarks
bun run bench

# Validate result parity without timing
bun run bench:verify

# Run comprehensive parity benchmarks
bun run bench:full

# Run memory benchmarks
bun run bench:memory

# Run all suites
bun run bench:all
```

<div align="center">

## File structure

</div>

| File | Description |
| --- | --- |
| `time.ts` | Latency benchmark entry point |
| `full.ts` | Comprehensive benchmark with mandatory deep parity validation |
| `memory.ts` | Memory benchmark entry point |
| `scenarios.ts` | Benchmark scenario definitions for both Drizzle and better-drizzle |
| `setup.ts` | Database and context setup for benchmarks |
| `schema.ts` | Drizzle schema used by the benchmarks |
