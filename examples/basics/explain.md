# Explain

Every read operation returns an explainable result -- a lazy promise with an `.explain()` method that inspects the query plan without executing the query.

## Basic usage

```ts
const plan = await client.users
  .findMany({ where: { active: true } })
  .explain();

console.log(plan.driver);      // "sqlite" | "pg" | "mysql"
console.log(plan.operation);   // "findMany"
console.log(plan.statements);  // [{ key: "data", sql: "...", ... }]
```

## Lazy execution

The real query does not start until `.then()`, `.catch()`, or `.finally()` is called. `.explain()` runs the EXPLAIN path independently:

```ts
const result = client.users.findMany({ where: { active: true } });

// Inspect the plan first
const plan = await result.explain({ analyze: true });
console.log(plan.statements[0].sql);

// Then decide whether to run the query
const users = await result;
```

## Options

```ts
const plan = await client.users
  .findMany({ where: { active: true } })
  .explain({
    analyze: true,
    verbose: true,
    costs: false,
    timing: true,
    summary: false,
    name: 'users.findMany',
    comment: 'active user lookup',
    timeoutMs: 5000,
  });
```

### Per-dialect support

| Option | PostgreSQL | MySQL | SQLite |
| --- | --- | --- | --- |
| `analyze` | Yes | Yes | ignored |
| `verbose` | Yes | ignored | ignored |
| `costs` | Yes | ignored | ignored |
| `timing` | Yes | ignored | ignored |
| `summary` | Yes | ignored | ignored |
| `name` | Yes | ignored | ignored |
| `comment` | Yes | ignored | ignored |
| `timeoutMs` | Yes | Yes | Yes |

Unsupported options are silently ignored. Check `statement.ignoredOptions` to see which were dropped.

## Result shape

```ts
{
  driver: "sqlite",
  operation: "findMany",
  statements: [
    {
      key: "data",
      sql: "select ... from users where active = ?",
      params: [1],
      appliedOptions: {},
      ignoredOptions: ["analyze", "verbose", "costs", "timing", "summary", "name", "comment"],
      raw: [{ id: 1, parent: 0, detail: "SCAN TABLE users" }],
    }
  ]
}
```

## Multi-statement operations

**paginate** produces two statements (data + total):

```ts
const plan = await client.users
  .paginate({ limit: 10, orderBy: { id: 'asc' } })
  .explain();

console.log(plan.statements.map(s => s.key));
// ["data", "total"]
```

**cursor** produces the data query plus probe queries:

```ts
const plan = await client.users
  .cursor({ after: cursor, limit: 25, orderBy: { id: 'asc' } })
  .explain();

console.log(plan.statements.map(s => s.key));
// ["data", "probe:hasPrevious"]
```

## Checking applied vs ignored options

```ts
const plan = await client.users
  .findMany({ where: { active: true } })
  .explain({ analyze: true, verbose: true });

const stmt = plan.statements[0];

// On SQLite: stmt.ignoredOptions === ["analyze", "verbose"]
// On PostgreSQL: stmt.appliedOptions === { analyze: true, verbose: true }
```

## Plugin transforms are reflected

`.explain()` runs the plugin transform pipeline but skips query hooks:

```ts
const plan = await client.users
  .findMany({ where: { id: 1 } })
  .explain();

// If a plugin injected extra filters, the SQL reflects them
console.log(plan.statements[0].sql);
```

## Which operations support it?

| Operation | `.explain()` |
| --- | --- |
| `findMany`, `findFirst`, `findOne`, `findUnique` | Yes |
| `count`, `exists` | Yes |
| `paginate`, `cursor` | Yes |
| All write operations | No |
