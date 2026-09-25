import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { BetterDrizzleClient } from './delegate';

const accounts = sqliteTable('atomic_type_accounts', {
	active: integer('active', { mode: 'boolean' }).notNull(),
	balance: integer('balance').notNull(),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

declare const db: BetterDrizzleClient<{ accounts: typeof accounts }>;

db.accounts.update({
	data: {
		active: { toggle: true },
		balance: { decrement: 1, increment: 2, multiply: 3, set: 10 },
	},
	where: { id: 1 },
});

db.accounts.updateEach({
	by: accounts.id,
	data: [{ delta: 2, id: 1 }],
	update: { balance: (row) => ({ increment: row.delta as number }) },
});

db.accounts.update({
	data: {
		// @ts-expect-error string columns do not accept scalar mutation envelopes
		name: { increment: 1 },
	},
	where: { id: 1 },
});

db.accounts.update({
	data: {
		// @ts-expect-error boolean columns only support toggle
		active: { increment: 1 },
	},
	where: { id: 1 },
});
