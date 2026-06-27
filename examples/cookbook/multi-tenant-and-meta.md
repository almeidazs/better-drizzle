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

## Scope default metadata with `$withContext(...)`

```ts
const scoped = client.$withContext({
	requestId: 'req_123',
	tenantId: 'tenant_42',
});

await scoped.users.findMany({
	where: {
		active: true,
	},
});
```

Per-call `meta` still wins on key conflicts:

```ts
await scoped.users.create({
	data: { name: 'Alice' },
	meta: {
		requestId: 'req_override',
		userId: 'admin_7',
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

Transaction options also accept a context object, and can override scoped `meta` too:

```ts
await client.transaction(
	async (tx) => {
		return tx.users.findMany();
	},
	{
		meta: {
			requestId: 'req_tx',
		},
		context: {
			requestId: 'req_123',
			tenantId: 'tenant_42',
		},
	},
);
```

Hooks and plugins can then read `meta` and `transactionContext`.

## Where this pattern fits

- tenant-aware audit logging
- request tracing
- consistent correlation IDs across repository calls and raw SQL
