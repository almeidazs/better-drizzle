# Writing a custom plugin

`definePlugin(...)` is the entry point for adding reusable behavior without wrapping `better(...)` manually in every service.

## What a plugin can do

- declare a stable `id`, `name`, and `version`
- add typed operation args
- transform operations before execution
- observe CRUD, query, raw, and transaction lifecycle hooks
- extend the client
- extend model delegates
- keep per-operation state through `$withState(...)`

## A realistic example

This plugin adds:

- a `traceId` argument on `findMany`
- a delegate helper `withDeleted()` that toggles plugin state
- a delegate helper `forceDelete(id)` that bypasses plugins

```ts
import { definePlugin } from 'better-drizzle';

export const traceAndVisibilityPlugin = definePlugin({
	id: '@example/trace-and-visibility',
	name: 'Trace And Visibility',
	description: 'Adds trace metadata and a withDeleted state flag.',
	operationArgs: {
		findMany: {
			traceId: undefined as string | undefined,
		},
	},
	extendModel({ client, model }) {
		if (!model.hasColumn('deletedAt')) return;

		return {
			forceDelete(id: number) {
				return client.$withoutPlugins().delete({
					where: { id },
				} as never);
			},
			withDeleted() {
				return client.$withState({ withDeleted: true });
			},
		};
	},
	hooks: {
		beforeQuery(context) {
			if (context.action === 'findMany' && context.args.traceId)
				console.log('trace', context.args.traceId);
		},
	},
	transform(operation) {
		if (!operation.model.hasColumn('deletedAt')) return operation;
		if (operation.state.withDeleted) return operation;
		if (
			operation.kind !== 'findMany' &&
			operation.kind !== 'findFirst' &&
			operation.kind !== 'count'
		)
			return operation;

		operation.where = (
			operation.where
				? { AND: [operation.where, { deletedAt: null }] }
				: { deletedAt: null }
		) as typeof operation.where;

		return operation;
	},
});
```

## Usage

```ts
const client = better(db, {
	schema,
	plugins: [traceAndVisibilityPlugin],
});

const visibleUsers = await client.users.findMany({
	traceId: 'req_123',
});

const allUsers = await (
	client.users as typeof client.users & {
		withDeleted(): typeof client.users;
	}
).withDeleted().findMany({
	traceId: 'req_123',
});
```

## Good plugin boundaries

Strong plugins usually do one narrow thing well:

- soft delete semantics
- timestamps
- audit metadata
- multitenancy filters
- visibility flags
- model-specific helper methods

If your plugin starts hiding most of Drizzle or replacing repository behavior wholesale, it is probably too broad.
