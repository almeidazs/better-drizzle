# Client hooks

Client hooks are the side-effect layer around Better Drizzle operations.

They are useful for:

- audit trails
- tracing
- metrics
- authorization checks
- request-scoped logging

## Hook surface

### CRUD and query hooks

- `beforeCreate`
- `afterCreate`
- `beforeUpdate`
- `afterUpdate`
- `beforeDelete`
- `afterDelete`
- `beforeQuery`
- `afterQuery`

### Transaction hooks

- `beforeTransaction`
- `afterTransactionCommit`
- `afterTransactionRollback`
- `onTransactionError`

### Raw SQL hooks

- `beforeRaw`
- `afterRaw`
- `onRawError`

## Basic setup

```ts
const client = better(db, {
	schema,
	hooks: {
		beforeCreate(context) {
			console.log('beforeCreate', context.action, context.table, context.meta);
		},
		afterCreate(context) {
			console.log('afterCreate', context.action, context.row);
		},
		beforeQuery(context) {
			console.log('beforeQuery', context.action, context.args.where);
		},
		afterQuery(context) {
			console.log('afterQuery', context.action, context.result);
		},
	},
});
```

## Request metadata with `meta`

```ts
await client.users.findMany({
	meta: {
		requestId: 'req_123',
		userId: 'admin_7',
	},
	where: {
		active: true,
	},
});
```

And then read it inside hooks:

```ts
const client = better(db, {
	schema,
	hooks: {
		beforeQuery(context) {
			console.log(context.meta?.requestId);
		},
	},
});
```

## Transaction lifecycle hooks

```ts
const client = better(db, {
	schema,
	hooks: {
		beforeTransaction(context) {
			console.log('tx start', context.name, context.depth);
		},
		afterTransactionCommit(context) {
			console.log('tx committed', context.attempt);
		},
		afterTransactionRollback(context) {
			console.log('tx rolled back');
		},
		onTransactionError(context) {
			console.error('tx error', context.error);
		},
	},
});
```

## Raw SQL hooks

```ts
const client = better(db, {
	schema,
	hooks: {
		beforeRaw(context) {
			console.log(context.action, context.comment, context.name);
		},
		afterRaw(context) {
			console.log(context.result);
		},
		onRawError(context) {
			console.error(context.query, context.error);
		},
	},
});
```

## Practical rule

Client hooks should observe and coordinate.
If you want to mutate operation behavior, that is usually plugin territory, not client-hook territory.
