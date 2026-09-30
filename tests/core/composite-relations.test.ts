import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better } from '../../src';

test('many-to-many _count correlates every source key column', async () => {
	const owners = sqliteTable('composite_owners', {
		orgId: integer('org_id').notNull(),
		id: integer('id').notNull(),
	});
	const labels = sqliteTable('composite_labels', {
		id: integer('id').primaryKey(),
		name: text('name').notNull(),
	});
	const ownerLabels = sqliteTable('composite_owner_labels', {
		orgId: integer('org_id').notNull(),
		ownerId: integer('owner_id').notNull(),
		labelId: integer('label_id').notNull(),
	});
	const relations = defineRelations({ owners, labels, ownerLabels }, (r) => ({
		owners: {
			labels: r.many.labels({
				from: [
					r.owners.orgId.through(r.ownerLabels.orgId),
					r.owners.id.through(r.ownerLabels.ownerId),
				],
				to: r.labels.id.through(r.ownerLabels.labelId),
			}),
		},
	}));
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec(`
			CREATE TABLE composite_owners (org_id INTEGER NOT NULL, id INTEGER NOT NULL);
			CREATE TABLE composite_labels (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
			CREATE TABLE composite_owner_labels (org_id INTEGER NOT NULL, owner_id INTEGER NOT NULL, label_id INTEGER NOT NULL);
			INSERT INTO composite_owners VALUES (1, 1), (1, 2);
			INSERT INTO composite_labels VALUES (10, 'first'), (20, 'second');
			INSERT INTO composite_owner_labels VALUES (1, 1, 10), (1, 2, 20);
		`);
		const db = better(drizzle({ client: sqlite, relations }));
		const rows = await db.owners.findMany({
			include: { _count: { select: { labels: true } }, labels: true },
			orderBy: { id: 'asc' },
		});
		expect(rows.map((row) => row.labels.map((label) => label.id))).toEqual([
			[10],
			[20],
		]);
		expect(rows.map((row) => row._count.labels)).toEqual([1, 1]);
	} finally {
		sqlite.close();
	}
});
