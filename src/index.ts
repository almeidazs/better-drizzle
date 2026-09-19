/**
 * Better Drizzle – A thin, type-safe repository layer on top of Drizzle ORM.
 *
 * @module better-drizzle
 *
 * @example
 * ```ts
 * import { better } from 'better-drizzle';
 * import { drizzle } from 'drizzle-orm/better-sqlite3';
 * import * as schema from './schema';
 *
 * const raw = drizzle('file:local.db');
 * const db = better(raw, { schema });
 *
 * // Create a record
 * await db.user.create({ data: { name: 'Alice', email: 'alice@example.com' } });
 *
 * // Query records
 * const users = await db.user.findMany({ where: { active: true } });
 * ```
 */

export { better } from './shared/client/factory';
export * from './shared/errors';
export * from './types';
export { version } from './version';
