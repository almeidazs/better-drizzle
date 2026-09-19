# Consolidated Package Specification

## Problem Statement

Better Drizzle publishes its core and first-party plugins as six independent npm packages. Consumers must install and version-match multiple packages even though they are released from one repository. The public API should instead expose one `better-drizzle` package with typed plugin subpaths.

## Goals

- [ ] Publish the core and first-party plugins from one `better-drizzle` npm package.
- [ ] Expose plugin APIs through documented subpath imports.
- [ ] Keep optional integrations from forcing unrelated runtime dependencies on core-only consumers.
- [ ] Preserve ESM, CommonJS, declaration, testing, packing, and documentation guarantees.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Backward-compatible `@better-drizzle/*` wrapper packages | The requested target removes the separate published packages; retaining wrappers would preserve the split distribution. |
| Changes to plugin behavior | This is a distribution and source-layout migration only. |
| Publishing the new package version | Publishing is an external release action and requires separate authorization. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Source layout | Move core to `src/` and plugins to `src/packages/<name>/`. | Matches the requested repository layout while keeping feature boundaries clear. | y |
| Public plugin subpaths | Provide `better-drizzle/{rules,soft-delete,timestamps,zod,eslint}`. | Gives each first-party integration a stable, discoverable import path. | y |
| Compatibility | Remove `@better-drizzle/*` imports and manifests without publishing compatibility wrappers. | The requested target is a single package; this should ship as a major-version release. | y |
| Optional dependencies | Mark Zod and ESLint-related peer dependencies optional on the root package. | Core-only installations must not require optional integrations. | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Install one package

**User Story**: As a Better Drizzle consumer, I want to install one package and import optional integrations by subpath so that dependency management is simpler.

**Why P1**: This is the purpose of the migration.

**Acceptance Criteria**:

1. WHEN a consumer installs `better-drizzle` THEN the package SHALL expose `better-drizzle`, `better-drizzle/rules`, `better-drizzle/soft-delete`, `better-drizzle/timestamps`, `better-drizzle/zod`, and `better-drizzle/eslint` for ESM, CommonJS, and TypeScript resolution.
2. WHEN a consumer uses an optional integration THEN the package SHALL require only that integration's documented peer dependencies.
3. IF a consumer imports an unavailable subpath THEN the package SHALL reject it through the package export map.

**Independent Test**: Pack the root package and resolve every documented subpath from both ESM and CommonJS type declarations.

### P1: Keep all existing functionality

**User Story**: As a library maintainer, I want consolidation to preserve the behavior of core and plugins so that users do not receive a functional regression.

**Why P1**: Packaging changes must not change runtime semantics.

**Acceptance Criteria**:

1. WHEN the consolidated source tree is built THEN the build SHALL emit the core entrypoint and every documented plugin entrypoint into the root package distribution.
2. WHEN the full existing test suite runs THEN all current core and plugin tests SHALL pass without importing `@better-drizzle/*`.
3. WHEN repository checks run THEN type checking, linting, package dry-run validation, and build checks SHALL pass without plugin package manifests.

**Independent Test**: Run the root check command and inspect the packed tarball contents and exports.

### P1: Keep documentation accurate

**User Story**: As a documentation reader, I want installation and import examples to match the single-package API so that I can adopt plugins without stale package names.

**Why P1**: Every current public plugin guide teaches the old package layout.

**Acceptance Criteria**:

1. WHEN documentation references a first-party plugin THEN it SHALL use the corresponding `better-drizzle/<plugin>` import path.
2. WHEN documentation lists dependencies for a first-party plugin THEN it SHALL install `better-drizzle` once plus only required optional peers.
3. WHILE repository documentation is maintained THEN it SHALL not present `@better-drizzle/*` as an installable or importable package.

**Independent Test**: Search tracked documentation and source configuration for obsolete package references, allowing historical release notes only if retained.

## Edge Cases

- IF a plugin entrypoint has an optional peer unavailable at installation time THEN the package SHALL remain installable until that entrypoint is used.
- IF the package is packed for publishing THEN the tarball SHALL include all subpath runtime files and declaration files required by its export map.
- WHEN a local workspace test resolves a plugin THEN it SHALL resolve the new root subpath alias rather than a removed workspace package name.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| PKG-01 | P1: Install one package | Design | Pending |
| PKG-02 | P1: Install one package | Design | Pending |
| PKG-03 | P1: Install one package | Design | Pending |
| PKG-04 | P1: Keep all existing functionality | Design | Pending |
| PKG-05 | P1: Keep all existing functionality | Design | Pending |
| PKG-06 | P1: Keep all existing functionality | Design | Pending |
| PKG-07 | P1: Keep documentation accurate | Design | Pending |
| PKG-08 | P1: Keep documentation accurate | Design | Pending |
| PKG-09 | P1: Keep documentation accurate | Design | Pending |

**Coverage:** 9 total, 0 mapped to tasks, 9 unmapped.

## Success Criteria

- [ ] Consumers can import every first-party integration from `better-drizzle/<plugin>`.
- [ ] The packed `better-drizzle` tarball contains all exported ESM, CommonJS, and declaration entrypoints.
- [ ] The complete repository quality gate passes.
