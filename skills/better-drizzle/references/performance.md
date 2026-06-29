# Performance

Read this file for any change that touches hot paths, benchmarks, or public performance claims.

## Hot files

- `packages/core/src/shared/client/operations.ts`
- `packages/core/src/shared/query/compiler.ts`
- `packages/core/src/shared/client/context.ts`

## Repo bias

- fewer branches
- fewer allocations
- fewer helpers
- fewer layers
- native-first query paths when safely possible

## Avoid

- unnecessary object spreads in hot paths
- wrappers around logic used once or twice
- abstraction-only normalization layers
- slow read-then-write upsert flows
- benchmark claims based on non-parity comparisons

## Required validation

When performance-sensitive code changes:

- run `bun run bench`
- run `bun run bench:memory`
- interpret results against the parity suite first

## Agent checks

- challenge code that adds helpers without clear runtime value
- challenge code that allocates intermediate objects in tight loops
- do not present manual drizzle reference numbers as parity claims
