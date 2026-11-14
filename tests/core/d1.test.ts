import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { drizzle } from 'drizzle-orm/bun-sqlite';

import { BetterDrizzleErrorCode, better } from '../../src';
import { resetWarnings } from '../../src/shared/client/driver';
import { createD1Context, relations } from './d1.fixture';

const driverOf = (client: unknown) =>
	(
		client as Record<
			symbol,
			{
				driver: {
					d1: boolean;
					maxParams: number;
					transactions: boolean;
				};
			}
		>
	)[Symbol.for('better-drizzle/context')]!.driver;

const rows = (count: number, start = 1) =>
	Array.from({ length: count }, (_, index) => ({
		a: 'a',
		b: 'b',
		c: 'c',
		d: 'd',
		id: start + index,
	}));

describe('cloudflare d1', () => {
	let warn: ReturnType<typeof spyOn<Console, 'warn'>>;

	beforeEach(() => {
		resetWarnings();
		warn = spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
	});

	test('detects D1 from the drizzle session', () => {
		const { client } = createD1Context();

		expect(driverOf(client)).toEqual({
			acknowledged: false,
			d1: true,
			maxParams: 100,
			transactions: false,
		});
	});

	test('keeps transactions on other sqlite drivers', () => {
		const client = better(
			drizzle({ client: new Database(':memory:'), relations }),
		);

		expect(driverOf(client)).toMatchObject({
			d1: false,
			maxParams: 32_766,
			transactions: true,
		});
	});

	test('rejects an unknown transactions option', () => {
		expect(() => createD1Context({ transactions: 'off' as never })).toThrow(
			/must be "auto" or "none"/,
		);
	});

	test('relation writes run without BEGIN and warn once', async () => {
		const { client } = createD1Context();
		await client.authors.create({ data: { id: 1, name: 'Alice' } });

		const first = await client.posts.create({
			data: { author: { connect: { id: 1 } }, id: 1, title: 'One' },
			include: { author: true },
		});
		await client.posts.create({
			data: { author: { connect: { id: 1 } }, id: 2, title: 'Two' },
		});

		expect(first.author?.name).toBe('Alice');
		expect(await client.posts.count()).toBe(2);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain('Cloudflare D1');
	});

	test('transaction() runs the callback without BEGIN', async () => {
		const { client } = createD1Context();

		const result = await client.transaction(async (tx) => {
			await tx.authors.create({ data: { id: 1, name: 'Alice' } });
			await tx.posts.create({
				data: { author: { connect: { id: 1 } }, id: 1, title: 'One' },
			});

			return 'done';
		});

		expect(result).toBe('done');
		expect(await client.posts.count()).toBe(1);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test('transaction() cannot roll back writes made before an error', async () => {
		const { client } = createD1Context();

		await expect(
			client.transaction(async (tx) => {
				await tx.authors.create({ data: { id: 1, name: 'Alice' } });
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');

		expect(await client.authors.count()).toBe(1);
	});

	test('transaction() does not retry, since writes are not rolled back', async () => {
		const { client } = createD1Context();
		let attempts = 0;

		await expect(
			client.transaction(
				async (tx) => {
					attempts += 1;
					await tx.authors.create({
						data: { id: attempts, name: 'Alice' },
					});
					throw Object.assign(new Error('deadlock detected'), {
						code: '40P01',
					});
				},
				{ retries: { attempts: 3 } },
			),
		).rejects.toThrow();

		expect(attempts).toBe(1);
	});

	test('explain() is not supported', async () => {
		const { client } = createD1Context();

		await expect(client.authors.findMany().explain()).rejects.toMatchObject(
			{ code: BetterDrizzleErrorCode.OperationError },
		);
	});

	test('$executeRaw reads the affected rows from meta.changes', async () => {
		const { client } = createD1Context();
		await client.items.createMany({ data: rows(3) });

		const result = await client.$executeRaw`update d1_items set a = ${'x'}`;

		expect(result.rowsAffected).toBe(3);
	});

	test('createMany splits inserts over the parameter limit', async () => {
		const { client } = createD1Context();

		const result = await client.items.createMany({ data: rows(60) });

		expect(result.count).toBe(60);
		expect(await client.items.count()).toBe(60);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain('createMany');
	});

	test('createMany returns projected rows from every chunk', async () => {
		const { client } = createD1Context();

		const result = await client.items.createMany({
			data: rows(45),
			select: { id: true },
		});

		expect(result.data?.map((row) => row.id)).toEqual(
			rows(45).map((row) => row.id),
		);
	});

	test('createMany keeps a batchSize that already fits', async () => {
		const { client } = createD1Context();

		await client.items.createMany({ batchSize: 5, data: rows(12) });

		expect(await client.items.count()).toBe(12);
		expect(warn).not.toHaveBeenCalled();
	});

	test('upsertMany splits inserts over the parameter limit', async () => {
		const { client } = createD1Context();
		await client.items.createMany({ data: rows(10) });

		const result = await client.items.upsertMany({
			data: rows(40).map((row) => ({ ...row, a: 'updated' })),
			target: 'id',
			update: 'all',
		});

		expect(result.count).toBe(40);
		expect(await client.items.count()).toBe(40);
		expect(await client.items.count({ where: { a: 'updated' } })).toBe(40);
	});

	test('createMany counts columns filled by $onUpdate', async () => {
		const { client } = createD1Context();

		const result = await client.items.createMany({ data: rows(40) });

		expect(result.count).toBe(40);
		expect(await client.items.count()).toBe(40);
	});

	test('includes load relations in batches under the limit', async () => {
		const { client } = createD1Context();
		await client.authors.createMany({
			data: Array.from({ length: 250 }, (_, index) => ({
				id: index + 1,
				name: `Author ${index + 1}`,
			})),
		});
		await client.posts.createMany({
			data: Array.from({ length: 250 }, (_, index) => ({
				authorId: index + 1,
				id: index + 1,
				title: `Post ${index + 1}`,
			})),
		});

		const found = await client.posts.findMany({
			include: { author: true },
			orderBy: { id: 'asc' },
		});

		expect(found).toHaveLength(250);
		expect(found.every((post) => post.author?.id === post.authorId)).toBe(
			true,
		);
	});
});

describe('transactions: none', () => {
	let warn: ReturnType<typeof spyOn<Console, 'warn'>>;

	beforeEach(() => {
		resetWarnings();
		warn = spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
	});

	test('turns transactions off for any sqlite driver without a warning', async () => {
		const sqlite = new Database(':memory:');
		sqlite.exec(
			'CREATE TABLE d1_authors (id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL);',
		);
		const client = better(drizzle({ client: sqlite, relations }), {
			transactions: 'none',
		});

		expect(driverOf(client)).toMatchObject({
			acknowledged: true,
			d1: false,
			transactions: false,
		});

		await client.transaction(async (tx) => {
			expect(sqlite.inTransaction).toBe(false);
			await tx.authors.create({ data: { id: 1, name: 'Alice' } });
		});

		expect(await client.authors.count()).toBe(1);
		expect(warn).not.toHaveBeenCalled();
	});
});
