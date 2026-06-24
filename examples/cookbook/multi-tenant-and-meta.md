# Request metadata and multitenant patterns

Better Drizzle does not impose a multitenancy model, but it gives you enough surface to thread request metadata through hooks and plugins cleanly.

## Attach request metadata with `meta`

```ts
await client.users.findMany({
	meta: {
		requestId: 'req_123',
		tenantId: 'tenant_42',
		userId: 'admin_7',
	},
	where: {
		active: true,
	},
});
```

## Read it in hooks

```ts
const client = better(db, {
	schema,
	hooks: {
		beforeQuery(context) {
			console.log(context.meta?.tenantId);
			console.log(context.meta?.requestId);
		},
	},
});
```

## Transaction context

Transaction options also accept a context object:

```ts
await client.transaction(
	async (tx) => {
		return tx.users.findMany();
	},
	{
		context: {
			requestId: 'req_123',
			tenantId: 'tenant_42',
		},
	},
);
```

Hooks and plugins can then read `transactionContext`.

## Where this pattern fits

- tenant-aware audit logging
- request tracing
- consistent correlation IDs across repository calls and raw SQL
