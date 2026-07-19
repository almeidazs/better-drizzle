<div align="center">

# Better Drizzle

### @better-drizzle/eslint

Static Better Drizzle guardrails for ESLint and IDE feedback.

[`@better-drizzle/eslint`](https://npmjs.com/package/@better-drizzle/eslint) is the first-party ESLint plugin for catching common Better Drizzle mistakes directly in the editor. It mirrors the statically-checkable subset of [`@better-drizzle/rules`](https://npmjs.com/package/@better-drizzle/rules) for direct Better Drizzle call sites.

## Install

</div>

```bash
npm install -D eslint @typescript-eslint/parser @better-drizzle/eslint
```

<div align="center">

## Usage

</div>

```ts
import { recommended } from '@better-drizzle/eslint';

export default [...recommended];
```

<div align="center">

You can also register the plugin manually:

</div>

```ts
import parser from '@typescript-eslint/parser';
import betterDrizzle from '@better-drizzle/eslint';

export default [
	{
		files: ['**/*.{ts,tsx,mts,cts}'],
		languageOptions: {
			parser,
		},
		plugins: {
			'better-drizzle': betterDrizzle,
		},
		rules: {
			'better-drizzle/no-raw-unsafe': 'error',
			'better-drizzle/no-update-many-without-where': 'error',
			'better-drizzle/require-order-by-for-cursor': 'warn',
		},
	},
];
```

<div align="center">

## Presets

</div>

- `safe`
- `recommended`
- `strict`

<div align="center">

These presets mirror the statically-safe subset of `@better-drizzle/rules`. Runtime-only rules such as transaction-state, tenant-context, and dialect checks remain exclusive to the runtime plugin.

## What it can enforce today

</div>

- missing or empty `where` clauses on destructive writes
- unbounded `findMany()` calls
- missing `limit` / oversized `limit`
- missing `orderBy` on pagination and cursor calls
- include depth and include relation-count limits
- invalid lock combinations visible in query args
- `$rawUnsafe()` usage and literal raw mutation checks
- explicit selection of sensitive fields
- `$withoutPlugins()` usage without an explicit reason

<div align="center">

## Current boundary

The plugin only analyzes direct, obvious Better Drizzle calls in the AST such as `client.users.findMany(...)`, `client.repository('users').updateMany(...)`, and `$rawUnsafe(...)`. It does not try to infer transaction state, merged runtime metadata, dialect behavior, or complex wrappers.

</div>
