# Troubleshooting

Read this file for debugging, migration, support, or limitation-oriented tasks.

Public docs:

- `https://better-drizzle.com/docs/guides/migrating-from-drizzle`
- `https://better-drizzle.com/docs/guides/limitations`
- `https://better-drizzle.com/docs/guides/service-patterns`
- `https://better-drizzle.com/docs/reference/support-matrix`

## Common guidance

- Verify the method or option exists in the current delegate surface before proposing fixes.
- Check dialect-specific limitations before blaming TypeScript or Drizzle.
- Prefer simple reproductions and direct examples over abstractions.

## Known areas to watch

- lock support is PostgreSQL/MySQL only, and relation loading with locks is intentionally rejected
- raw APIs have separate safety rules and hook behavior
- nested transactions on SQLite rely on explicit SQL because Bun SQLite transaction callbacks are synchronous
- `upsertMany` and `updateEach` are native-first and intentionally reject unsupported shapes

## Migration framing

When helping users move from raw Drizzle:

- keep Drizzle schema definitions and client creation intact
- show `better(db, { schema })` as a wrapper, not a replacement ORM
- only move common repository glue into delegates
- keep raw SQL available where it is clearer

## Example migration sketch

```ts
const db = drizzle(sqlite, { schema });
const client = better(db, { schema });

const user = await client.users.findFirst({
	where: { id: 1 },
});
```
