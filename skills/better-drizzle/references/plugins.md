# Plugins, hooks, and extensions

Docs: `/docs/plugins/overview`, `/writing-plugins`, `/rules`, `/eslint`, `/zod`, `/ata`, `/soft-delete`, `/timestamps`, `/cache`, `/docs/advanced/hooks`, `/docs/guides/client-extensions` (all under `https://better-drizzle.com`).

## Official plugins

All ship in the one `better-drizzle` package as subpaths (the old `@better-drizzle/*` packages are discontinued).

```ts
import { rules, recommended } from 'better-drizzle/rules';
import { timestamps } from 'better-drizzle/timestamps';
import { softDelete } from 'better-drizzle/soft-delete';
import { zod } from 'better-drizzle/zod';

const client = better(db, {
	plugins: [
		rules(recommended({ maxLimit: { level: 'error', value: 200 } })),
		timestamps(), // createdAt / updatedAt are table keys, not SQL names
		softDelete(), // column: 'deletedAt'
		zod({ schemas: { users: { fields: { email: (s) => s.email() } } } }),
	],
});
```

| Plugin | What it does | Key API |
| --- | --- | --- |
| `rules` | Runtime guardrails from hook payloads: no `deleteMany`/`updateMany` without `where`, `maxLimit`, orderBy for pagination, lock policy, `noRawUnsafe`, tenant/audit context, sensitive fields | presets `safe()`, `recommended()`, `strict()`; each rule takes `true`/`false`, `'off'\|'warn'\|'error'`, or `{ level, ...options }` |
| `eslint` | Static subset of `rules` for direct call sites | `betterDrizzle.configs.{safe,recommended,strict}` flat configs |
| `timestamps` | Fills `createdAt`/`updatedAt` on writes | `{ createdAt?, updatedAt?, mode?: 'app' \| 'database' }`; writes `Date`, or ISO strings for text columns |
| `softDelete` | `delete`/`deleteMany` become updates; every read, update, and delete skips deleted rows (not `upsert`/`upsertMany` or includes) | arg `deleted: 'without' \| 'with' \| 'only'` on each; delete args `mode: 'hard'` (matches deleted rows too), `deletedBy`; `restore({ where })`, `restoreById(id)` |
| `zod` | Per-table Zod schemas on `client.users.$zod.{create,update,upsert,select,where,orderBy,pagination,query}` plus validation | `validate` defaults: writes and `result` on, read args off; per call `validate: false` |
| `ata` | The same idea with JSON Schema and compiled ata validators on `$ata` | `{ validate, tables: { users: { columns } }, precompile }` |
| `cache` | Caches opted-in reads in a store (`better-drizzle/cache/redis` wraps your Bun/ioredis/node-redis client). Writes invalidate dependents after commit | `cache({ store: redis({ client }), ttl: '5m', models?, vary?, enabled? })`; read arg `cache: true \| false \| 'key' \| { ttl, tags, key, refresh, vary, afterHooks }`; write/raw arg `cache: { invalidate: { models, tags } }`; `client.$cache.invalidate({ models, tags, keys })`, `$cache.clear()` |

- Plugins run in array order. Ids must be unique. `setup()` runs once per `better()` call, not per transaction.
- Transforms affect only the root query. Relations loaded through `include` are not rewritten, so soft-deleted or other-tenant children can still appear.
- `$withoutPlugins()` bypasses every plugin (for example a real hard delete). Raw SQL also bypasses plugins.
- `cache` is experimental in 0.3.x: options, `$cache`, the store interface, and the entry format can change in a patch release.
- `ata` is experimental in 0.3.x: JSON Schema validation compiled with `ata-validator`, intended as a faster alternative to `zod`. Options, `$ata`, and the generated schemas can change in a patch release.
- Cache gotchas: `meta` is not in automatic keys, so tenant data that comes from `meta` needs `vary`. Custom keys bypass query hashing and `vary`; callers must separate queries and tenants. Reads inside transactions and reads with `lock` are never cached. Raw SQL without `cache.invalidate` and raw Drizzle writes do not invalidate anything; call `$cache.invalidate()`. Store failures fall back to the database and reach `onError`. Commit and invalidation are separate operations, so TTL limits entry lifetime rather than guaranteeing consistency. Automatic hashing preserves `orderBy` priority and bypasses cyclic or unsupported values; unsupported result values are returned without caching.

## Writing a plugin

```ts
import { definePlugin } from 'better-drizzle/plugins';

export const tenantScope = () =>
	definePlugin({
		id: '@acme/tenant-scope',
		config: { requires: { columns: [{ column: 'tenantId', optional: true }] } },
		operationArgs: { findMany: { includeArchived: undefined as boolean | undefined } },
		transform(operation) {
			if (!operation.model.hasColumn('tenantId')) return operation;
			const tenantId = (operation.meta as { tenantId?: string } | undefined)?.tenantId;
			if (operation.kind === 'findMany')
				operation.where = { AND: [operation.where ?? {}, { tenantId }] } as typeof operation.where;
			return operation;
		},
		hooks: { afterCreate(ctx) { /* side effects */ } },
		extendModel: ({ model }) => ({ tableName: model.name }),
		extendClient: ({ client }) => ({ health: () => client.$raw`select 1` }),
	});
```

- `intercept(ctx)` wraps execution after transforms and the client before hook: `await ctx.next()` runs the operation, returning without it skips SQL, `ctx.annotate(key, value)` reaches after hooks as `annotations`, and `ctx.skipAfterHooks()` skips them. The first plugin is outermost. `.explain()` never runs intercepts.
- `transform` is the mutation layer. It returns the operation, and its `kind` is one of the delegate names. `upsertMany` is create-like. `updateEach` flows through update hooks.
- `setup(ctx)` receives `ctx.schema` (the relations config: `{ [key]: { table, name, relations } }`), `ctx.models` (per table: `columns`, `hasColumn`, `primaryKey`, `relations`), `ctx.dialect`, `addHook`, and `addTransform`.
- `config.requires.columns[].type` matches `columnType` (`'PgTimestamp'`), the full `dataType` (`'object date'`), or one part of it (`'date'`). Compare `dataType` with `startsWith('string')`, not `===`.
- Table-dependent model extension types: declare an interface extending `ModelExtensionTypeResolver` that reads `this['schema']` and `this['name']`, and pass it as `definePlugin`'s 6th type argument. Generic function resolvers can hit TS2589.
- Validation errors fail at `better()` time with `PLUGIN_*` codes (duplicate id, missing column, extension conflict).

## Client hooks

Side effects only: logging, metrics, auditing. Use plugins to change queries.

`beforeQuery`, `afterQuery`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`, `onError`, `beforeRaw`, `afterRaw`, `onRawError`, `beforeTransaction`, `afterTransactionCommit`, `afterTransactionRollback`, `onTransactionError`.

```ts
better(db, { hooks: { afterQuery: ({ table, action, meta }) => log(table, action, meta?.requestId) } });
```

## `extends()` for app helpers

```ts
export const client = better(db).extends((c) => ({
	findUserByEmail: (email: string) => c.users.findUnique({ where: { email } }),
}));
```

Extensions stay typed on `$withContext()` clones and `tx`. Overriding an existing key throws `PLUGIN_EXTENSION_CONFLICT`. Call `extends()` once at startup, never per request.
