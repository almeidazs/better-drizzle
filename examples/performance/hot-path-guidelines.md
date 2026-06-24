# Hot-path guidelines

These notes exist because `better-drizzle` is intentionally measured against raw Drizzle.

## Files that matter most

- `packages/core/src/shared/client/operations.ts`
- `packages/core/src/shared/query/compiler.ts`
- `packages/core/src/shared/client/context.ts`

## What usually hurts

- extra object spreads in hot paths
- helpers that only rename or normalize data for aesthetics
- repeated relation or schema work that could be precomputed
- read-then-write flows where the dialect can do native conflict handling

## What usually helps

- direct fast paths for common reads
- direct fast paths for simple writes
- precomputed table metadata
- keeping query compilation shallow on common cases

## Documentation tie-in

If you add a performance-sensitive feature, update the examples and README wording so claims still match the benchmark shape.
