# Plugin bypass and state

Two delegate helpers are especially useful when plugins are involved:

- `$withState(...)`
- `$withoutPlugins()`

## `$withState(...)`

This creates a cloned delegate with merged plugin state.

That is useful when a plugin needs a per-call flag without changing the base repository permanently.

```ts
const repo = client.users.$withState({
	withDeleted: true,
});

const users = await repo.findMany({
	orderBy: [{ id: 'asc' }],
});
```

## Example plugin idea

Inside a plugin transform:

```ts
transform(operation) {
	if (operation.state.withDeleted) return operation;
	return operation;
}
```

## `$withoutPlugins()`

This returns a cloned delegate that bypasses plugin transforms and plugin hooks.

```ts
await client.users.$withoutPlugins().delete({
	where: { id: 1 },
});
```

## Good uses

- force hard delete beneath a soft delete plugin
- internal repair scripts
- framework glue that must bypass cross-cutting transforms intentionally

## Rule

Treat `$withoutPlugins()` as an escape hatch.
It is powerful, but the point of plugins is to keep the normal path consistent.
