import { describe } from 'bun:test';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { better } from '../../../src';
import { defineMatrix, type MatrixContext, type MatrixRaw } from './cases';
import {
	TABLES,
	createPgSchema,
	pgDdl,
	seedDatabase,
	type MatrixSchema,
} from './schema';

const DATABASE_URL = process.env.DATABASE_URL;
const PREFIX = 'better_drizzle_matrix_';
const { relations, schema } = createPgSchema(PREFIX);
const tableList = TABLES.map((table) => `${PREFIX}${table}`).join(', ');

let client: Client | undefined;

const dropAll = async () => {
	await client?.query(`DROP TABLE IF EXISTS ${tableList} CASCADE`);
};

describe.skipIf(!DATABASE_URL)('PostgreSQL', () => {
	defineMatrix('PostgreSQL', {
		async setup() {
			client = new Client({ connectionString: DATABASE_URL });
			await client.connect();
			await dropAll();
			for (const statement of pgDdl(PREFIX))
				await client.query(statement);
		},
		async reset(): Promise<MatrixContext> {
			const connection = client as Client;
			await connection.query(
				`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`,
			);
			const raw = drizzle({ client: connection, relations });
			await seedDatabase(raw, schema);
			const typedRaw = raw as unknown as MatrixRaw;
			return {
				db: better(typedRaw),
				dialect: 'pg',
				make: (options) => better(typedRaw, options),
				raw: typedRaw,
				rawWithoutRelations: () => drizzle({ client: connection }),
				schema: schema as unknown as MatrixSchema,
			};
		},
		async teardown() {
			await dropAll();
			await client?.end();
			client = undefined;
		},
	});
});
