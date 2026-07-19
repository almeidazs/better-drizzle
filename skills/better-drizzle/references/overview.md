# Overview

`better-drizzle` is a small Bun/TypeScript workspace centered on `packages/core`, with official plugins, examples, benchmarks, and a Fumadocs site.

Public docs live at `https://better-drizzle.com/docs`.

## Core positioning

- It wraps an existing Drizzle client.
- It does not replace raw Drizzle for fully manual SQL work.
- It aims to remove repetitive repository glue while staying close to the metal.

## Primary public surface

Table delegates expose:

- `findMany`
- `findFirst`
- `findOne`
- `findUnique`
- `create`
- `createMany`
- `update`
- `updateEach`
- `updateMany`
- `delete`
- `deleteMany`
- `upsert`
- `upsertMany`
- `count`
- `exists`
- `paginate`
- `cursor`
- `$withState`
- `$withoutPlugins`

Client-level capabilities include:

- `repository(name)`
- `transaction(callback, options?)`
- `$withContext(meta)`
- `$raw`
- `$executeRaw`
- `$rawUnsafe`
- `afterCommit`
- `afterRollback`

## Repo expectations

- Keep code minimal and avoid helpers that do not clearly pay for themselves.
- Preserve benchmark parity claims honestly.
- Use `BetterDrizzleError` for library-thrown runtime errors.
- Keep user-facing docs synchronized across the root and core READMEs.

## Example mental model

Think of `better-drizzle` as:

1. normal Drizzle schema definitions
2. normal Drizzle client creation
3. one wrapper call: `better(db, { schema })`
4. typed delegates for the repetitive repository-shaped work

Use this framing in explanations. Do not present it as a new ORM or a schema layer that replaces Drizzle.
