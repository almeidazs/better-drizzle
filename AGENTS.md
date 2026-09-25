# Better-Drizzle Repository – Agent Field Notes

> Meta note: This is the primary agent knowledge base file for this repository. When learning something about the codebase that will help with future tasks, update this file directly.

- **Repository scope**: `better-drizzle` is a small Bun/TypeScript workspace that publishes one package, plus a benchmark suite used to measure API-parity performance and memory overhead against raw Drizzle ORM.
- **Workspace layout**:
    - `src`: the published library
    - `src/plugins/rules`: official runtime rules/guardrails plugin
    - `src/plugins/eslint`: official ESLint plugin for static Better Drizzle guardrails
    - `src/plugins/soft-delete`: official soft delete plugin
    - `src/plugins/timestamps`: official timestamps plugin
    - `src/plugins/zod`: official Zod schema generation and validation plugin
    - `benchmark`: Bun + SQLite benchmark suite
    - `apps/web`: Next.js + Fumadocs documentation/marketing site
    - `README.md`: package documentation
- **Package manager and runtime**: Bun is the primary runtime for local commands and benchmarks. The workspace is configured as a TypeScript ESM monorepo.
- **Package publishing/build**:
    - the root `package.json` is the only publishable manifest
    - tsdown emits minified, tree-shaken ESM, CommonJS, and declaration files for the root and each plugin subpath
    - public APIs are limited to `better-drizzle` plus `better-drizzle/{plugins,eslint,rules,soft-delete,timestamps,zod}` through conditional exports
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
    - the published compatibility floor is `drizzle-orm@^0.30.0`; `0.29.5` failed the workspace typecheck, while `0.30.0` passed typecheck plus the core/plugin test suites

## Architecture

- **Entry point**: `src/index.ts`
    - Exports `better(...)`
    - Exports `definePlugin(...)`
    - Delegates root/transaction client binding to `src/shared/client/factory.ts`
    - Builds a base runtime context once
    - Initializes plugins once during bootstrap
    - Re-binds delegates/extensions per bound client (`db` or `tx`) without re-running plugin setup
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
    - `paginate()` is offset-only and returns `{ data, pagination: { type: "offset", page, perPage, total, pageCount, hasNext, hasPrevious } }`
    - `cursor()` is the cursor-based API and returns `{ data, pagination: { type: "cursor", hasNext, hasPrevious, nextCursor, previousCursor } }`
    - cursor pagination accepts `before` or `after`, never both, and returns raw cursor objects by default
    - `count()` and `exists()` also honor `cursor` filters when provided, so helper queries stay aligned with cursor pagination semantics
- **Read query plans**:
    - read helpers (`findMany`, `findFirst`, `findOne`, `findUnique`, `count`, `exists`, `paginate`, `cursor`) now return explainable thenables with `.explain(options?)`
    - `.explain()` is lazy and does not execute the normal read path or query hooks unless the result is separately awaited
    - plugin transforms still affect `.explain()`, but query hooks do not
    - explain output is cross-dialect and structured as `{ driver, operation, statements }`; unsupported explain flags are reported under `ignoredOptions`
    - PostgreSQL maps `analyze`, `verbose`, `costs`, `timing`, and `summary`; SQLite uses `EXPLAIN QUERY PLAN`; MySQL uses the best available `EXPLAIN` form and ignores unsupported flags
- **Relational reads**:
    - nested `select` and `include` use Better Drizzle's own batched loader rather than Drizzle's `db.query.*` path
    - the loader executes one root query plus one query per requested relation node, including inferred many-to-many nodes
    - nested `where`, `orderBy`, `cursor`, `take`, `skip`, `select`, and `include` are supported; per-parent pagination uses `row_number()` window queries
    - internal linking columns are selected as needed and removed from the public payload
    - `select` and `include` are mutually exclusive at every level
    - `.explain()` reports non-root relation stages under `deferredRelations`
    - `include._count.select` projects relation totals as correlated subqueries in the SQL for the current query level; selectors accept `true` or `{ where }`, support one/many/many-to-many relations, and do not add count round-trips
- **Relational writes**:
    - `create` supports relation `connect`; `update` supports `connect`, `disconnect`, and exclusive `set`; `upsert` follows the corresponding create/update branch rules
    - relation selectors must be non-empty and match exactly one row
    - relation writes run in an implicit transaction when no transaction is already active and preserve delegate plugin state
    - simple two-FK junction tables are inferred as direct many-to-many relations; ambiguous paths fail and can be configured with `options.relations.manyToMany`
    - batch mutation APIs intentionally remain scalar-only
- **Row locks**:
    - read helpers built on `QueryArgs` (`findMany`, `findFirst`, `findOne`, `findUnique`, `paginate`, `cursor`) accept `lock`
    - `count`, `exists`, and write operations do not accept `lock`
    - PostgreSQL and MySQL are supported; SQLite should fail fast with a lock-specific error
    - `skipLocked` and `noWait` are mutually exclusive
    - `locks.transactionsOnly` can enforce that locked reads only run inside transactions
    - Drizzle's relational `db.query.*` path does not expose row-lock configuration, so v1 lock support intentionally rejects general relation loading (`include` / relation `select`) instead of silently dropping the lock
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
    - core plugin typing now supports table-specific model extensions through an optional model-extension resolver generic on `definePlugin(...)`; use this when an extension type depends on the current table
- **ATA plugin**:
    - `better-drizzle/ata` must derive relations through Drizzle's `extractTablesRelationalConfig` (never invoke a `relations(...).config` callback directly), run Date/BigInt/Buffer residues after JSON Schema validation, and validate relation-aware result envelopes through `afterCreate`, `afterQuery`, and `afterUpdate`
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
- **Drizzle ORM v1 RC compatibility (checked against `1.0.0-rc.4`)**: this is a separate compatibility target, not a peer-range-only change. The RC removes the legacy relational metadata APIs used by the runtime (`createTableRelationsHelpers`, `extractTablesRelationalConfig`, and `normalizeRelation`) and replaces `TableRelationalConfig.tsName` plus legacy `One`/`Many` shapes with RQB v2 metadata. The current package fails at module load under the RC. A dedicated implementation/build and RC CI matrix are required; do not widen the stable peer range until that implementation passes type, runtime, integration, and benchmark parity checks.
- **PostgreSQL array filters**: native `PgArray` columns use a dedicated typed `ArrayFilter`, not the generic scalar filter, so JSON columns typed as arrays do not gain array operators. The compiler uses PostgreSQL `@>`, `&&`, `<@`, and `cardinality()` with parameter binding; array filter objects must fail fast outside PostgreSQL. `length` always means total cardinality across dimensions.
- **PostgreSQL array element predicates**: `some`, `every`, and `none` accept the element's typed scalar filter. The compiler uses GIN-compatible containment/overlap fast paths for simple equality/list predicates, `ANY`/`ALL` for lone comparisons, and `unnest()` otherwise. Generic paths must bind through the innermost array base-column encoder so custom PostgreSQL types retain `toDriver()` behavior. Empty arrays make `some` false and `every`/`none` true; `NULL` arrays never match, while NULL elements fail `every` but do not satisfy `some` or block `none`.
- **PostgreSQL array mutations**: `PgArray` update inputs accept one typed atomic envelope (`append`, `prepend`, `remove`, `replace`, or `addUnique`) in `update`, `updateMany`, `updateEach`, `upsert`, and object/callback `upsertMany`. Compilation happens immediately before Drizzle writes so plugins retain declarative input. `addUnique` is a single PostgreSQL statement that preserves first-input order, skips existing values, preserves stored `NULL`, and must remain linear in input size.
- If future tasks discover important architectural or benchmarking constraints, add them here instead of leaving them buried in commit history.
