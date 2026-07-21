import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core';
import type { BetterDrizzleClient } from './delegate';

type Metadata = {
	profile: { age: number; name: string; active?: boolean };
	tags: string[];
};
const events = pgTable('typed_jsonb_events', {
	id: integer('id').primaryKey(),
	metadata: jsonb('metadata').$type<Metadata>().notNull(),
	untyped: jsonb('untyped').notNull(),
});
declare const db: BetterDrizzleClient<{ events: typeof events }>;
void db.events.findMany({
	where: {
		metadata: {
			json: {
				'profile.age': { gte: 18 },
				'profile.name': { contains: 'Ana' },
				'profile.active': true,
			},
		},
	},
});
void db.events.findMany({
	where: {
		metadata: {
			json: {
				// @ts-expect-error paths must exist in the declared JSON shape
				'profile.missing': 1,
			},
		},
	},
});
void db.events.findMany({
	where: {
		metadata: {
			json: {
				'profile.age': {
					// @ts-expect-error number leaves do not expose string filters
					contains: '1',
				},
			},
		},
	},
});
void db.events.findMany({
	where: {
		metadata: {
			json: {
				'profile.name': {
					// @ts-expect-error string leaves do not expose numeric filters
					gte: 1,
				},
			},
		},
	},
});
void db.events.findMany({
	where: {
		metadata: {
			json: {
				// @ts-expect-error arrays are intentionally not addressable in v1
				tags: { contains: 'typescript' },
			},
		},
	},
});
