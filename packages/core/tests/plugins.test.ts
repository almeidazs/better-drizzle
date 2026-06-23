import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { better, definePlugin } from '../src';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

type Expect<T extends true> = T;

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
								} as typeof data;
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
						} as never);
					},
					withDeleted() {
						return client.$withState({ withDeleted: true });
					},
				} as Record<string, unknown>;
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

				operation.where = (
					operation.where
						? { AND: [operation.where, { deletedAt: null }] }
						: { deletedAt: null }
				) as typeof operation.where;

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

	test('operationArgs extends built-in methods and reaches hooks/transforms', async () => {
		const { raw, close } = createContext();
		const deleteModes: Array<'soft' | 'hard' | undefined> = [];

		const softDelete = definePlugin({
			hooks: {
				beforeDelete(context) {
					if (context.kind === 'delete')
						deleteModes.push(context.args.mode);
				},
			},
			id: 'soft-delete-args',
			operationArgs: {
				count: {
					deleted: undefined as
						| 'without'
						| 'with'
						| 'only'
						| undefined,
				},
				delete: {
					deletedBy: undefined as string | undefined,
					mode: undefined as 'soft' | 'hard' | undefined,
				},
				exists: {
					deleted: undefined as
						| 'without'
						| 'with'
						| 'only'
						| undefined,
				},
				findFirst: {
					deleted: undefined as
						| 'without'
						| 'with'
						| 'only'
						| undefined,
				},
				findMany: {
					deleted: undefined as
						| 'without'
						| 'with'
						| 'only'
						| undefined,
				},
			},
			transform(operation) {
				if (
					operation.kind !== 'findMany' &&
					operation.kind !== 'findFirst' &&
					operation.kind !== 'count' &&
					operation.kind !== 'exists'
				)
					return operation;

				if (operation.args.deleted === 'with') return operation;
				if (operation.args.deleted === 'only') {
					operation.where = (
						operation.where
							? {
									AND: [
										operation.where,
										{ deletedAt: { not: null } },
									],
								}
							: { deletedAt: { not: null } }
					) as typeof operation.where;
					return operation;
				}

				operation.where = (
					operation.where
						? { AND: [operation.where, { deletedAt: null }] }
						: { deletedAt: null }
				) as typeof operation.where;
				return operation;
			},
		});

		const client = better(raw, {
			hooks: {
				beforeDelete(context) {
					if (context.action !== 'delete') return;

					const mode: 'soft' | 'hard' | undefined = context.args.mode;
					expect(mode).toBeDefined();
				},
				beforeQuery(context) {
					if (
						context.action === 'findMany' &&
						context.args.deleted === 'only'
					) {
						const deleted: 'without' | 'with' | 'only' | undefined =
							context.args.deleted;
						expect(deleted).toBe('only');
					}
				},
			},
			plugins: [softDelete],
			schema,
		});

		const onlyDeleted = await client.users.findMany({
			deleted: 'only',
			orderBy: { id: 'asc' },
		});
		const withDeleted = await client.users.findMany({
			deleted: 'with',
			orderBy: { id: 'asc' },
		});
		const visibleCount = await client.users.count({ deleted: 'without' });
		const deletedExists = await client.users.exists({
			deleted: 'only',
			where: { id: 2 },
		});

		await client.users.delete({
			deletedBy: 'admin',
			mode: 'soft',
			where: { id: 1 },
		});

		expect(onlyDeleted).toHaveLength(1);
		expect(withDeleted).toHaveLength(2);
		expect(visibleCount).toBe(1);
		expect(deletedExists).toBe(true);
		expect(deleteModes).toEqual(['soft']);
		close();
	});

	test('fails when two plugins declare the same operation arg key', () => {
		const { raw, close } = createContext();

		expect(() =>
			better(raw, {
				plugins: [
					definePlugin({
						id: 'soft-a',
						operationArgs: {
							delete: {
								mode: undefined as 'soft' | undefined,
							},
						},
					}),
					definePlugin({
						id: 'soft-b',
						operationArgs: {
							delete: {
								mode: undefined as 'hard' | undefined,
							},
						},
					}),
				],
				schema,
			}),
		).toThrow(
			'Plugin "soft-b" cannot override operation arg "mode" on "delete" because it is already declared by plugin "soft-a".',
		);

		close();
	});

	test('extendClient adds root helpers', async () => {
		const { raw, close } = createContext();

		const client = better(raw, {
			plugins: [
				definePlugin({
					extendClient({ client }) {
						const typedClient = client as typeof client & {
							users: { count(): Promise<number> };
						};

						return {
							stats: {
								activeUsers() {
									return typedClient.users.count();
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

	test('beforeDelete can short-circuit the built-in operation', async () => {
		const { raw, close } = createContext();

		const client = better(raw, {
			plugins: [
				definePlugin({
					hooks: {
						beforeDelete({ client, kind, where }) {
							if (kind !== 'delete') return;

							return client.$withoutPlugins().update({
								data: { name: 'Soft Deleted' },
								where: where as { id: number },
							});
						},
					},
					id: 'soft-delete-short-circuit',
				}),
			],
			schema,
		});

		const deleted = await client.users.delete({
			where: { id: 1 },
		});
		const remaining = await client.users.findMany({
			orderBy: { id: 'asc' },
		});

		expect(deleted?.name).toBe('Soft Deleted');
		expect(remaining).toHaveLength(2);
		expect(remaining[0]?.name).toBe('Soft Deleted');
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
							} as typeof data;
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
							} as typeof data;
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

	test('operationArgs types are exposed on delegates and hooks', () => {
		const { raw, close } = createContext();
		const softDelete = definePlugin({
			id: 'soft-delete-types',
			operationArgs: {
				delete: {
					mode: undefined as 'soft' | 'hard' | undefined,
				},
				findMany: {
					deleted: undefined as
						| 'without'
						| 'with'
						| 'only'
						| undefined,
				},
			},
			transform(operation) {
				if (operation.kind === 'delete') {
					type _DeleteMode = Expect<
						Equal<
							typeof operation.args.mode,
							'soft' | 'hard' | undefined
						>
					>;
					const check: _DeleteMode = true;
					void check;
				}
				if (operation.kind === 'findMany') {
					type _DeletedFilter = Expect<
						Equal<
							typeof operation.args.deleted,
							'without' | 'with' | 'only' | undefined
						>
					>;
					const check: _DeletedFilter = true;
					void check;
				}
				return operation;
			},
		});

		const client = better(raw, {
			hooks: {
				beforeDelete(context) {
					if (context.action !== 'delete') return;

					type _Mode = Expect<
						Equal<
							typeof context.args.mode,
							'soft' | 'hard' | undefined
						>
					>;
					const check: _Mode = true;
					void check;
				},
			},
			plugins: [softDelete],
			schema,
		});

		type _FindManyDeleted = Expect<
			Equal<
				NonNullable<
					Parameters<typeof client.users.findMany>[0]
				>['deleted'],
				'without' | 'with' | 'only' | undefined
			>
		>;
		const check: _FindManyDeleted = true;
		void check;
		close();
	});
});
