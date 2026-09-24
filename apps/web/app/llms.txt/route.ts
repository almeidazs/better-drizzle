export const revalidate = false;

const BASE = "https://better-drizzle.com";

/**
 * Generates a comprehensive llms.txt file following the llmstxt.org spec.
 *
 * Structure:
 * - H1 title
 * - Blockquote summary
 * - Introductory context
 * - H2 sections with curated link lists
 *
 * @see https://llmstxt.org
 */
export function GET() {
	const body = `# better-drizzle

> Minimal, type-safe repository helpers for Drizzle ORM. Keep the type-safety, drop the repetitive query glue. better-drizzle wraps an existing Drizzle client and gives every table a small, consistent API for reads, writes, pagination, nested filters, relation loading, hooks, and plugins - without hiding Drizzle or rebuilding a full ORM.

better-drizzle is a thin repository-style wrapper on top of Drizzle ORM. It does not replace raw Drizzle - you still define your schema, choose your driver, and reach for raw SQL whenever you want. It simply removes the query glue you would otherwise rewrite in every service.

Key characteristics:
- Not a new ORM. Does not hide Drizzle or rebuild a query engine.
- Supports PostgreSQL, MySQL, and SQLite through Drizzle's driver layer.
- Current release line: 0.2.x. Ships as ONE package. The official plugins are subpath exports (\`better-drizzle/rules\`, \`/zod\`, \`/timestamps\`, \`/soft-delete\`, \`/eslint\`, \`/plugins\`), NOT the old scoped \`@better-drizzle/*\` packages, which are discontinued as of 0.2.0.
- Native-first batch operations: \`upsertMany\`, \`updateEach\`, \`createMany\`.
- Batched relation loading with nested \`include\`/\`select\`, inferred many-to-many, and \`include._count\` relation totals as correlated subqueries.
- Relational writes: \`connect\`, \`disconnect\`, and exclusive \`set\`, run in an implicit transaction.
- Lazy \`.explain()\` on every read helper, with cross-dialect query plans.
- Row locks (\`lock\`, \`skipLocked\`, \`noWait\`) on PostgreSQL and MySQL.
- Typed JSONB path filters on PostgreSQL.
- Plugin system with lifecycle hooks, transforms, typed \`operationArgs\`, and model/client extensions.
- Transaction support with savepoints, retries, and lifecycle callbacks.
- Raw SQL passthrough with safety gates and dialect awareness.
- Scoped metadata via \`$withContext()\` for multi-tenancy and request tracing.
- Peer dependencies: \`drizzle-orm\` (>=0.30.0) and \`typescript\` (^5).

## Documentation

- [Introduction](${BASE}/docs): Overview of better-drizzle - what it is, what it does, and how it fits alongside Drizzle ORM.
- [Getting Started](${BASE}/docs/getting-started): Install, configure, and run your first better-drizzle client in minutes.
- [Why better-drizzle?](${BASE}/docs/why): What better-drizzle adds over raw Drizzle, what stays the same, and when raw Drizzle is still the right tool.

## Querying

- [Reads](${BASE}/docs/querying/reads): findMany, findFirst, findOne, findUnique, count, and exists - the full read surface.
- [Filters](${BASE}/docs/querying/filters): Typed where clauses with AND/OR/NOT, scalar operators, and nested relation filters.
- [Selecting Fields](${BASE}/docs/querying/selecting-fields): Pick specific columns or load nested relations with select and include.
- [Relations](${BASE}/docs/querying/relations): Loading related records - one-to-one, one-to-many, and many-to-many patterns.
- [Pagination](${BASE}/docs/querying/pagination): \`paginate()\` for offset pages and \`cursor()\` for cursor navigation, both with typed metadata.
- [JSONB Filters](${BASE}/docs/querying/jsonb): Typed PostgreSQL JSONB path filters derived from \`jsonb().$type<T>()\` columns.
- [Explain](${BASE}/docs/querying/explain): Lazy \`.explain()\` on read helpers for cross-dialect query plans, including deferred relation stages.

## Writing

- [Create, Update & Delete](${BASE}/docs/writing/crud): The full write surface - create, createMany, update, updateMany, updateEach, delete, deleteMany, upsert, and upsertMany.
- [Relation Writes](${BASE}/docs/writing/relation-writes): Attach, detach, and replace related rows from a single write with connect, disconnect, and set.
- [Throwing Results](${BASE}/docs/writing/throwing-results): Use .throw() on nullable results to convert null into a typed error instead of manual null checks.

## Advanced

- [Transactions](${BASE}/docs/advanced/transactions): Transaction API with savepoints, retries, timeouts, AbortSignal support, and lifecycle hooks.
- [Hooks](${BASE}/docs/advanced/hooks): beforeCreate, afterQuery, onError, and more - cross-cutting concerns without polluting business logic.
- [Error Handling](${BASE}/docs/advanced/error-handling): BetterDrizzleError, structured error codes, database error detection, and constraint violation helpers.
- [Row Locks](${BASE}/docs/advanced/locks): \`lock\`, \`skipLocked\`, and \`noWait\` on PostgreSQL and MySQL, with transaction-only enforcement.
- [Raw SQL](${BASE}/docs/advanced/raw-sql): $raw, $executeRaw, and $rawUnsafe - safe raw SQL with comment metadata, timeouts, and dialect guards.

## Plugins

- [Plugin Overview](${BASE}/docs/plugins/overview): How the plugin system works - setup, hooks, transforms, extensions, and operation args.
- [ESLint](${BASE}/docs/plugins/eslint): Official ESLint plugin - the statically-checkable subset of the runtime guardrails, for IDE and CI.
- [Rules](${BASE}/docs/plugins/rules): Official rules plugin - runtime guardrails for raw SQL, destructive writes, pagination, locks, and request context.
- [Soft Delete](${BASE}/docs/plugins/soft-delete): Official soft delete plugin - marks rows as deleted instead of removing them.
- [Timestamps](${BASE}/docs/plugins/timestamps): Official timestamps plugin - auto-manages createdAt and updatedAt columns.
- [Zod](${BASE}/docs/plugins/zod): Official Zod plugin - per-table generated schemas on \`db.<table>.$zod\` plus hook-driven runtime validation.
- [Writing Plugins](${BASE}/docs/plugins/writing-plugins): Build your own plugin - extend clients, models, hooks, transforms, and operation args.

## Guides

- [Frameworks](${BASE}/docs/guides/frameworks): Integration patterns for Bun, Express, Fastify, Next.js, and other runtimes.
- [Service Patterns](${BASE}/docs/guides/service-patterns): Structuring application code with better-drizzle - repositories, services, and dependency injection.
- [Multi-Tenancy & Request Context](${BASE}/docs/guides/multi-tenancy): Thread tenant and request metadata through hooks, plugins, and transactions with meta and $withContext.
- [Client Extensions](${BASE}/docs/guides/client-extensions): Attach app-specific helpers to the client with \`extends()\`, preserved across \`$withContext()\` clones and transactions.
- [Dynamic Repositories](${BASE}/docs/guides/dynamic-repositories): Resolve delegates at runtime by schema key or database table name.
- [Migrating from Drizzle](${BASE}/docs/guides/migrating-from-drizzle): Step-by-step guide for adding better-drizzle to an existing Drizzle project.
- [Upgrading to 0.2](${BASE}/docs/guides/upgrading): Migrate from the scoped \`@better-drizzle/*\` plugin packages to the unified package subpaths.
- [Limitations](${BASE}/docs/guides/limitations): Known boundaries, unsupported patterns, and where raw Drizzle is the better choice.

## Performance

- [Benchmarks](${BASE}/docs/performance/benchmarks): Latency, throughput, and memory overhead comparisons against raw Drizzle.
- [API Parity](${BASE}/docs/performance/parity): Fair comparison methodology - better-drizzle and raw Drizzle doing the same effective work.

## Reference

- [Client API](${BASE}/docs/reference/client): better() options, client-level methods, and exports.
- [Model API](${BASE}/docs/reference/model-api): Per-table delegate methods - CRUD, queries, pagination, and batch operations.
- [Query Options](${BASE}/docs/reference/query-options): where, select, include, orderBy, take, skip, and cursor - fully typed.
- [Error Reference](${BASE}/docs/reference/errors): BetterDrizzleError codes, status mapping, and database error detection helpers.
- [Support Matrix](${BASE}/docs/reference/support-matrix): Driver and dialect support for every feature.
- [Stability](${BASE}/docs/reference/stability): API stability guarantees and versioning policy.

## AI & Agents

- [Agent Skills](${BASE}/docs/ai): First-party agent skill pack - installation, supported agent surfaces, and the zero-scripts/zero-network security model.

## Optional

- [GitHub Repository](https://github.com/almeidazs/better-drizzle): Source code, issues, and contributions.
- [npm Package](https://www.npmjs.com/package/better-drizzle): Install better-drizzle from npm.
`;

	return new Response(body, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
