# Plugins

Read this file for official plugins, custom plugin authoring, and plugin-aware review.

Public docs:

- `https://better-drizzle.com/docs/plugins/overview`
- `https://better-drizzle.com/docs/plugins/writing-plugins`
- `https://better-drizzle.com/docs/plugins/rules`
- `https://better-drizzle.com/docs/plugins/zod`
- `https://better-drizzle.com/docs/plugins/soft-delete`
- `https://better-drizzle.com/docs/plugins/timestamps`

## Plugin model

- Plugins are registered through `options.plugins` in array order.
- Plugin ids must be unique.
- `setup()` runs exactly once during client initialization.
- Plugin hooks and transforms are the mutation layer.
- Client hooks remain side-effect-only.

## Official packages

- `@better-drizzle/eslint`
- `@better-drizzle/rules`
- `@better-drizzle/soft-delete`
- `@better-drizzle/timestamps`
- `@better-drizzle/zod`

`@better-drizzle/eslint` is the static/IDE surface. `@better-drizzle/rules` is the runtime surface. Do not describe them as equivalent; many rules depend on runtime state and only exist in the runtime plugin.

`@better-drizzle/zod` is the runtime schema-generation and validation surface. It exposes generated schemas on `db.<table>.$zod` and can validate payloads, query args, and results through plugin hooks.

## Typed extension points

- Plugins can extend built-in operation args through `operationArgs`.
- These fields flow through delegates, plugin transforms, and client hooks.
- `upsertMany` is create-oriented for plugin hook classification.
- `updateEach` has its own plugin kind but still flows through update hooks.

## Example patterns

**Official plugin stack**

```ts
import { zod } from '@better-drizzle/zod';

const client = better(db, {
	schema,
	plugins: [
		rules(
			recommended({
				noRawUnsafe: true,
			}),
		),
		timestamps({
			createdAt: 'created_at',
			updatedAt: 'updated_at',
		}),
		zod({
			validate: {
				create: true,
				update: true,
				result: true,
			},
		}),
		softDelete({
			column: 'deletedAt',
			defaults: {
				mode: 'soft',
				visibility: 'without',
			},
		}),
	],
});
```

**Plugin-aware delegate call**

```ts
await client.users.findMany({
	deleted: 'only',
});
```

## Agent checks

- confirm the plugin kind matches the operation being changed
- do not describe `packages/rules` as compile-time or schema-migration based; it is runtime and hook-driven
- when `@better-drizzle/zod` is involved, verify both runtime validation behavior and the exposed `$zod` typing surface
- if plugin behavior changes user-facing docs, update docs and examples accordingly

## Anti-patterns

- treating client hooks as the main mutation mechanism instead of plugin transforms
- describing plugin order as irrelevant
- implying `setup()` runs on every transaction bind
