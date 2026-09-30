import { Database } from 'bun:sqlite';

import { drizzle } from 'drizzle-orm/bun-sqlite';

import { better } from '../../../src';
import { defineMatrix, type MatrixContext } from './cases';
import { createSqliteSchema, seedDatabase, sqliteDdl } from './schema';

const PREFIX = 'mx_';
const { relations, schema } = createSqliteSchema(PREFIX);

let sqlite: Database | undefined;

defineMatrix('SQLite', {
	async reset(): Promise<MatrixContext> {
		sqlite?.close();
		const client = new Database(':memory:');
		sqlite = client;
		client.exec('PRAGMA foreign_keys = ON;');
		for (const statement of sqliteDdl(PREFIX)) client.exec(statement);
		const raw = drizzle({ client, relations });
		await seedDatabase(raw, schema);
		return {
			db: better(raw),
			dialect: 'sqlite',
			make: (options) => better(raw, options),
			raw,
			rawWithoutRelations: () => drizzle({ client }),
			schema,
		};
	},
	async teardown() {
		sqlite?.close();
		sqlite = undefined;
	},
});
