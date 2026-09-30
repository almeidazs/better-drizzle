import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import {
	type AnySQLiteColumn,
	integer,
	sqliteTable,
} from 'drizzle-orm/sqlite-core';

import { better } from '../../src';
import { cache } from '../../src/plugins/cache';
import { createMemoryStore } from './memory-store';
import { createClient, users } from './suite';

test('updateEach with a primary-key column leaves unrelated entity lookups cached', async () => {
	const { client, count, sqlite } = createClient(createMemoryStore().store);
	try {
		const read = () =>
			client.users.findUnique({ where: { id: 2 }, cache: true });
		expect(await count(read)).toBe(1);
		await client.users.updateEach({
			by: users.id,
			data: [{ id: 1, name: 'Changed' }],
			update: { name: (row) => row.name },
		});
		expect(await count(read)).toBe(0);
	} finally {
		sqlite.close();
	}
});

const parents = sqliteTable('audit_parents', {
	id: integer('id').primaryKey(),
	code: integer('code').unique(),
});
const children = sqliteTable('audit_children', {
	id: integer('id').primaryKey(),
	parentId: integer('parent_id').references(() => parents.id, {
		onDelete: 'cascade',
		onUpdate: 'cascade',
	}),
});
const grandchildren = sqliteTable('audit_grandchildren', {
	id: integer('id').primaryKey(),
	childId: integer('child_id').references(() => children.id, {
		onDelete: 'cascade',
	}),
});
const schema = { parents, children, grandchildren };
const bothRelations = defineRelations(schema, (r) => ({
	parents: { children: r.many.children() },
	children: {
		parent: r.one.parents({ from: r.children.parentId, to: r.parents.id }),
		grandchildren: r.many.grandchildren(),
	},
	grandchildren: {
		child: r.one.children({
			from: r.grandchildren.childId,
			to: r.children.id,
		}),
	},
}));
const inverseRelations = defineRelations(schema, (r) => ({
	children: {
		parent: r.one.parents({ from: r.children.parentId, to: r.parents.id }),
	},
	grandchildren: {
		child: r.one.children({
			from: r.grandchildren.childId,
			to: r.children.id,
		}),
	},
}));
function fixture(relations = bothRelations) {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
 PRAGMA foreign_keys = ON;
 CREATE TABLE audit_parents (id INTEGER PRIMARY KEY, code INTEGER UNIQUE);
 CREATE TABLE audit_children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES audit_parents(id) ON DELETE CASCADE ON UPDATE CASCADE);
 CREATE TABLE audit_grandchildren (id INTEGER PRIMARY KEY, child_id INTEGER REFERENCES audit_children(id) ON DELETE CASCADE);
 INSERT INTO audit_parents VALUES (1, 7);
 INSERT INTO audit_children VALUES (10, 1);
 INSERT INTO audit_grandchildren VALUES (100, 10);
 `);
	const db = drizzle({ client: sqlite, relations });
	const client = better(db, {
		plugins: [cache({ store: createMemoryStore().store, ttl: 60 })],
	});
	return { client, sqlite };
}

test('cache invalidates transitive database delete cascades', async () => {
	const { client, sqlite } = fixture();
	try {
		expect(await client.grandchildren.count({ cache: true })).toBe(1);
		await client.parents.delete({ where: { id: 1 } });
		expect(await client.grandchildren.count({ cache: false })).toBe(0);
		expect(await client.grandchildren.count({ cache: true })).toBe(0);
	} finally {
		sqlite.close();
	}
});

test('cache invalidates declared source-side FK relations without inverse relation', async () => {
	const { client, sqlite } = fixture(
		inverseRelations as typeof bothRelations,
	);
	try {
		expect(await client.children.count({ cache: true })).toBe(1);
		expect(await client.grandchildren.count({ cache: true })).toBe(1);
		await client.parents.delete({ where: { id: 1 } });
		expect(await client.children.count({ cache: false })).toBe(0);
		expect(await client.children.count({ cache: true })).toBe(0);
		expect(await client.grandchildren.count({ cache: true })).toBe(0);
	} finally {
		sqlite.close();
	}
});

for (const update of ['all', ['id']] as const)
	test(`upsertMany ${JSON.stringify(update)} invalidates cascading primary-key updates`, async () => {
		const { client, sqlite } = fixture();
		try {
			expect(
				await client.children.findUnique({
					where: { id: 10 },
					cache: true,
				}),
			).toMatchObject({ parentId: 1 });
			await client.parents.upsertMany({
				data: [{ id: 2, code: 7 }],
				target: 'code',
				update,
			});
			expect(
				await client.children.findUnique({
					where: { id: 10 },
					cache: true,
				}),
			).toMatchObject({ parentId: 2 });
		} finally {
			sqlite.close();
		}
	});

test('upsertMany callback invalidates cascades without running twice', async () => {
	const { client, sqlite } = fixture();
	let calls = 0;
	try {
		expect(
			await client.children.findUnique({
				where: { id: 10 },
				cache: true,
			}),
		).toMatchObject({ parentId: 1 });
		await client.parents.upsertMany({
			data: [{ id: 1 }],
			target: 'id',
			update: () => {
				calls++;
				return { id: 2 };
			},
		});
		expect(calls).toBe(1);
		expect(
			await client.children.findUnique({
				where: { id: 10 },
				cache: true,
			}),
		).toMatchObject({ parentId: 2 });
	} finally {
		sqlite.close();
	}
});

test('updateEach primary-key resolvers invalidate database cascades', async () => {
	const { client, sqlite } = fixture();
	try {
		expect(
			await client.children.findUnique({
				where: { id: 10 },
				cache: true,
			}),
		).toMatchObject({ parentId: 1 });
		await client.parents.updateEach({
			by: parents.id,
			data: [{ id: 1, nextId: 2 }],
			update: { id: (row) => row.nextId },
		});
		expect(
			await client.children.findUnique({
				where: { id: 10 },
				cache: true,
			}),
		).toMatchObject({ parentId: 2 });
	} finally {
		sqlite.close();
	}
});

test('self-referencing cascades invalidate other primary-key lookups on the same model', async () => {
	const nodes = sqliteTable('audit_nodes', {
		id: integer('id').primaryKey(),
		parentId: integer('parent_id').references(
			(): AnySQLiteColumn => nodes.id,
			{
				onDelete: 'cascade',
			},
		),
	});
	const relations = defineRelations({ nodes }, (r) => ({
		nodes: {
			parent: r.one.nodes({ from: r.nodes.parentId, to: r.nodes.id }),
		},
	}));
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec(`
			PRAGMA foreign_keys = ON;
			CREATE TABLE audit_nodes (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES audit_nodes(id) ON DELETE CASCADE);
			INSERT INTO audit_nodes VALUES (1, NULL), (2, 1), (3, 2);
		`);
		const client = better(drizzle({ client: sqlite, relations }), {
			plugins: [cache({ store: createMemoryStore().store, ttl: 60 })],
		});
		expect(
			await client.nodes.findUnique({ where: { id: 3 }, cache: true }),
		).toMatchObject({ id: 3 });
		await client.nodes.delete({ where: { id: 1 } });
		expect(
			await client.nodes.findUnique({ where: { id: 3 }, cache: true }),
		).toBeNull();
	} finally {
		sqlite.close();
	}
});

for (const operation of [
	'update',
	'upsert',
	'updateEach',
	'upsertMany-object',
	'upsertMany-list',
	'upsertMany-all',
] as const)
	test(`${operation} invalidates cascades from referenced non-primary unique columns`, async () => {
		const owners = sqliteTable('audit_owners', {
			id: integer('id').primaryKey(),
			code: integer('code').unique(),
		});
		const dependents = sqliteTable('audit_dependents', {
			id: integer('id').primaryKey(),
			ownerCode: integer('owner_code').references(() => owners.code, {
				onUpdate: 'cascade',
			}),
		});
		const relations = defineRelations({ owners, dependents }, (r) => ({
			dependents: {
				owner: r.one.owners({
					from: r.dependents.ownerCode,
					to: r.owners.code,
				}),
			},
		}));
		const sqlite = new Database(':memory:');
		try {
			sqlite.exec(`
				PRAGMA foreign_keys = ON;
				CREATE TABLE audit_owners (id INTEGER PRIMARY KEY, code INTEGER UNIQUE);
				CREATE TABLE audit_dependents (id INTEGER PRIMARY KEY, owner_code INTEGER REFERENCES audit_owners(code) ON UPDATE CASCADE);
				INSERT INTO audit_owners VALUES (1, 7);
				INSERT INTO audit_dependents VALUES (10, 7);
			`);
			const client = better(drizzle({ client: sqlite, relations }), {
				plugins: [cache({ store: createMemoryStore().store, ttl: 60 })],
			});
			expect(
				await client.dependents.findUnique({
					where: { id: 10 },
					cache: true,
				}),
			).toMatchObject({ ownerCode: 7 });
			if (operation === 'update')
				await client.owners.update({
					where: { id: 1 },
					data: { code: 8 },
				});
			else if (operation === 'upsert')
				await client.owners.upsert({
					where: { id: 1 },
					create: { id: 1, code: 8 },
					update: { code: 8 },
				});
			else if (operation === 'updateEach')
				await client.owners.updateEach({
					by: owners.id,
					data: [{ id: 1, code: 8 }],
					update: { code: (row) => row.code },
				});
			else
				await client.owners.upsertMany({
					data: [{ id: 1, code: 8 }],
					target: 'id',
					update:
						operation === 'upsertMany-object'
							? { code: 8 }
							: operation === 'upsertMany-list'
								? ['code']
								: 'all',
				});
			expect(
				await client.dependents.findUnique({
					where: { id: 10 },
					cache: true,
				}),
			).toMatchObject({ ownerCode: 8 });
		} finally {
			sqlite.close();
		}
	});

test('upsertMany primary-key changes invalidate ON UPDATE CASCADE children', async () => {
	const { client, sqlite } = fixture();
	try {
		expect(
			(
				await client.children.findUnique({
					where: { id: 10 },
					cache: true,
				})
			)?.parentId,
		).toBe(1);
		await client.parents.upsertMany({
			data: [{ id: 1 }],
			target: 'id',
			update: { id: 2 },
		});
		expect(
			(
				await client.children.findUnique({
					where: { id: 10 },
					cache: false,
				})
			)?.parentId,
		).toBe(2);
		expect(
			(
				await client.children.findUnique({
					where: { id: 10 },
					cache: true,
				})
			)?.parentId,
		).toBe(2);
	} finally {
		sqlite.close();
	}
});
