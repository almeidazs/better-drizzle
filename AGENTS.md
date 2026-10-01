# Better-Drizzle Repository – Agent Field Notes

> Meta note: This is the primary agent knowledge base file for this repository. When learning something about the codebase that will help with future tasks, update this file directly.

- **Repository scope**: `better-drizzle` is a small Bun/TypeScript workspace that publishes one package, plus a benchmark suite used to measure API-parity performance and memory overhead against raw Drizzle ORM.
- **Workspace layout**:
    - `src`: the published library
    - `src/plugins/rules`: official runtime rules/guardrails plugin
    - `src/plugins/eslint`: official ESLint plugin for static Better Drizzle guardrails
    - `src/plugins/soft-delete`: official soft delete plugin
    - `src/plugins/cache`: official read cache plugin; `src/plugins/cache/redis` is its Redis store
    - `src/plugins/timestamps`: official timestamps plugin
    - `src/plugins/zod`: official Zod schema generation and validation plugin
    - `benchmark`: Bun + SQLite benchmark suite
    - `apps/web`: Next.js + Fumadocs documentation/marketing site
    - `README.md`: package documentation
- **Package manager and runtime**: Bun is the primary runtime for local commands and benchmarks. The workspace is configured as a TypeScript ESM monorepo.
- **Package publishing/build**:
    - the root `package.json` is the only publishable manifest
    - tsdown emits minified, tree-shaken ESM, CommonJS, and declaration files for the root and each plugin subpath
    - public APIs are limited to `better-drizzle` plus `better-drizzle/{ata,cache,cache/redis,plugins,eslint,rules,soft-delete,timestamps,zod}` through conditional exports
    - `bun run pack` builds, checks every ESM/CJS export, then inspects the root tarball
- **Top-level scripts**:
    - `bun run bench`: run the time benchmark suite
    - `bun run bench:memory`: run the memory/overhead benchmark suite
    - `bun run bench:all`: run both benchmark suites
    - `bun run bench:report`: emit the overhead tables published on the docs site
    - `bun run bench:jsonb`: PostgreSQL JSONB parity suite; needs `DATABASE_URL`
- **Core dependencies**:
    - `drizzle-orm` as a peer dependency
    - `typescript` as a peer dependency
    - `mitata` for benchmarking
    - Ultracite presets with `oxfmt` and `oxlint` for formatting and linting
    - the peer range is `drizzle-orm@>=1.0.0-rc.4 <1.0.0-rc.5` (RQB v2); the typecheck fails against the 1.0.0-rc.5 snapshot, so the range stays capped until that is fixed; drizzle-orm 0.x is supported only by the `0.2.x` releases

## Architecture

- **Entry point**: `src/index.ts`
    - Exports `better(...)`
    - Exports `definePlugin(...)`
    - Delegates root/transaction client binding to `src/shared/client/factory.ts`
    - Builds a base runtime context once
    - Initializes plugins once during bootstrap
    - Re-binds delegates/extensions per bound client (`db` or `tx`) without re-running plugin setup
    - Reads tables and relations from the Drizzle instance (`db._.relations`, built by `drizzle({ relations })`); `better()` takes no `schema` option and fails fast when no tables are found
    - Registers repositories by TypeScript table key and database table name
- **Runtime layout**:
    - `src/shared/client/context.ts`: builds the runtime context and precomputed table metadata
    - `src/shared/client/delegate.ts`: exposes the delegate methods for each table
    - `src/shared/client/factory.ts`: binds root and transaction clients, retries, nested savepoints, and transaction lifecycle hooks
    - `src/shared/client/operations.ts`: main query and mutation execution paths; this is the hottest file for performance work
    - `src/shared/client/hooks.ts`: optional hook execution
    - `src/shared/client/plugins.ts`: plugin initialization, validation, transform pipeline, and extension application
    - `src/shared/query/compiler.ts`: compiles typed `where`, `select`, `include`, `orderBy`, and pagination inputs into Drizzle-compatible query pieces
    - `src/shared/errors.ts`: shared error helpers
    - `src/types/*`: public type surface
- **No internal runtime package**: the old `src/internal/runtime.ts` was removed. Runtime logic now lives under `shared/client` and `shared/query`.

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
    - `cursor`
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
    - `extends(objectOrFactory)` adds client-level helpers/properties and reapplies them to future `$withContext()` clones and transaction clients
    - callback form is the safer default when an extension method needs to reference the bound client instance
    - extensions must not override built-in or plugin-provided client keys; conflicts fail fast
- **Pagination split**:
    - `paginate()` is offset-only; it takes `page` + `perPage` (sugar for `skip` + `limit`, `page` cannot be combined with `skip`) and returns `{ data, pagination: { type: "offset", page, perPage, total, pageCount, hasNext, hasPrevious } }`
    - `cursor()` is the cursor-based API and returns `{ data, pagination: { type: "cursor", hasNext, hasPrevious, nextCursor, previousCursor } }`
    - cursor pagination accepts `before` or `after`, never both, and returns raw cursor objects by default
    - `orderBy` accepts direction strings or `{ direction, nulls: "first" | "last" }`; PostgreSQL/SQLite use native NULL ordering and MySQL emulates non-default placement with `IS NULL`
    - cursor tokens include every `orderBy` field; repeat the same order and include a unique, non-null tie-breaker to traverse rows sharing a nullable key
    - unsupported SQL dialects fail during client initialization instead of silently ignoring NULL placement
    - `count()` and `exists()` also honor `cursor` filters when provided, so helper queries stay aligned with cursor pagination semantics
- **Read query plans**:
    - read helpers (`findMany`, `findFirst`, `findOne`, `findUnique`, `count`, `exists`, `paginate`, `cursor`) now return explainable thenables with `.explain(options?)`
    - reads are lazy thenables (`ExplainableQuery` in `src/shared/client/hooks.ts`, modeled on Drizzle's `QueryPromise`): the operation starts on the first `then`/`catch`/`finally` and runs once; `.explain()` alone never runs the read or query hooks
    - they are deliberately not native promises: a pending native promise that starts lazily hangs Bun's `expect(...).resolves/.rejects`, while a thenable fails fast; tests wrap reads with `Promise.resolve(...)` for those matchers
    - plugin transforms still affect `.explain()`, but query hooks do not
    - explain output is cross-dialect and structured as `{ driver, operation, statements }`; unsupported explain flags are reported under `ignoredOptions`
    - PostgreSQL maps `analyze`, `verbose`, `costs`, `timing`, and `summary`; SQLite uses `EXPLAIN QUERY PLAN`; MySQL uses the best available `EXPLAIN` form and ignores unsupported flags
- **Relational reads**:
    - nested `select` and `include` use Better Drizzle's own batched loader rather than Drizzle's `db.query.*` path
    - the loader executes one root query plus one query per requested relation node, including `.through()` many-to-many nodes
    - nested `where`, `orderBy`, `cursor`, `take`, `skip`, `select`, and `include` are supported; per-parent pagination uses `row_number()` window queries
    - internal linking columns are selected as needed and removed from the public payload
    - `select` and `include` are mutually exclusive at every level
    - `.explain()` reports non-root relation stages under `deferredRelations`
    - `include._count.select` projects relation totals as correlated subqueries in the SQL for the current query level; selectors accept `true` or `{ where }`, support one/many/many-to-many relations, and do not add count round-trips
- **Relational writes**:
    - `create` supports relation `connect`; `update` supports `connect`, `disconnect`, and exclusive `set`; `upsert` follows the corresponding create/update branch rules
    - relation selectors must be non-empty and match exactly one row
    - relation writes run in an implicit transaction when no transaction is already active and preserve delegate plugin state
    - many-to-many comes only from native `.through()` relations (no junction inference); relations with a relation-level `where` or `one` relations through a junction are recorded as unsupported and throw when used
    - a `one` relation owns the foreign key (connect writes the source columns) unless its `from` columns are exactly the source primary key and its `to` columns are not the target primary key
    - batch mutation APIs intentionally remain scalar-only
- **Row locks**:
    - read helpers built on `QueryArgs` (`findMany`, `findFirst`, `findOne`, `findUnique`, `paginate`, `cursor`) accept `lock`
    - `count`, `exists`, and write operations do not accept `lock`
    - PostgreSQL and MySQL are supported; SQLite should fail fast with a lock-specific error
    - `skipLocked` and `noWait` are mutually exclusive
    - `locks.transactionsOnly` can enforce that locked reads only run inside transactions
    - lock support intentionally rejects general relation loading (`include` / relation `select`) instead of silently dropping the lock, since nested stages run as separate queries
- **Scoped metadata**:
    - `db.$withContext(meta)` returns a cloned client that merges default `meta` into every repository operation, raw SQL call, and transaction lifecycle payload
    - final operation metadata is a shallow merge: scoped context first, per-call `meta` second
    - `transaction(options.meta)` and raw `options.meta` participate in the same merge and can override scoped keys
- **Transactions**:
    - `db.transaction(callback, options?)` is the official API
    - transaction clients are full Better Drizzle clients with `transaction`, `rollback`, `afterCommit`, and `afterRollback`
    - root clients also expose `afterCommit` and `afterRollback`; calling them outside an active transaction throws the explicit Better Drizzle error instead of failing with a missing method
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
    - `src/plugins/rules` is intentionally runtime-only and hook-driven; it enforces only checks that can be inferred from current hook payloads and silently ignores unsupported rule types
    - `src/plugins/rules` accepts boolean rule settings as shorthand: `true` means `error`, `false` means `off`
    - `src/plugins/soft-delete` filters every read and every update/delete with a `where` (`deleted` arg on each); `upsert`/`upsertMany` and relation loads stay unfiltered. Soft `delete`/`deleteMany` run in `beforeDelete` (before transforms), so they apply the visibility filter themselves. Writes with an empty `where` are core no-ops and must stay no-ops: the plugin only adds its filter when the original `where` has a condition. `mode: 'hard'` matches deleted rows unless `deleted` is passed
    - `intercept(ctx)` is the only plugin primitive that wraps execution: it runs inside `executeOperation` after before hooks, transforms, and the client before hook, so it sees final args. Plugins compose outermost-first; `next()` resolves a before-hook override without SQL; `annotate()` reaches client and plugin after hooks as `annotations`; `skipAfterHooks()` skips both. `.explain()` never runs intercepts. Buckets track `hasIntercepts`, so clients without intercepts keep the old path
    - `PluginModelInfo` exposes `primaryKey` (column keys) and `relations` (`{ model, kind, foreignKey: 'source' | 'target' | 'junction', through? }`), filled after `buildRelations`
    - `RawOptions` includes the augmentable `RawOptionsExtensions` interface, and raw calls forward unknown options to raw hooks in `rawOptions`
    - `src/plugins/cache` does reads and invalidation in one intercept. Keys hash the post-transform args minus `cache`/`meta`, plus tags, per-call `vary`, and the `vary()` option. Entries store `[dependency versions, empty]\n<serialized>`. A hit needs every version to match, and `emptyOnly` versions (model rows for primary key lookups) are compared only for empty results. Versions are random tokens that live for `versionTtl`, and entry TTLs are clamped to it, so an expired version key cannot revive a stale entry. Writes bump rows plus entity versions when the `where` pins primary keys; otherwise they bump the model epoch. Deletes also bump the epoch of models whose declared relation holds a foreign key to the deleted model (DB cascades). Inside a transaction, targets queue per transaction client through `afterCommit` and are dropped on rollback. The in-flight dedup key includes the dependency versions, so a read that starts after an invalidation cannot join an older query. The plugin is documented as experimental in 0.3.x (its API, store interface, and entry format may change in a patch). There is no public memory store; `tests/cache/memory-store.ts` is a test fake, and `tests/cache/suite.ts` runs against both it and Redis (`REDIS_URL`, `bun run test:redis`)
    - Cache identity preserves `orderBy` priority and JSON filter operand order (SQLite compares encoded JSON text). Cyclic keys bypass caching; lossy result values are rejected rather than silently changed. Missing dependency versions receive fresh tokens before SQL, coalesced for identical cold reads; never store a null version sentinel, which can revive stale entries after expiry or eviction. Manual custom-key invalidation also bumps a `v:k` dependency so delayed readers cannot repopulate a valid stale entry.
    - Cache cascade dependencies and referenced columns are precomputed from native relations at setup, including inverse-only, transitive, and self references. `updateEach.by` is a Drizzle column instance, not a column key. Successful raw/commit observers and queued commit callbacks all run even when an earlier observer throws; the first error still propagates. No-op mutations skip automatic version writes, but explicit invalidation hints still apply.
    - `bun run bench:cache` measures cache costs with mitata and validates complete result parity first. Map stores isolate local overhead; set `REDIS_URL` for real Redis measurements. `CACHE_BENCH_VERIFY_ONLY=1` skips timings and `CACHE_BENCH_FILTER` selects scenarios. Bulk entity invalidation sends one Redis SET per targeted entity; cluster reads issue GET per key.
    - `src/plugins/soft-delete` writes ISO 8601 values for string-backed delete timestamp columns and `Date` values for Drizzle date columns; this preserves SQLite text-column compatibility while retaining native timestamp encoders
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
    - MySQL uses `ON DUPLICATE KEY UPDATE` with `values(col)` for excluded values; because it fires on any unique key, `assertMysqlUpsertTarget` requires the target to equal the primary key or one unique key and rejects rows that set, or static defaults that fill, another unique key. `where` is rejected and `count` is the number of rows sent (MySQL reports 2 per updated row)
- **Error model**:
    - runtime-thrown library errors should use `BetterDrizzleError` from `src/shared/errors.ts`
    - `BetterDrizzleError` carries `message`, `status`, `code`, `driver`, and structured metadata such as `table`, `column`, `constraint`, `operation`, and `details`
    - `BetterDrizzleTransactionRollbackError` extends `BetterDrizzleError` and is the canonical rollback error shape
    - when normalizing external/database failures, prefer `BetterDrizzleError.from(...)` or `BetterDrizzleError.fromDatabaseError(...)` instead of throwing raw `Error`

## Performance rules

- **Performance matters here**: this repo explicitly benchmarks wrapper overhead. Do not add helpers, branching, abstractions, or allocations unless they clearly pay for themselves.
- **Hot files**:
    - `src/shared/client/operations.ts`
    - `src/shared/query/compiler.ts`
    - `src/shared/client/context.ts`
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
    - `benchmark/full.ts`: comprehensive read/write/relation/raw/transaction comparisons with mandatory deep result-parity validation before timing
    - `benchmark/memory.ts`: heap/rss deltas and overhead summaries
    - `benchmark/scenarios.ts`: benchmark scenarios for raw Drizzle and `better-drizzle`
    - `benchmark/setup.ts`: benchmark database/context setup
    - `benchmark/schema.ts`: benchmark schema
    - `benchmark/report.ts`: generates the published overhead tables
    - `benchmark/jsonb.ts`: PostgreSQL JSONB path filters, row **and** plan parity
- **Absolute timings are not publishable**: the same operation reads 53 µs idle and 93 µs under load. Only the raw/better ratio is stable across runs. `benchmark/report.ts` interleaves both sides in one sampling window (alternating which leads) and takes the median across samples; measurement is delegated to mitata's engine so warmup/JIT/GC handling matches `bun run bench`. A hand-rolled timing loop was tried first and disagreed with mitata by ~30 points on point lookup - do not hand-roll timing here.
- **Measured, reproducible across runs, published on the docs site** (everything sits within ~10% at parity except the relation win):
    - `cursor()` uses one indexed data query with an inline `EXISTS` navigation check for populated single-primary-key pages; empty pages and complex queries retain an exact fallback probe. The API-parity Drizzle scenario must compute the same navigation flags, while the data-only query stays in the manual reference group.
    - relation graph reads are ~9x _faster_ than the equivalent raw code, via the batched loader
    - mixed-read and transaction batches use more heap, not less
- **Cursor parity is easy to fake**: an earlier revision of `rawCursorPaginate` hardcoded `hasPrevious: true`, so the raw side ran one query against better-drizzle's two and `cursor()` measured ~2x slower. The raw side must resolve `hasPrevious` for real (correlated `exists` subquery). Re-check this whenever a pagination scenario changes.
- **Benchmark rule**: parity matters. If `better-drizzle` returns nested objects, pagination metadata, or relation payloads, the raw Drizzle comparison must return the same effective shape and do the same effective work.
- **Array benchmark state**: do not benchmark repeated `append`/`prepend` against the same row without resetting its array. Its size grows during sampling, so each iteration measures different work. The current PostgreSQL array benchmark keeps only stable mutation scenarios.
- **Two benchmark views exist intentionally**:
    - `api parity`: fair comparison where raw Drizzle and `better-drizzle` do the same work
    - `manual drizzle reference`: lower-level manual queries that intentionally do less work and are not parity claims
- **When changing performance-sensitive code**:
    - run `bun run bench`
    - run `bun run bench:verify`
    - run `bun run bench:full`
    - run `bun run bench:memory`
    - interpret regressions against the parity suite first
    - do not use the manual reference numbers as the main headline for wrapper overhead claims

## Integration testing

- Massive real-database coverage lives under `src/tests/integration/`.
- Every test creates a fresh SQLite `:memory:` database, applies real DDL and constraints, seeds real rows, and invokes the public `better(...)` API without database mocks or fake query functions.
- The shared fixture seeds 300 users, 1,200 posts, 2,400 comments, 150 profiles, 15 groups, 900 memberships, and 1,000 batch rows per test.
- Run the suite with `bun run test:integration`; it is also included in the root `bun run test` command.

## Tooling and commands

- **Typecheck**:
    - `bunx tsc --noEmit`
    - web app: `cd apps/web && bun run typecheck`
- **Format and lint**:
    - `bun run check:lint`
    - `NODE_OPTIONS=--import=tsx bunx oxfmt --config oxfmt.config.ts --write <files>` for targeted formatting
- **Recent style/tooling facts**:
    - TypeScript is `strict`
    - module resolution is `bundler`
    - Oxfmt uses tabs, single quotes, and trailing commas
    - `oxfmt.config.ts` and `oxlint.config.ts` import Ultracite presets; the commands load them through `tsx` because the local Node build cannot execute TypeScript config files natively
    - Oxfmt intentionally excludes Markdown and MDX from the workspace-wide check to avoid reflowing documentation

## Local development database

- **Docker Compose** provides Postgres 16, MySQL 8, and Redis 7 instances for local development and manual testing.
- **Files**:
    - `docker-compose.yml`: postgres service with healthcheck and persistent volume
    - `.env` / `.env.example`: connection config (port, credentials, db name)
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

- **README sync**: the root `README.md` and `README.md` are intended to stay aligned. If one changes, update the other unless there is a clear package-specific reason not to.
- **Performance claims**: tie claims to benchmark shape and avoid vague “faster” language without context.
- **Result access in examples**: destructure results (`const { data, pagination: { total, hasNext } } = await ...`) instead of assigning them to a variable and reading `page.pagination.total` line by line.
- **Examples**: prefer real API examples that match the current exported API and benchmarked usage patterns.
- **Documentation**: add focused pages under `apps/web/content/docs` instead of duplicating API guidance in a separate catalog.

## Agent skills support

- **Canonical skill pack**: the repository now ships a first-party agent skill at `skills/better-drizzle/`.
- **Guardrails split**:
    - `better-drizzle/rules` is the runtime enforcement layer
    - `better-drizzle/eslint` mirrors the statically-checkable subset for direct Better Drizzle callsites in IDEs and ESLint
- **Schema plugin**:
    - `better-drizzle/zod` generates per-table Zod schemas and exposes them as `db.<table>.$zod`
    - its declared Zod 3/4 peer range requires Zod 4-compatible runtime schema types (`ZodObject` rather than removed `AnyZodObject`) and a version-agnostic public `ZodType` facade
    - the public `$zod` surface currently includes `create`, `update`, `upsert`, `select`, `where`, `orderBy`, `pagination`, and `query`
    - runtime validation is hook-driven and opt-out per call via plugin-provided `validate?: boolean`
    - schema-only extension fields are allowed during validation, but the plugin strips non-column keys before returning payloads to Drizzle
    - package internals are intentionally split with a minimal `src/shared/` layout: `validation.ts` for hook parsing/flags, `schema-builder.ts` for Zod shape builders, and `registry.ts` for Drizzle schema traversal plus registry assembly
- **Plugin typing**:
    - table-specific model extensions use a type-level resolver: an interface extending `ModelExtensionTypeResolver` whose `extension` reads `this['schema']` / `this['name']` (HKT pattern); generic function resolvers are still accepted but inferring them against `PluginModelExtensionContext` recursed through the delegate type (TS2589), so first-party plugins must use the interface form
    - conditional helpers over plugin/zod config must guard `never` (`[X] extends [never]`): distributing over `never` silently erased static model extensions and every zod shape
    - delegate method args are checked with `Args & NoInfer<Base & ArgsCheck<Args, Base>>` (unknown keys become `never`; `select` + `include` at one level is rejected); keep `Args extends Base` as the constraint (an `object` constraint degrades error locations) and keep `ArgsCheck` neutral when `Base` extends `Args` so `Parameters<typeof db.x.findMany>[0]` stays usable
    - `ExtendedClient` re-declares `extends`, `$withContext`, and `transaction` so extensions survive scoped and transaction clients, matching the runtime
- **ATA plugin**:
    - `better-drizzle/ata` reads tables and relations from the relations config it receives as `schema` (`db._.relations`), runs Date/BigInt/Buffer residues after JSON Schema validation, and validate relation-aware result envelopes through `afterCreate`, `afterQuery`, and `afterUpdate`
- **Multi-agent surfaces**:
    - `AGENTS.md` remains the repo-wide source of truth for agent context
    - `CLAUDE.md` and `GEMINI.md` were removed in `71e1758`; do not reintroduce them or reference them in docs
- **Security posture**:
    - the skill pack is intentionally `zero-scripts / zero-network`
    - do not add `scripts/`, binaries, remote fetch instructions, install commands, or secret-reading guidance to `skills/better-drizzle/`
    - treat prompt injection, exfiltration, and permission-escalation resistance as first-class review criteria for agent-facing docs
- **Skill references**:
    - keep `skills/better-drizzle/SKILL.md` short and operational
    - put detailed guidance under `skills/better-drizzle/references/`
    - prefer local repo facts over generic ORM advice
- **Public docs**:
    - the docs site has a top-level AI section under `apps/web/content/docs/ai`
    - if the skill's public behavior or installation guidance changes, update the AI docs page and the synced READMEs

## Web app notes

- The docs site under `apps/web` uses `fumadocs-ui` layouts with custom header slots.
- If a custom docs header replaces Fumadocs' default `Header`, it must participate in the docs grid with `[grid-area:header]` and the docs shell should keep `--fd-header-height` in sync, otherwise mobile/tablet layouts can collapse the main content into a narrow column.
- For narrow screens, `#nd-docs-layout` may need an explicit single-column grid override because Fumadocs' default docs grid keeps sidebar/toc tracks in the template even when those panes are visually hidden.
- The docs sidebar is a basic-to-advanced learning path defined entirely in `apps/web/content/docs/meta.json`: `---Step---` separators plus nested page paths such as `querying/reads`. Folders stay on disk only to keep URLs stable. Only `plugins`, `reference`, and `performance` keep their own `meta.json` and render as collapsible groups. The prev/next footer follows the same order, so put new pages at the right step there.
- Docs code blocks render through `apps/web/components/shiny-code-block.tsx` (the `pre` override in `mdx-components.tsx`): clicking anywhere on a block copies it and plays the `bd-code-flash` sweep from `app/global.css`.
- SEO: titles use `-` as separator (never an em dash); site-wide constants/keywords live in `apps/web/lib/seo.ts`. Every docs page sets `seoTitle` (≤45 chars, the template appends ` - better-drizzle`) and `seoDescription` (110-160 chars, mentioning Drizzle ORM) in frontmatter; the visible `title`/`description` stay short. OG images come from `app/opengraph-image.tsx` and `app/og/docs/[...slug]/route.tsx`.
- API examples pair a better-drizzle block with a raw Drizzle equivalent using Fumadocs' built-in code tabs: adjacent fences with ` ```ts tab="better-drizzle" tab-group="orm" ` then ` ```ts tab="Drizzle" tab-group="orm" `. better-drizzle comes first; the shared `tab-group` syncs and persists the selection. Skip setup/schema/plugin-config blocks.

## Change checklist

- **For API changes**:
    - update public types under `src/types`
    - verify exports from `src/index.ts`
    - update both READMEs if user-facing behavior changes
    - ensure examples still type-check conceptually against the current API
    - if `src/plugins/rules` changes, keep the root workspace scripts (`build`, `test`, `check`, `pack`) including it
    - if `src/plugins/zod` changes, keep the root workspace scripts (`build`, `test`, `check`, `pack`) including it
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
- **Drizzle ORM 1.x (RQB v2) migration**: the runtime builds table/relation metadata from `db._.relations` (`TableRelationalConfig` is `{ table, name, relations }`; relations are v2 `Relation` objects with `sourceColumns`, `targetColumns`, `through`, `throughTable`, `where`, `relationType`). The `Schema` type parameter everywhere is the relations config (`typeof relations`), so `TableFor` reads `Schema[K]['table']` and relation targets come from `targetTableName`. Column facts that changed: `dataType` is `"<type> <constraint>"` (compare prefixes, never `=== 'number'`); PG arrays are the element column with `dimensions > 0` (no `PgArray`/`baseColumn`), element params must be encoded through `getPgArrayElementColumn()` because codecs cast params from `dimensions`; at the type level `json` and `jsonb` are indistinguishable (`object json`), so JSONB path types are keyed on dataType and the runtime rejects dotted paths on `PgJson`. Driver errors arrive wrapped in `DrizzleQueryError` with the driver error as `cause`; error helpers unwrap it. Bun SQLite prepares through `client.query()`, and raw `db.transaction` callbacks must be sync there.
- **Migration audit traps**: `bunx tsc --noEmit` can pass while `tsdown` declaration generation fails if an exported plugin factory closes over a private local interface; run `bun run build` or `pack`. A many-to-many `_count` must correlate all source columns even when the target key has fewer columns. MySQL query-builder methods such as `onDuplicateKeyUpdate` use `this`; invoke them on the builder. `cursor().explain()` must not execute the data query to discover row-dependent probes; describe these as deferred. On SQLite, an `afterCommit` failure must not trigger rollback after COMMIT. PostgreSQL enum array casts must quote schema and type names. Timestamp plugins should emit ISO strings for text-backed columns, while native date columns receive `Date`.
- **PostgreSQL array filters**: native `PgArray` columns use a dedicated typed `ArrayFilter`, not the generic scalar filter, so JSON columns typed as arrays do not gain array operators. The compiler uses PostgreSQL `@>`, `&&`, `<@`, and `cardinality()` with parameter binding; array filter objects must fail fast outside PostgreSQL. `length` always means total cardinality across dimensions.
- **PostgreSQL array element predicates**: `some`, `every`, and `none` accept the element's typed scalar filter. The compiler uses GIN-compatible containment/overlap fast paths for simple equality/list predicates, `ANY`/`ALL` for lone comparisons, and `unnest()` otherwise. Generic paths must bind through the innermost array base-column encoder so custom PostgreSQL types retain `toDriver()` behavior. Empty arrays make `some` false and `every`/`none` true; `NULL` arrays never match, while NULL elements fail `every` but do not satisfy `some` or block `none`.
- **PostgreSQL array mutations**: `PgArray` update inputs accept one typed atomic envelope (`append`, `prepend`, `remove`, `replace`, or `addUnique`) in `update`, `updateMany`, `updateEach`, `upsert`, and object/callback `upsertMany`. Compilation happens immediately before Drizzle writes so plugins retain declarative input. `addUnique` is a single PostgreSQL statement that preserves first-input order, skips existing values, preserves stored `NULL`, and must remain linear in input size.
- **Scalar atomic mutations**: number columns accept `set`, `increment`, `decrement`, `multiply`, and `divide`; boolean columns accept `toggle: true`. Numeric envelopes compose in that order and compile immediately before writes across `update`, `updateMany`, `updateEach`, `upsert`, and `upsertMany`. Invalid envelopes, non-finite operands, and zero division fail before SQL; `NULL` and integer division retain native dialect semantics. Post-write hooks expose the final atomic set expressions as `compiled`.
- **JSONB path shorthand**: PostgreSQL JSONB filters accept dotted paths directly on the column (`{ metadata: { 'profile.age': { gte: 18 } } }`). The legacy `{ json: { ... } }` wrapper remains supported for root paths; direct shorthand intentionally requires every key to contain a dot so ordinary JSON document equality remains unchanged. Note both filter and mutation compilers split wrapper keys on `.`, so the wrapper does not preserve literal dotted keys.
- **JSONB path mutations**: update operations (`update`, `updateMany`, `updateEach`, `upsert`, `upsertMany`) accept dotted paths and the `{ json: ... }` wrapper, compiling object-key paths to chained PostgreSQL `jsonb_set(..., true)` calls with JSON-encoded bound params. Both forms validate known paths and value types for `$type<T>()` columns; untyped columns keep open path names and JSON-encodable values. Dotted shorthand requires every key to contain a dot; the wrapper also supports single-level keys. One value must be all dotted keys (partial update) or no dotted keys (full replacement); mixing throws `OPERATION_ERROR`, and a top-level `json` object key on a `PgJsonb` column is reserved for the wrapper. Missing ancestors are created, SQL NULL and non-object JSONB roots start as `{}`, existing object ancestors/unrelated keys are preserved, and non-object intermediates become `{}`. Duplicate paths and ancestor/descendant overlaps throw `OPERATION_ERROR`; recursively nested `undefined` and unencodable values also throw. Only dotted/wrapper path shapes are dialect-gated (non-PostgreSQL fails fast with `JSONB_MUTATION_UNSUPPORTED` before shape validation); full-document replacements work on any dialect. Literal dotted keys always compile to nested paths.
- If future tasks discover important architectural or benchmarking constraints, add them here instead of leaving them buried in commit history.
- **MySQL upsert and driver results**: Drizzle 1.0-rc.4's MySQL `onDuplicateKeyUpdate` needs its insert builder as `this`; never call a detached builder method. mysql2 writes return `[ResultSetHeader, FieldPacket[]]`, so affected-row counts come from the first tuple item. MySQL's `ON DUPLICATE KEY UPDATE` fires on any unique key, not specifically the `where` primary key; use the native path only when the Drizzle table declares no other unique key, then fall back to the regular read/write path to avoid updating a different row.
