# Rules plugin

The rules plugin adds runtime guardrails to Better Drizzle operations.

## Install

```bash
npm install @better-drizzle/rules
```

## Basic setup

```ts
import { better } from 'better-drizzle';
import { rules } from '@better-drizzle/rules';

const client = better(db, {
	schema,
	plugins: [
		rules({
			noRawUnsafe: true,
			noUpdateManyWithoutWhere: true,
			requireOrderByForCursor: true,
		}),
	],
});
```

## What it can catch

- `delete()` / `update()` calls without `where`
- unbounded `findMany()` calls
- oversized `limit` values
- cursor pagination without `orderBy`
- `skipLocked` without `orderBy` or `limit`
- `rawUnsafe()` usage
- raw mutations outside an allowed policy
- missing tenant context in `meta` or `$withContext(...)`

## `true` means error

Every rule can be expressed as a boolean shorthand:

```ts
rules({
	noRawUnsafe: true, // same as { level: 'error' }
	requireOrderByForPagination: false, // same as 'off'
});
```

You can still use explicit levels:

```ts
rules({
	maxLimit: {
		level: 'warn',
		value: 500,
	},
	requireRawTimeout: {
		level: 'error',
		maxTimeoutMs: 30_000,
	},
});
```

## Presets

The package also exports `safe()`, `recommended()`, and `strict()` presets:

```ts
import { recommended, rules } from '@better-drizzle/rules';

const client = better(db, {
	schema,
	plugins: [
		rules(
			recommended({
				noRawUnsafe: true,
			}),
		),
	],
});
```

## Warning reporters

Warnings do not need to throw. You can route them into logs or telemetry:

```ts
rules({
	noRawUnsafe: 'warn',
	reporter: {
		warn(violation) {
			console.warn(violation.rule, violation.operation, violation.model);
		},
	},
});
```

## Current boundary

The plugin is hook-driven. If Better Drizzle does not expose enough runtime data to evaluate a rule safely, that rule is ignored instead of guessed.
