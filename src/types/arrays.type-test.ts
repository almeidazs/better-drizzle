import { integer, pgEnum, pgTable } from 'drizzle-orm/pg-core';

import { better } from '../index';

const role = pgEnum('array_type_test_role', ['admin', 'member']);
const users = pgTable('array_type_test_users', {
	roles: role('roles').array().notNull(),
	scores: integer('scores').array().notNull(),
});
const db = better(null as never, { schema: { users } });

db.users.findMany({
	where: { roles: { has: 'admin' }, scores: { hasEvery: [10, 20] } },
});
db.users.findMany({ where: { roles: ['admin'] } });
db.users.findMany({
	where: {
		// @ts-expect-error enum elements remain narrow
		roles: { has: 'potato' },
	},
});
db.users.findMany({
	where: {
		// @ts-expect-error numeric arrays reject strings
		scores: { has: '10' },
	},
});
