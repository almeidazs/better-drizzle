import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better, definePlugin } from '../src';

const users = sqliteTable('plugin_users', {
	deletedAt: integer('deleted_at', { mode: 'timestamp' }),
	id: integer('id').primaryKey(),
	name: text('name').notNull(),
});

const schema = { users };

const createContext = () => {
	const sqlite = new Database(':memory:');
	sqlite.exec(`
		CREATE TABLE plugin_users (
			id INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			deleted_at INTEGER
		);
		INSERT INTO plugin_users (id, name, deleted_at) VALUES
			(1, 'Alice', NULL),
			(2, 'Bob', 1710000000);
	`);

	const raw = drizzle(sqlite, { schema });

	return {
		raw,
		close() {
			sqlite.close();
		},
	};
};

describe('plugins', () => {
	test('definePlugin preserves metadata', () => {
		const plugin = definePlugin({
			description: 'Example plugin',
			id: 'example',
			name: 'Example',
			version: '1.0.0',
		});

		expect(plugin.id).toBe('example');
		expect(plugin.name).toBe('Example');
	});

	test('fails on duplicate plugin ids', () => {
		const { raw, close } = createContext();
		const plugin = definePlugin({ id: 'dup' });

		expect(() =>
			better(raw, {
				plugins: [plugin, plugin],
				schema,
			}),
		).toThrow('Duplicate Better Drizzle plugin id "dup".');
		close();
	});

	test('fails when plugin dialect is not supported', () => {
		const { raw, close } = createContext();

		expect(() =>
			better(raw, {
				plugins: [
					definePlugin({
						config: { dialects: ['pg'] },
						id: 'pg-only',
					}),
				],
				schema,
			}),
		).toThrow('Plugin "pg-only" does not support dialect "sqlite".');
		close();
	});

	test('fails when required columns are missing', () => {
		const { raw, close } = createContext();

		expect(() =>
			better(raw, {
				plugins: [
					definePlugin({
						config: {
							requires: {
								columns: [{ column: 'missingColumn' }],
							},
						},
						id: 'requires-column',
					}),
				],
				schema,
			}),
		).toThrow(
			'Plugin "requires-column" requires column "missingColumn" on model "users".',
		);
		close();
	});

	test('setup runs once and can register hooks', async () => {
		const { raw, close } = createContext();
		let setupCalls = 0;

		const client = better(raw, {
			plugins: [
				definePlugin({
					id: 'timestamps',
					setup(ctx) {
						setupCalls += 1;
						ctx.addHook({
							beforeCreate({ data }) {
								return {
									...(data as Record<string, unknown>),
									name: 'Created by plugin',
								};
							},
						});
					},
				}),
			],
			schema,
		});

		const created = await client.users.create({
			data: { id: 3, name: 'Ignored' },
		});

		expect(setupCalls).toBe(1);
		expect(created?.name).toBe('Created by plugin');
		close();
	});

	test('transform filters reads and $withoutPlugins bypasses it', async () => {
		const { raw, close } = createContext();

		const softDelete = definePlugin({
			extendModel({ client, model }) {
				if (!model.hasColumn('deletedAt')) return;

				return {
					forceDelete(id: number) {
						return client.$withoutPlugins().delete({
							where: { id },
						});
					},
					withDeleted() {
						return client.$withState({ withDeleted: true });
					},
				};
			},
			id: 'soft-delete',
			transform(operation) {
				if (!operation.model.hasColumn('deletedAt')) return operation;
				if (operation.state.withDeleted) return operation;
				if (
					operation.kind !== 'findMany' &&
					operation.kind !== 'findFirst' &&
					operation.kind !== 'count'
				)
					return operation;

				operation.where = operation.where
					? { AND: [operation.where, { deletedAt: null }] }
					: { deletedAt: null };

				return operation;
			},
		});

		const client = better(raw, {
			plugins: [softDelete],
			schema,
		});

		const visible = await client.users.findMany({
			orderBy: { id: 'asc' },
		});
		const allRows = await (
			client.users as typeof client.users & {
				withDeleted(): typeof client.users;
			}
		)
			.withDeleted()
			.findMany({
				orderBy: { id: 'asc' },
			});
		const count = await client.users.count();

		expect(visible).toHaveLength(1);
		expect(allRows).toHaveLength(2);
		expect(count).toBe(1);

		await (
			client.users as typeof client.users & {
				forceDelete(id: number): Promise<unknown>;
			}
		).forceDelete(2);

		const afterForceDelete = await (
			client.users as typeof client.users & {
				withDeleted(): typeof client.users;
			}
		)
			.withDeleted()
			.findMany({
				orderBy: { id: 'asc' },
			});

		expect(afterForceDelete).toHaveLength(1);
		close();
	});

	test('extendClient adds root helpers', async () => {
		const { raw, close } = createContext();

		const client = better(raw, {
			plugins: [
				definePlugin({
					extendClient({ client }) {
						return {
							stats: {
								activeUsers() {
									return client.users.count();
								},
							},
						};
					},
					id: 'stats',
				}),
			],
			schema,
		});

		const count = await (
			client as typeof client & {
				stats: { activeUsers(): Promise<number> };
			}
		).stats.activeUsers();

		expect(count).toBe(2);
		close();
	});

	test('plugin order follows the array order', async () => {
		const { raw, close } = createContext();

		const client = better(raw, {
			plugins: [
				definePlugin({
					hooks: {
						beforeCreate({ data }) {
							return {
								...(data as Record<string, unknown>),
								name: `${(data as { name: string }).name}-A`,
							};
						},
					},
					id: 'a',
				}),
				definePlugin({
					hooks: {
						beforeCreate({ data }) {
							return {
								...(data as Record<string, unknown>),
								name: `${(data as { name: string }).name}-B`,
							};
						},
					},
					id: 'b',
				}),
			],
			schema,
		});

		const created = await client.users.create({
			data: { id: 3, name: 'Base' },
		});

		expect(created?.name).toBe('Base-A-B');
		close();
	});
});
