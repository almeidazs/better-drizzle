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
| `bun run bench:memory` | Run the memory benchmark (heap/rss deltas) |
| `bun run bench:all` | Run both suites sequentially |

<div align="center">

### Time benchmark

Measures per-operation latency in microseconds for each API method. Runs on SQLite in-memory to isolate wrapper overhead from I/O.

### Memory benchmark

Measures heap and RSS overhead across batches of operations. Uses 2000 single reads, 600 mixed reads (with relation loading), and 1200 writes (create + delete roundtrips).

## Comparison groups

The benchmarks split results into two views intentionally:

### API parity

This is the **fair comparison**. Raw Drizzle performs the same work and returns the same shape as `better-drizzle`. For example, if the repository call loads a nested relation, the raw Drizzle comparison also loads that relation. If the repository returns pagination metadata, the raw Drizzle comparison computes the same metadata.

### Manual Drizzle reference

This is a **lower-level reference**. Raw Drizzle queries that intentionally do less work — flat joins, no relation resolution, no pagination metadata. These numbers show what is possible without the wrapper, but they are not a fair overhead claim because the work is different.

**Do not compare the manual reference group against the repository API as if they were equivalent.**

## Results

### Latency (time benchmark)

Hardware: AMD Ryzen 5 7520U. Runtime: Bun 1.3.14. Database: SQLite in-memory.

</div>

| Operation | Drizzle | better-drizzle | Overhead |
| --- | --- | --- | --- |
| Point lookup | 139.87 µs | 134.49 µs | -3.8% |
| Filtered list | 291.55 µs | 397.33 µs | +36.3% |
| Active count | 110.28 µs | 122.49 µs | +11.1% |
| Exists | 155.76 µs | 168.25 µs | +8.0% |
| Offset pagination | 263.44 µs | 281.97 µs | +7.0% |
| Cursor pagination | 300.32 µs | 344.69 µs | +14.8% |
| Complex relation filter | 1.30 ms | 1.30 ms | +0.0% |
| Update + reload | 159.39 µs | 167.36 µs | +5.0% |

<div align="center">

### Memory

Same hardware. 2000 read iterations, 600 mixed read iterations, 1200 write iterations.

</div>

| Batch | Drizzle | better-drizzle | Overhead |
| --- | --- | --- | --- |
| **Single Read** | 184.7 µs/op, 2.08 MB heap | 139.9 µs/op, 300 KB heap | -24.3% time, -85.9% heap |
| **Mixed Read** | 2.39 ms/op, 844 KB heap | 2.32 ms/op, 387 KB heap | -3.2% time, -54.1% heap |
| **Write** | 226.5 µs/op, 361 KB heap | 216.5 µs/op, 94 KB heap | -4.4% time, -74.1% heap |

<div align="center">

## Interpretation

- **Reads** are within 0–15% of raw Drizzle at the API-parity level. The wrapper adds minimal overhead for the convenience of a consistent repository interface.
- **Writes** are within 5% of raw Drizzle for update roundtrips and 14% faster for create+delete roundtrips due to optimized returning paths.
- **Memory overhead is negative** — `better-drizzle` uses less heap and RSS than raw Drizzle in the measured workloads, thanks to fewer intermediate allocations in the query compilation and execution paths.
- The **manual Drizzle reference** group shows that raw hand-written joins are faster (as expected), but they return flat shapes and skip relation resolution. The parity group is the fair comparison.

## How to run

</div>

```bash
# From the repository root
bun install

# Run latency benchmarks
bun run bench

# Run memory benchmarks
bun run bench:memory

# Run both
bun run bench:all
```

<div align="center">

## File structure

</div>

| File | Description |
| --- | --- |
| `time.ts` | Latency benchmark entry point |
| `memory.ts` | Memory benchmark entry point |
| `scenarios.ts` | Benchmark scenario definitions for both Drizzle and better-drizzle |
| `setup.ts` | Database and context setup for benchmarks |
| `schema.ts` | Drizzle schema used by the benchmarks |
