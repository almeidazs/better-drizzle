# Consolidated Package Tasks

**Design**: `.specs/features/consolidated-package/design.md`
**Status**: Approved

## Test Coverage Matrix

> Generated from `AGENTS.md`, existing Bun integration tests, and the package/CI scripts. Configuration and relocation work use build gates; the existing plugin behavior suites remain the regression coverage.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Package exports | integration | Every documented ESM/CJS/type export resolves from the packed tarball. | `tests/package.test.ts` | `bun run pack` |
| Core and plugins | integration | Existing public API behavior remains unchanged. | `tests/{core,rules,eslint,timestamps,soft-delete,zod}/**` | `bun run test` |
| Build configuration | none | All entries emit ESM, CJS, and declarations. | `tsdown.config.ts` | `bun run build` |
| Documentation | none | No active first-party package reference uses `@better-drizzle/*`. | docs and READMEs | `rg` stale-reference gate |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Source relocation task | `bun run check:types` |
| Full | Plugin or test relocation task | `bun run check:types && bun run test` |
| Build | Build, package, or documentation task | `bun run check` |

## Execution Plan

### Phase 1: Source consolidation

```
T1 → T2 → T5
T1 → T3
T1 → T4
T2 → T6
T3 → T6
T4 → T6
T5 → T6
```

### Phase 2: Distribution and public surface

```
T6 → T7 → T8
```

## Task Breakdown

### T1: Relocate the core source and tests

**Status**: Done
**What**: Move the core implementation to `src/` and its tests to `tests/core/`, then update local imports and TypeScript aliases.
**Where**: `packages/core/src`, `packages/core/tests`, `src`, `tests/core`, `tsconfig.json`
**Depends on**: None
**Reuses**: Current core entrypoint and test fixtures.
**Requirement**: PKG-04, PKG-05
**Tests**: integration
**Gate**: full

### T2: Relocate the rules integration

**Status**: Done
**What**: Move rules source and tests to the unified tree and change imports to `better-drizzle/rules`.
**Where**: `packages/rules`, `src/packages/rules`, `tests/rules`
**Depends on**: T1
**Reuses**: Existing rules plugin behavior suite.
**Requirement**: PKG-01, PKG-05
**Tests**: integration
**Gate**: full

### T3: Relocate soft-delete and timestamps integrations

**Status**: Done
**What**: Move both dependency-free runtime integrations and their tests to unified plugin subtrees.
**Where**: `packages/soft-delete`, `packages/timestamps`, `src/packages/{soft-delete,timestamps}`, `tests/{soft-delete,timestamps}`
**Depends on**: T1
**Reuses**: Existing plugin behavior suites.
**Requirement**: PKG-01, PKG-05
**Tests**: integration
**Gate**: full

### T4: Relocate the Zod integration

**Status**: Done
**What**: Move Zod source and tests to the unified tree and update it to import the core by root subpath.
**Where**: `packages/zod`, `src/packages/zod`, `tests/zod`
**Depends on**: T1
**Reuses**: Existing generated-schema and validation tests.
**Requirement**: PKG-01, PKG-02, PKG-05
**Tests**: integration
**Gate**: full

### T5: Relocate the ESLint integration

**Status**: Done
**What**: Move ESLint source and tests to the unified tree and point its rules dependency at `better-drizzle/rules`.
**Where**: `packages/eslint`, `src/packages/eslint`, `tests/eslint`
**Depends on**: T2
**Reuses**: Existing RuleTester suite.
**Requirement**: PKG-01, PKG-02, PKG-05
**Tests**: integration
**Gate**: full

### T6: Remove plugin package manifests and adjust workspace commands

**Status**: Done
**What**: Delete standalone plugin manifests and replace workspace-filtered scripts with unified root commands.
**Where**: unified package manifest boundary
**Depends on**: T2, T3, T4, T5
**Reuses**: Root command conventions.
**Requirement**: PKG-04, PKG-06
**Tests**: build configuration (none required by matrix)
**Gate**: build

### T7: Emit and validate root subpath exports

**What**: Configure tsdown and root exports for every public entrypoint, then add packed-tarball export validation.
**Where**: unified distribution boundary
**Depends on**: T6
**Reuses**: Existing dual-format declaration build configuration.
**Requirement**: PKG-01, PKG-02, PKG-03, PKG-04, PKG-06
**Tests**: integration
**Gate**: build

### T8: Migrate public documentation and agent guidance

**What**: Replace first-party scoped package installation/import references with root subpaths and update repository field notes.
**Where**: public documentation surface
**Depends on**: T7
**Reuses**: Current plugin documentation hierarchy.
**Requirement**: PKG-07, PKG-08, PKG-09
**Tests**: documentation (none required by matrix)
**Gate**: build

## Task Validation

| Check | Result |
| --- | --- |
| Granularity | ✅ Each task owns one migration boundary. |
| Dependency diagram parity | ✅ Every diagram edge is represented in `Depends on`. |
| Test co-location | ✅ Runtime moves retain their existing integration suites; packaging receives a tarball integration test. |
