# Plugin lifecycle and composition

This page explains what happens around plugin bootstrap and execution.

## Order of operations

1. `better(db, { schema, plugins })` bootstraps the runtime once.
2. Each plugin is initialized in array order.
3. `setup()` runs once during bootstrap.
4. `extendClient()` and `extendModel()` build extra client and delegate APIs.
5. For each operation, transforms and hooks run against the bound delegate or transaction client.

## Plugin order

```ts
const client = better(db, {
	schema,
	plugins: [
		firstPlugin,
		secondPlugin,
	],
});
```

If both plugins transform the same operation, `firstPlugin` sees and mutates it before `secondPlugin`.

## `setup()` runs once

This is the right place for:

- fail-fast validation
- hook registration through helper APIs
- one-time inspection of model shape

## Model requirements

Plugins can fail fast when a model is incompatible.

```ts
definePlugin({
	config: {
		requires: {
			columns: [
				{ column: 'deletedAt' },
			],
		},
	},
	id: 'requires-deleted-at',
});
```

## Transaction lifecycle hooks

Plugins can observe transaction flow too:

- `beforeTransaction`
- `afterTransactionCommit`
- `afterTransactionRollback`
- `onTransactionError`

This is useful for tracing and retry-aware side effects that should live beside the plugin, not in application handlers.

## Raw lifecycle hooks

Plugins can also observe raw SQL through:

- `beforeRaw`
- `afterRaw`
- `onRawError`

## Practical rule

If a concern needs to mutate arguments, change visibility, add repository helpers, or expose typed operation flags, it probably belongs in a plugin rather than a client hook.
