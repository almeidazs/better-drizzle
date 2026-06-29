<div align="center">

# Frameworks

Framework-specific integration examples for the same core idea:
create Drizzle once, wrap it with `better(...)` once, then pass the resulting client through your normal application boundary.

</div>

Website docs: https://better-drizzle.com/docs/guides/frameworks

## Files

| File | Focus |
| --- | --- |
| [`bun-sqlite.md`](./bun-sqlite.md) | Smallest setup, no extra framework |
| [`express-postgres.md`](./express-postgres.md) | Conventional API server with route handlers |
| [`fastify-postgres.md`](./fastify-postgres.md) | Plugin-based request lifecycle with a shared client |
| [`nextjs-postgres.md`](./nextjs-postgres.md) | Route handlers and server actions |

## Integration rule

Do not recreate the Better client per request unless your architecture truly requires it.
In most apps, the cleanest pattern is one database client and one Better client per process.
