# Querying

Docs: `/docs/querying/reads`, `/filters`, `/relations`, `/selecting-fields`, `/pagination`, `/explain`, `/jsonb`, `/arrays`, `/docs/advanced/locks` (all under `https://better-drizzle.com`).

## Filters

A bare value means `equals`. `undefined` values are ignored: on reads, `{ where: { id: undefined } }` matches every row; on `update`/`updateMany`/`delete`/`deleteMany` an empty `where` is a no-op (`null` / `{ count: 0 }`). Guard optional inputs or use the rules plugin's `noEmptyWhere`.

| Column | Operators |
| --- | --- |
| string | `equals`, `in`, `notIn`, `contains`, `startsWith`, `endsWith`, `not`, `mode: 'insensitive'` (patterns only: `ILIKE` on PostgreSQL, `lower(col) LIKE lower(?)` on SQLite/MySQL) |
| number / bigint / Date | `equals`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`, `not` |
| boolean | `equals`, `not` |
| nullable | `null` or `{ not: null }` |
| logical | `AND: [...]`, `OR: [...]`, `NOT` (object or array) |
| to-one relation | `is`, `isNot` (a filter or `null`) |
| to-many / many-to-many | `some`, `every`, `none` |

```ts
await client.posts.findMany({
	where: {
		published: true,
		title: { contains: 'drizzle' },
		OR: [{ score: { gte: 10 } }, { author: { is: { role: 'admin' } } }],
		comments: { none: { flagged: true } },
	},
});
```

`where` also accepts a Drizzle `SQL` fragment: `where: sql\`${posts.score} > ${posts.minScore}\``.

`contains` and `startsWith` escape `%`, `_`, and the SQL escape character as literal text, including insensitive/negated filters, JSONB paths, array elements, and prepared params. Use raw SQL for wildcard patterns.

### Reusing a filter in raw Drizzle: `$where()`

`client.<table>.$where(where)` compiles the same typed `where` as `findMany` (logical operators and relation filters included) into a Drizzle `SQL` condition, for raw `db.select()` queries, joins, and subqueries. It runs nothing.

```ts
const rows = await db
	.select()
	.from(posts)
	.innerJoin(users, eq(posts.userId, users.id))
	.where(and(client.users.$where({ active: true }), client.posts.$where({ score: { gt: 10 } })));
```

- An empty `where` returns `undefined` (Drizzle treats it as no filter).
- It is pure compilation: plugin filters (soft-delete visibility, tenant scopes) are **not** applied; add them yourself.

## Projections and relations

```ts
// select narrows the result type; relations take nested read args
await client.users.findMany({
	select: {
		id: true,
		name: true,
		posts: {
			where: { published: true },
			orderBy: { id: 'desc' },
			take: 3,
			select: { id: true, title: true },
		},
	},
});

// include keeps every scalar and adds relations and counts
await client.users.findUnique({
	where: { id: 1 },
	include: {
		profile: true,
		_count: { select: { posts: true, comments: { where: { approved: true } } } },
	},
});
```

- Unknown `select` keys throw at runtime even when set to `false` or `undefined`, including nested projections.
- The loader runs one query for the root plus one per relation node, never one per parent row. Nested `take`/`skip` are per parent.
- `_count` is a correlated subquery in the same statement and works for one, many, and `.through()` relations.
- Relations come only from `defineRelations`. A `.references()` foreign key alone is not a relation.

## Ordering

```ts
orderBy: { createdAt: 'desc' }
orderBy: [{ lastSeenAt: { direction: 'desc', nulls: 'last' } }, { id: 'asc' }]
```

Only scalar columns of the queried table are allowed. There is no ordering by relation columns or SQL expressions.

## Pagination

```ts
const { data, pagination: { total, pageCount, hasNext } } = await client.users.paginate({
	where: { active: true },
	orderBy: { id: 'asc' },
	page: 3,
	perPage: 25, // or limit + skip; page cannot be combined with skip
});

const first = await client.users.cursor({ orderBy: { id: 'asc' }, limit: 20 });
const next = await client.users.cursor({
	orderBy: { id: 'asc' },
	limit: 20,
	after: first.pagination.nextCursor, // typed cursor object, e.g. { id: 20 }, or null
});
```

- `paginate` runs a data query plus a `count`. `page` is derived as `Math.floor(skip / perPage) + 1`.
- `cursor` orders by the primary key when `orderBy` is missing. Include a unique column last in `orderBy` for stable pages.
- `count` and `exists` accept `where` and `cursor`, and nothing else.

## Explain

```ts
const plan = await client.users.findMany({ where: { active: true } }).explain({ analyze: true });
// { driver, operation, statements: [{ key, sql, params, raw, ignoredOptions }], deferredRelations?, deferredProbes? }
```

Relation stages appear under `deferredRelations`. With `analyze: true`, PostgreSQL and MySQL execute the statement. SQLite uses `EXPLAIN QUERY PLAN` and ignores `analyze`.

## Row locks (PostgreSQL, MySQL)

```ts
await client.transaction(async (tx) => {
	const jobs = await tx.jobs.findMany({
		where: { status: 'pending' },
		orderBy: { id: 'asc' },
		take: 10,
		lock: { mode: 'update', skipLocked: true }, // or 'update' | 'share'
	});
});
```

- Modes are `update`, `share`, plus `noKeyUpdate` and `keyShare` on PostgreSQL. `skipLocked` and `noWait` are mutually exclusive. `tables` is PostgreSQL-only.
- SQLite throws `LOCK_NOT_SUPPORTED`. `count`, `exists`, and writes have no `lock`.
- Relation loading is rejected, except one to-one `include` whose relation is also filtered with `is` (compiled to an inner join).
- Outside a transaction, a lock is released when the statement ends. `better(db, { locks: { transactionsOnly: true } })` enforces transactions.

## JSONB (PostgreSQL `jsonb` columns)

```ts
// jsonb('metadata').$type<{ profile: { age: number; city: string } }>()
where: { metadata: { 'profile.age': { gte: 18 }, 'profile.city': 'Lisbon' } }
```

- Dotted keys are path filters only on PostgreSQL `jsonb` columns. On other JSON columns they are whole-document equality and match nothing.
- Root-level keys use the `{ json: { nickname: ... } }` wrapper (a dotless key directly on the column is document equality). The wrapper also takes dotted paths and throws `JSONB_QUERY_UNSUPPORTED` outside PostgreSQL.
- `json` (not `jsonb`) columns throw on path filters, even though they type-check.
- Containment and other operators: pass a Drizzle `sql` fragment.

## Arrays (PostgreSQL `.array()` columns)

```ts
where: {
	tags: { has: 'drizzle', length: { lte: 5 } },
	roles: { hasEvery: ['admin', 'editor'] },
	scores: { some: { gt: 100 } }, // also every / none with the element's filter
}
```

Operators: `has`, `hasEvery`, `hasSome`, `hasNone`, `containedBy`, `isEmpty`, `length`, `equals`, `some`/`every`/`none`. Outside PostgreSQL they throw `ARRAY_QUERY_UNSUPPORTED`.

## Prepared statements

```ts
import { param } from 'better-drizzle';

const byEmail = db.users.findUnique({ where: { email: param('email') } }).prepare('users.by-email');
await byEmail.execute({ email: 'a@example.com' }); // .throw() works on single-row reads
```

- Every read (`findUnique`, `findFirst`, `findOne`, `findMany`, `count`, `exists`, `paginate`, `cursor`) has `.prepare(name?)`. Writes cannot be prepared.
- `param()` replaces values: equality, operators, `not`, pattern operators, `take`/`skip`, `page`/`perPage`/`limit`, `after`/`before`/`cursor`. `in`/`notIn` params, array filters, and JSONB paths are PostgreSQL-only.
- Plugins (transforms, soft delete, rules) and `beforeQuery` run once at prepare time; `afterQuery`, intercepts, and the cache run per execution. Prepare a separate statement per plugin state or tenant.
- Relations load per execution; params inside relation `include`/`select` args throw `PREPARED_UNSUPPORTED`.
- A statement is bound to the client it was prepared on: prepare on `tx` to run inside a transaction.
- Prepare once (module scope or service construction), not per request.
