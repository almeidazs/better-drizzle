# Troubleshooting

Read this file for debugging, migration, support, or limitation-oriented tasks.

Public docs:

- `https://better-drizzle.com/docs/guides/migrating-from-drizzle`
- `https://better-drizzle.com/docs/guides/limitations`
- `https://better-drizzle.com/docs/guides/service-patterns`
- `https://better-drizzle.com/docs/reference/support-matrix`
- `https://better-drizzle.com/docs/guides/upgrading`

## Common guidance

- Verify the method or option exists in the current delegate surface before proposing fixes.
- Check dialect-specific limitations before blaming TypeScript or Drizzle.
- Prefer simple reproductions and direct examples over abstractions.

## Known areas to watch

- lock support is PostgreSQL/MySQL only, and relation loading with locks is intentionally rejected
- raw APIs have separate safety rules and hook behavior
- nested transactions on SQLite rely on explicit SQL because Bun SQLite transaction callbacks are synchronous; `client.transaction(async (tx) => ...)` still accepts async callbacks
- `No tables found on the Drizzle instance` means `drizzle()` was created without `relations`
- Drizzle 1.x wraps driver errors in `DrizzleQueryError` with the driver error as `cause`; `BetterDrizzleError.from(...)` and the `is*Violation` helpers read the wrapped error
- users on `drizzle-orm` 0.x stay on better-drizzle 0.2.x; moving to 1.x is covered by `https://better-drizzle.com/docs/guides/upgrading`
- `upsertMany` and `updateEach` are native-first and intentionally reject unsupported shapes

## Migration framing

When helping users move from raw Drizzle:

- keep Drizzle table definitions intact; declare relations with `defineRelations` and pass them to `drizzle()`
- show `better(db)` as a wrapper, not a replacement ORM
- only move common repository glue into delegates
- keep raw SQL available where it is clearer

## Example migration sketch

```ts
import { relations } from './relations'; // defineRelations(schema, ...)

const db = drizzle({ client: sqlite, relations });
const client = better(db);

const user = await client.users.findFirst({
	where: { id: 1 },
});
```
