import type { BetterDrizzleClient } from '../src';
import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core';

type Metadata = { profile: { age: number; name: string; active?: boolean }; tags: string[] };
const events = pgTable('typed_jsonb_events', { id: integer('id').primaryKey(), metadata: jsonb('metadata').$type<Metadata>().notNull(), untyped: jsonb('untyped').notNull() });
declare const db: BetterDrizzleClient<{ events: typeof events }>;
void db.events.findMany({ where: { metadata: { json: { 'profile.age': { gte: 18 }, 'profile.name': { contains: 'Ana' }, 'profile.active': true } } } });
// @ts-expect-error paths must exist in the declared JSON shape
void db.events.findMany({ where: { metadata: { json: { 'profile.missing': 1 } } } });
// @ts-expect-error number leaves do not expose string filters
void db.events.findMany({ where: { metadata: { json: { 'profile.age': { contains: '1' } } } } });
// @ts-expect-error string leaves do not expose numeric filters
void db.events.findMany({ where: { metadata: { json: { 'profile.name': { gte: 1 } } } } });
// @ts-expect-error arrays are intentionally not addressable in v1
void db.events.findMany({ where: { metadata: { json: { tags: { contains: 'typescript' } } } } });
// @ts-expect-error untyped JSONB does not expose the typed JSON path API
void db.events.findMany({ where: { untyped: { json: { anything: true } } } });
