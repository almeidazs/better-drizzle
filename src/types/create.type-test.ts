import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { BetterDrizzleClient } from './delegate';

const users = sqliteTable('typed_create_users', {
	id: integer('id').primaryKey(),
	email: text('email').notNull(),
});
declare const db: BetterDrizzleClient<{ users: typeof users }>;

type Row = { id: number; email: string };
type IsNullable<T> = null extends T ? true : false;

const plain = db.users.create({ data: { email: 'a@example.com' } });
const skipAll = db.users.create({
	data: { email: 'a@example.com' },
	skipDuplicates: true,
});
const skipEmail = db.users.create({
	data: { email: 'a@example.com' },
	skipDuplicates: ['email'],
});

export const plainIsNotNullable: IsNullable<Awaited<typeof plain>> = false;
export const skipAllIsNullable: IsNullable<Awaited<typeof skipAll>> = true;
export const skipEmailIsNullable: IsNullable<Awaited<typeof skipEmail>> = true;
export const plainRow: Row = null as unknown as Awaited<typeof plain>;
