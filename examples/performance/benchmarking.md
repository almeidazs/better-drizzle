# Benchmarking

The repository maintains benchmark suites because performance is part of the product story here, not an afterthought.

## Commands

```bash
bun run bench
bun run bench:memory
bun run bench:all
```

## What the suites cover

- time and throughput comparisons
- memory and wrapper overhead
- API-parity scenarios
- manual Drizzle reference scenarios

## Benchmark files

- `benchmark/time.ts`
- `benchmark/memory.ts`
- `benchmark/scenarios.ts`
- `benchmark/setup.ts`
- `benchmark/schema.ts`

## What to look for first

When a regression appears:

1. verify parity before reading headline numbers
2. inspect hot-path allocations and branches
3. compare with the API-parity suite before using manual reference numbers

## Why parity matters

If `better-drizzle` returns nested objects, relation payloads, or pagination metadata, the raw Drizzle comparison must return the same effective shape and do the same effective work.
