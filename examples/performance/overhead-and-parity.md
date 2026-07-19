# Overhead and parity

The repository has one hard benchmarking rule:

> compare equivalent work, not just equivalent SQL count.

## Good parity comparisons

- `findMany()` with `include` against a raw Drizzle query that also loads those relations
- `paginate()` against a manual flow that returns rows plus offset pagination metadata
- `cursor()` against a manual flow that returns rows plus cursor navigation metadata
- soft delete plugin behavior against a manual implementation that performs the same visibility and delete rewrite logic

## Bad comparisons

- a nested repository payload against a flat SQL join
- a query helper with pagination metadata against a raw query that returns rows only
- a plugin-enabled mutation path against a baseline that skips the same side effects

## Practical interpretation

Sometimes a lower-level manual query will beat the wrapper. That is expected.
The relevant question is whether the wrapper stayed small for the amount of behavior it added.

## Headline rule

Do not use the manual reference numbers as the main claim about wrapper overhead.
Use API parity first.
