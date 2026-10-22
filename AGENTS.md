# better-drizzle

Bun/TypeScript workspace. The root `package.json` publishes one package (`src/`, plugins as subpath exports under `src/plugins/*`); `apps/web` is the Next.js + Fumadocs docs site.

## Commands

- `bunx tsc --noEmit`: typecheck (test files are not typechecked; type assertions go in `tests/types/`)
- `bun run check:lint`: oxfmt + oxlint (Markdown and MDX are excluded)
- `bun run test`: SQLite suites
- `bun run test:databases`: `*.pg`, `*.mysql`, `*.redis` tests; they skip without `DATABASE_URL`, `MYSQL_URL`, `REDIS_URL`
- `bun run build` / `bun run pack`: tsdown build; run it after changing exports (declaration generation can fail where `tsc` passes)
- `cd apps/web && bun run typecheck`: docs site

## Rules

- Wrapper overhead is benchmarked against raw Drizzle. In `src/shared/client/operations.ts`, `src/shared/query/compiler.ts`, and `src/shared/client/context.ts`, avoid new allocations, spreads, and helpers on hot paths.
- Benchmarks compare equal work: when better-drizzle returns nested rows or pagination metadata, the raw Drizzle side must build the same shape (`bun run bench:verify` checks parity).
- Library errors are `BetterDrizzleError`; invalid caller input is `INVALID_ARGS`.
- Docs pages live in `apps/web/content/docs`; the sidebar order is `apps/web/content/docs/meta.json`. Pair better-drizzle examples with a raw Drizzle tab, and never use `db.query.*` in the Drizzle tab.

## Gotchas

- Reads are lazy thenables, not promises: they run on the first `then`. Wrap them in `Promise.resolve()` for `expect(...).resolves/.rejects` in Bun.
- MySQL has no `RETURNING`: single-row writes that do not pin one row run read + write in a transaction with `FOR UPDATE`, and `create` reads the row back by key.
- `drizzle-orm` is pinned to `>=1.0.0-rc.5 <1.0.0-rc.6` (RQB v2); tables and relations come from `db._.relations`, and column `dataType` is `"<type> <constraint>"` (compare prefixes).
- Do not walk the schema recursively in prepared-statement param types; it breaks `Awaited<ReturnType<...>>` with TS2321.
- Core `endsWith` intentionally keeps SQL wildcards; `contains` and `startsWith` escape them.
- `better-drizzle/auth` reads the client's runtime context through `client[Symbol.for('better-drizzle/context')]`; its tests run Better Auth's official adapter suite under `bun test` (`tests/auth/suite.ts`).
