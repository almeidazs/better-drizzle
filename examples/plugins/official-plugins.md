# Official plugins

The repository currently includes three runtime plugins plus one ESLint plugin:

- `@better-drizzle/eslint`
- `@better-drizzle/rules`
- `@better-drizzle/timestamps`
- `@better-drizzle/soft-delete`

## When to use them

| Plugin | Good fit when | Main behavior |
| --- | --- | --- |
| ESLint | you want IDE and CI feedback before code runs | flags the statically-checkable subset of Better Drizzle guardrails on direct call sites |
| Rules | you want runtime guardrails around repository usage | validates raw SQL, destructive writes, limits, lock usage, and context requirements |
| Timestamps | your app wants `createdAt` / `updatedAt` managed consistently | fills timestamp columns during create, update, updateEach, upsert, and upsertMany flows |
| Soft delete | rows should stay recoverable and filtered by default | overrides deletes, filters reads, and adds restore helpers |

## Composition example

```ts
import { better } from 'better-drizzle';
import { rules, recommended } from '@better-drizzle/rules';
import { timestamps } from '@better-drizzle/timestamps';
import { softDelete } from '@better-drizzle/soft-delete';

const client = better(db, {
	schema,
	plugins: [
		rules(
			recommended({
				noRawUnsafe: true,
			}),
		),
		timestamps({
			createdAt: 'createdAt',
			updatedAt: 'updatedAt',
		}),
		softDelete({
			column: 'deletedAt',
			deletedByColumn: 'deletedById',
			defaults: {
				mode: 'soft',
				visibility: 'without',
			},
		}),
	],
});
```

## Order matters

Plugins run in array order.
If two plugins transform the same operation, the earlier plugin runs first.

`@better-drizzle/eslint` is separate from that runtime pipeline. It runs in ESLint and mirrors only the statically-safe subset of `@better-drizzle/rules`.

That matters when:

- one plugin adds fields another plugin expects
- one plugin changes visibility or mode flags
- lifecycle hooks emit audit events that depend on transformed data
