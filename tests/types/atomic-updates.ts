// Type-level assertions; checked by `bunx tsc --noEmit`, never executed.
import type { Database } from 'bun:sqlite';

import { better } from 'better-drizzle';
import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const players = sqliteTable('players', {
	id: integer('id').primaryKey(),
	bonus: integer('bonus'),
	highScore: integer('high_score').notNull(),
	name: text('name').notNull(),
});

declare const client: Database;
const db = better(drizzle({ client, relations: defineRelations({ players }) }));

void db.players.update({
	data: { bonus: { min: 10 }, highScore: { max: 5 } },
	where: { id: 1 },
});

void db.players.update({
	// @ts-expect-error max cannot be combined with another operator.
	data: { highScore: { increment: 1, max: 5 } },
	where: { id: 1 },
});

void db.players.update({
	// @ts-expect-error max and min cannot be combined.
	data: { highScore: { max: 5, min: 1 } },
	where: { id: 1 },
});

void db.players.update({
	// @ts-expect-error max applies to numeric columns only.
	data: { name: { max: 5 } },
	where: { id: 1 },
});
