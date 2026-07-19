<div align="center">

# Better Drizzle

<h3 align="center">@better-drizzle/rules</h3>

Runtime guardrails for Better Drizzle operations.

[`@better-drizzle/rules`](https://npmjs.com/package/@better-drizzle/rules) is a first-party plugin for enforcing repository usage policies at runtime. It watches Better Drizzle operations through plugin hooks and turns unsafe patterns into warnings or errors without wrapping every call site manually.

## Install

</div>

```bash
npm install better-drizzle @better-drizzle/rules drizzle-orm
```

<div align="center">

## Usage

</div>

```ts
import { better } from 'better-drizzle';
import { rules } from '@better-drizzle/rules';

const client = better(db, {
	schema,
	plugins: [
		rules({
			noRawUnsafe: true,
			noUpdateManyWithoutWhere: true,
			requireOrderByForCursor: 'error',
			maxLimit: {
				level: 'warn',
				value: 500,
			},
		}),
	],
});
```

<div align="center">

## Rule levels

Every rule accepts:

</div>

- `true` as shorthand for `error`
- `false` as shorthand for `off`
- `'warn' | 'error' | 'off'`
- an object with `level` plus rule-specific options

```ts
rules({
	noRawUnsafe: true,
	requireRawTimeout: {
		level: 'warn',
		maxTimeoutMs: 30_000,
	},
});
```

<div align="center">

## Presets

The package ships with three preset helpers:

</div>

- `safe()`
- `recommended()`
- `strict()`

```ts
import { recommended, rules } from '@better-drizzle/rules';

const client = better(db, {
	schema,
	plugins: [
		rules(recommended())
	],
});
```

<div align="center">

## What it can enforce today

</div>

- missing or empty `where` clauses on destructive writes
- unbounded reads, missing `limit`, oversized `limit`, and missing `orderBy`
- include depth and relation-count limits
- lock usage rules
- raw SQL guardrails like `noRawUnsafe`, `requireRawComment`, and `noRawMutation`
- tenant-context checks based on `meta` / `$withContext(...)`
- sensitive select policies when sensitive fields are explicitly selected

<div align="center">

## Current boundary

The plugin is intentionally runtime-only and hook-driven. If the current Better Drizzle hook payload does not expose enough information to evaluate a rule safely, that rule is ignored rather than guessed.

</div>
