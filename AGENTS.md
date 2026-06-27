# Better-Drizzle Repository – Agent Field Notes

> Meta note: This is the primary agent knowledge base file for this repository. When learning something about the codebase that will help with future tasks, update this file directly.

- **Repository scope**: `better-drizzle` is a small Bun/TypeScript workspace focused on a single core package, `packages/core`, plus a benchmark suite used to measure API-parity performance and memory overhead against raw Drizzle ORM.
- **Workspace layout**:
  - `packages/core`: the published library
  - `packages/soft-delete`: official soft delete plugin
  - `packages/timestamps`: official timestamps plugin
  - `benchmark`: Bun + SQLite benchmark suite
  - `examples`: Markdown-only example catalog and usage guides
  - `README.md`: project-level documentation
  - `packages/core/README.md`: package-level documentation, currently intentionally kept in sync with the root README
- **Package manager and runtime**: Bun is the primary runtime for local commands and benchmarks. The workspace is configured as a TypeScript ESM monorepo.
- **Package publishing/build**:
  - all published workspace libraries now build to `dist/`
  - each package emits `dist/index.js` (ESM), `dist/index.cjs` (CommonJS), and `dist/index.d.ts`
  - root build entrypoint is `scripts/build.ts`, powered by `Bun.build` plus `tsc` declaration emit
  - keep package bundle minification disabled in `scripts/build.ts`; the published 0.1.0 minified Bun build produced broken export footers (`dist/index.js`/`dist/index.cjs`) with unresolved symbols at import time
  - package manifests publish only `dist`, `README.md`, and `LICENSE`
- **Top-level scripts**:
  - `bun run bench`: run the time benchmark suite
  - `bun run bench:memory`: run the memory/overhead benchmark suite
  - `bun run bench:all`: run both benchmark suites
- **Core dependencies**:
  - `drizzle-orm` as a peer dependency
  - `typescript` as a peer dependency
  - `mitata` for benchmarking
  - `@biomejs/biome` for formatting and linting
  - the published compatibility floor is `drizzle-orm@^0.30.0`; `0.29.5` failed the workspace typecheck, while `0.30.0` passed typecheck plus the core/plugin test suites

## Architecture

- **Entry point**: `packages/core/src/index.ts`
  - Exports `better(...)`
  - Exports `definePlugin(...)`
  - Delegates root/transaction client binding to `packages/core/src/shared/client/factory.ts`
  - Builds a base runtime context once
  - Initializes plugins once during bootstrap
  - Re-binds delegates/extensions per bound client (`db` or `tx`) without re-running plugin setup
  - Registers repositories by TypeScript table key and database table name
- **Runtime layout**:
  - `packages/core/src/shared/client/context.ts`: builds the runtime context and precomputed table metadata
  - `packages/core/src/shared/client/delegate.ts`: exposes the delegate methods for each table
  - `packages/core/src/shared/client/factory.ts`: binds root and transaction clients, retries, nested savepoints, and transaction lifecycle hooks
  - `packages/core/src/shared/client/operations.ts`: main query and mutation execution paths; this is the hottest file for performance work
  - `packages/core/src/shared/client/hooks.ts`: optional hook execution
  - `packages/core/src/shared/client/plugins.ts`: plugin initialization, validation, transform pipeline, and extension application
  - `packages/core/src/shared/query/compiler.ts`: compiles typed `where`, `select`, `include`, `orderBy`, and pagination inputs into Drizzle-compatible query pieces
  - `packages/core/src/shared/errors.ts`: shared error helpers
  - `packages/core/src/types/*`: public type surface
- **No internal runtime package**: the old `packages/core/src/internal/runtime.ts` was removed. Runtime logic now lives under `shared/client` and `shared/query`.

## Design intent

- **Primary goal**: give Drizzle users a minimal repository-style API without hiding Drizzle or rebuilding a full ORM on top of it.
- **Non-goals**:
  - not replacing raw Drizzle for fully manual query work
  - not adding broad abstraction layers
  - not adding runtime magic that duplicates schema knowledge
- **Bias**: prefer simpler code, fewer branches, fewer allocations, fewer helpers, and fewer layers.

## API surface

- **Table delegates expose**:
  - `findMany`
  - `findFirst`
  - `findOne`
  - `findUnique`
  - `create`
  - `createMany`
  - `update`
  - `updateEach`
  - `updateMany`
  - `delete`
  - `deleteMany`
  - `upsert`
  - `upsertMany`
  - `count`
  - `exists`
  - `paginate`
  - `$withState`
  - `$withoutPlugins`
- **Create conflict handling**:
  - `create` and `createMany` accept `skipDuplicates`
  - supported forms: `true` or `readonly ColumnName[]`
  - `skipDuplicates: true` makes `create` return `null` when the insert is skipped
  - `createMany.count` reflects only rows actually inserted when conflicts are ignored
  - explicit column arrays map to schema column names; targeted duplicate-skip is intentionally dialect-sensitive
- **Client-level lookup**:
  - `repository(name)` resolves by schema key or db table name
- **Scoped metadata**:
  - `db.$withContext(meta)` returns a cloned client that merges default `meta` into every repository operation, raw SQL call, and transaction lifecycle payload
  - final operation metadata is a shallow merge: scoped context first, per-call `meta` second
  - `transaction(options.meta)` and raw `options.meta` participate in the same merge and can override scoped keys
- **Transactions**:
  - `db.transaction(callback, options?)` is the official API
  - transaction clients are full Better Drizzle clients with `transaction`, `rollback`, `afterCommit`, and `afterRollback`
  - transaction context lives on the runtime context; operation/plugin hooks can read `isInTransaction`, `transaction`, `transactionContext`, and merged `meta`
  - nested transactions use savepoints; SQLite is handled with explicit `BEGIN`/`SAVEPOINT` SQL because Bun SQLite's native Drizzle transaction callback is synchronous
- **Raw SQL**:
  - raw APIs live on the client: `$raw`, `$executeRaw`, and `$rawUnsafe`
  - safe raw calls accept tagged templates or Drizzle `sql` objects; plain strings are only allowed through `$rawUnsafe`
  - `raw.allowUnsafe` defaults to disabled and gates `$rawUnsafe`
  - raw execution bypasses model transforms and CRUD hooks, but has dedicated client/plugin hooks: `beforeRaw`, `afterRaw`, and `onRawError`
  - raw hooks now receive merged `meta`, including defaults from `$withContext(...)` and per-call `RawOptions.meta`
  - raw queries still bind to transaction-scoped Drizzle clients inside `db.transaction(...)`
  - SQLite raw reads use `db.all(...)` and raw execute uses `db.run(...)`; pg/mysql-style drivers use `db.execute(...)`
- **Plugin composition**:
  - plugin ids must be unique
  - plugins run in `options.plugins` array order
  - `setup()` runs exactly once during client initialization
  - plugins can extend built-in operation args through `operationArgs`; these fields are typed on delegates, plugin transforms, and client hooks
  - plugins can also observe transaction lifecycle through `beforeTransaction`, `afterTransactionCommit`, `afterTransactionRollback`, and `onTransactionError`
  - `config.requires.columns` fails fast during bootstrap if any model is incompatible
  - client hooks remain side-effect-only
  - plugin hooks/transforms are the mutation layer
  - `upsertMany` is a create-oriented hook/transform kind, matching `upsert` rather than `updateMany`
  - `updateEach` is an update-oriented batch operation with its own plugin kind, but it still flows through `beforeUpdate` / `afterUpdate`
- **Batch updateEach API**:
  - `updateEach` is native-first and performance-sensitive
  - it accepts `by`, `data`, `update`, optional `where`, optional scalar `select`, and `onEmpty`
  - it uses a single `UPDATE ... SET column = CASE ... END` style statement instead of userland loops
  - it rejects duplicate `by` values and relation selects should fail fast
- **Batch upsert API**:
  - `upsertMany` is native-first and performance-sensitive
  - it accepts `data`, explicit `target`, `update`, optional `select`, optional `batchSize`, and optional SQL `where`
  - it intentionally supports `select` but not relation `include`
  - unsupported dialect/feature combinations should fail fast instead of degrading to slow userland loops
- **Error model**:
  - runtime-thrown library errors should use `BetterDrizzleError` from `packages/core/src/shared/errors.ts`
  - `BetterDrizzleError` carries `message`, `status`, `code`, `driver`, and structured metadata such as `table`, `column`, `constraint`, `operation`, and `details`
  - `BetterDrizzleTransactionRollbackError` extends `BetterDrizzleError` and is the canonical rollback error shape
  - when normalizing external/database failures, prefer `BetterDrizzleError.from(...)` or `BetterDrizzleError.fromDatabaseError(...)` instead of throwing raw `Error`

## Performance rules

- **Performance matters here**: this repo explicitly benchmarks wrapper overhead. Do not add helpers, branching, abstractions, or allocations unless they clearly pay for themselves.
- **Hot files**:
  - `packages/core/src/shared/client/operations.ts`
  - `packages/core/src/shared/query/compiler.ts`
  - `packages/core/src/shared/client/context.ts`
- **Current optimization strategy**:
  - direct fast paths for simple reads
  - direct fast paths for simple writes
  - precomputed table and relation metadata
  - simple predicate compilation for hot common cases
  - native `onConflictDoUpdate` upsert path when safely possible
  - fewer intermediate objects in query compilation
- **Avoid**:
  - unnecessary object spreads in hot paths
  - generic wrappers around code used only once or twice
  - “normalization” layers that exist only for aesthetics
  - read-then-write upsert flows when native conflict update can be used
  - hand-wavy “clean” abstractions that add runtime overhead

## Benchmarking

- **Benchmark files**:
  - `benchmark/time.ts`: latency and throughput comparisons
  - `benchmark/memory.ts`: heap/rss deltas and overhead summaries
  - `benchmark/scenarios.ts`: benchmark scenarios for raw Drizzle and `better-drizzle`
  - `benchmark/setup.ts`: benchmark database/context setup
  - `benchmark/schema.ts`: benchmark schema
- **Benchmark rule**: parity matters. If `better-drizzle` returns nested objects, pagination metadata, or relation payloads, the raw Drizzle comparison must return the same effective shape and do the same effective work.
- **Two benchmark views exist intentionally**:
  - `api parity`: fair comparison where raw Drizzle and `better-drizzle` do the same work
  - `manual drizzle reference`: lower-level manual queries that intentionally do less work and are not parity claims
- **When changing performance-sensitive code**:
  - run `bun run bench`
  - run `bun run bench:memory`
  - interpret regressions against the parity suite first
  - do not use the manual reference numbers as the main headline for wrapper overhead claims

## Tooling and commands

- **Typecheck**:
  - `bunx tsc --noEmit`
- **Format and lint**:
  - `bunx @biomejs/biome check packages/core/src benchmark --write`
- **Recent style/tooling facts**:
  - TypeScript is `strict`
  - module resolution is `bundler`
  - formatting uses tabs, single quotes, trailing commas

## Local development database

- **Docker Compose** provides a Postgres 16 instance for local development and manual testing.
- **Files**:
  - `docker-compose.yml`: postgres service with healthcheck and persistent volume
  - `.env` / `.env.example`: connection config (port, credentials, db name)
  - `docker/postgres/init/01-schema.sql`: optional init SQL mirroring benchmark schema
- **Commands**:
  - `docker compose up -d`: start the database
  - `docker compose down`: stop the database
  - `docker compose logs -f postgres`: tail postgres logs
  - `docker compose down -v`: stop and wipe the volume
- **Connection**: `DATABASE_URL` in `.env` defaults to `postgresql://postgres:postgres@localhost:5432/better_drizzle`
- **Benchmarks still use SQLite in-memory**; this Postgres instance is for development, integration testing, and manual validation only.

## Style conventions for this repo

- **Keep code minimal**: this repository prefers the smallest functional implementation over layered abstractions.
- **Avoid over-engineering**:
  - remove tiny helpers if they do not pull their weight
  - remove aliases and conversion helpers if direct code is clearer and faster
  - keep public API small
- **Branch style**:
  - prefer `if (...) return ...` when a block is not needed
  - avoid braces in simple `if`/loop bodies when the language and clarity allow it
- **Data structures**:
  - prefer `Object.create(null)` for internal dictionaries where prototype behavior is unnecessary
  - prefer plain loops over extra array transforms in hot paths
- **Comments**:
  - keep comments sparse
  - use comments only where the reasoning is not obvious from code

## Documentation rules

- **README sync**: the root `README.md` and `packages/core/README.md` are intended to stay aligned. If one changes, update the other unless there is a clear package-specific reason not to.
- **Performance claims**: tie claims to benchmark shape and avoid vague “faster” language without context.
- **Examples**: prefer real API examples that match the current exported API and benchmarked usage patterns.
- **Examples catalog**: `examples/` is a Markdown-first reference library. Prefer adding focused topic pages under `basics`, `frameworks`, `plugins`, `performance`, and `cookbook` instead of growing one giant examples file.

## Change checklist

- **For API changes**:
  - update public types under `packages/core/src/types`
  - verify exports from `packages/core/src/index.ts`
  - update both READMEs if user-facing behavior changes
  - ensure examples still type-check conceptually against the current API
- **For performance changes**:
  - inspect hot-path allocations and branches
  - rerun both benchmark suites
  - keep raw parity scenarios fair
  - document any meaningful benchmark interpretation changes in README if needed
- **For benchmark changes**:
  - keep parity scenarios honest
  - keep manual references clearly separated
  - do not compare flat manual joins against nested repository payloads as if they were equivalent

## Repository history notes

- Recent work in this repository has focused on:
  - removing the old internal runtime file
  - moving logic into `shared/client` and `shared/query`
  - reducing wrapper overhead
  - making benchmarks fairer
  - improving README quality and positioning
- If future tasks discover important architectural or benchmarking constraints, add them here instead of leaving them buried in commit history.
