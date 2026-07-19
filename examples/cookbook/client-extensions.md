# Client extensions

`client.extends(...)` is the lightest way to attach application-specific helpers or shared values to a Better Drizzle client.

## Object form

Use the object form when you just want to attach static values:

```ts
const client = better(db, { schema }).extends({
	tenantScope: 'public',
});

console.log(client.tenantScope);
```

## Callback form

Use the callback form when the helper needs the bound client instance:

```ts
const client = better(db, { schema }).extends((client) => ({
	findByIdOrName(idOrName: number | string) {
		return typeof idOrName === 'number'
			? client.users.findFirst({ where: { id: idOrName } })
			: client.users.findFirst({ where: { name: idOrName } });
	},
}));

const user = await client.findByIdOrName('Alice');
```

## Propagation rules

Extensions are reapplied to derived clients too:

```ts
const base = client.extends((client) => ({
	findById(id: number) {
		return client.users.findFirst({ where: { id } });
	},
}));

const scoped = base.$withContext({ requestId: 'req-1' });
const user = await scoped.findById(1);

await base.transaction(async (tx) => {
	await tx.findById(1);
});
```

## Rule of thumb

Use `extends()` for small application helpers close to your service layer.
If the behavior needs lifecycle hooks, transforms, typed operation args, or model-level helpers, it probably belongs in a plugin instead.
