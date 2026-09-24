import { integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { better } from '../index';

const role = pgEnum('array_type_test_role', ['admin', 'member']);
const users = pgTable('array_type_test_users', {
	roles: role('roles').array().notNull(),
	scores: integer('scores').array().notNull(),
	name: text('name').notNull(),
});
const db = better(null as never, { schema: { users } });

db.users.findMany({
	where: { roles: { has: 'admin' }, scores: { hasEvery: [10, 20] } },
});
db.users.findMany({ where: { roles: ['admin'] } });
db.users.findMany({
	where: {
		roles: { every: { in: ['admin', 'member'] } },
		scores: { some: { gt: 10 }, none: { lt: 0 } },
	},
});
db.users.update({ data: { roles: ['admin'] }, where: { name: 'Ada' } });
db.users.update({
	data: { roles: { append: 'admin' } },
	where: { name: 'Ada' },
});
db.users.update({
	data: { roles: { prepend: ['admin', 'member'] } },
	where: { name: 'Ada' },
});
db.users.updateMany({ data: { scores: { remove: [10, 20] } } });
db.users.upsert({
	create: { name: 'Ada', roles: ['admin'], scores: [10] },
	update: { roles: { replace: { from: 'admin', to: 'member' } } },
	where: { name: 'Ada' },
});
db.users.upsert({
	create: { name: 'Ada', roles: ['admin'], scores: [10] },
	update: {
		scores: {
			replace: [
				{ from: 10, to: 20 },
				{ from: 20, to: 30 },
			],
		},
	},
	where: { name: 'Ada' },
});
db.users.updateMany({ data: { scores: { addUnique: 10 } } });
db.users.updateEach({
	by: users.name,
	data: [{ name: 'Ada' }],
	update: { roles: () => ({ append: 'member' }) },
});
db.users.upsertMany({
	data: [{ name: 'Ada', roles: ['admin'], scores: [10] }],
	target: 'name',
	update: { roles: { addUnique: 'member' } },
});
db.users.upsertMany({
	data: [{ name: 'Ada', roles: ['admin'], scores: [10] }],
	target: 'name',
	update: () => ({ scores: { prepend: 5 } }),
});
db.users.findMany({
	where: {
		// @ts-expect-error enum elements remain narrow
		roles: { has: 'potato' },
	},
});
db.users.findMany({
	where: {
		// @ts-expect-error enum element predicates remain narrow
		roles: { some: { equals: 'potato' } },
	},
});
db.users.findMany({
	where: {
		// @ts-expect-error numeric element predicates do not expose string patterns
		scores: { some: { contains: '10' } },
	},
});
db.users.update({
	data: {
		// @ts-expect-error enum elements remain narrow in updates
		roles: { append: 'potato' },
	},
	where: { name: 'Ada' },
});
db.users.updateEach({
	by: users.name,
	data: [{ name: 'Ada' }],
	update: {
		// @ts-expect-error updateEach preserves enum element narrowing
		roles: () => ({ append: 'potato' }),
	},
});
db.users.upsertMany({
	data: [{ name: 'Ada', roles: ['admin'], scores: [10] }],
	target: 'name',
	// @ts-expect-error upsertMany mutations apply only to PgArray fields
	update: {
		name: { append: 'Ada' },
	},
});
db.users.update({
	data: {
		// @ts-expect-error mutations apply only to native PostgreSQL arrays
		name: { append: 'Ada' },
	},
	where: { name: 'Ada' },
});
db.users.update({
	data: {
		// @ts-expect-error exactly one mutation operator is allowed
		roles: { append: 'admin', remove: 'member' },
	},
	where: { name: 'Ada' },
});
db.users.findMany({
	where: {
		// @ts-expect-error numeric arrays reject strings
		scores: { has: '10' },
	},
});
