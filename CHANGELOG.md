# Changelog

## 0.1.0 - 2026-06-26

First public release.

### Added

- table delegates for reads, writes, pagination, counts, existence checks, and repository lookup
- `skipDuplicates` support for `create` and `createMany`
- native-first `upsertMany` with conflict targets, multiple update strategies, chunking, and optional `select`
- client-level transactions with nested savepoints, retries, explicit rollback, `afterCommit`, and `afterRollback`
- safe raw SQL via `$raw` and `$executeRaw`, plus guarded `$rawUnsafe`
- plugin system with typed `operationArgs`, transforms, hooks, client extensions, and model extensions
- official plugins:
  - `@better-drizzle/timestamps`
  - `@better-drizzle/soft-delete`
- docs site, examples catalog, benchmark suite, smoke-consume checks, package-size reporting, and public API snapshots

### Notes

- `upsertMany` is intentionally native-first and fails fast on unsupported dialects instead of degrading to slow per-row loops
- package compatibility for `0.1.0` is documented on the docs site support matrix and stability pages
