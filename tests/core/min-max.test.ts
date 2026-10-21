import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, real, sqliteTable } from 'drizzle-orm/sqlite-core';

import { BetterDrizzleError, BetterDrizzleErrorCode, better } from '../../src';

const players = sqliteTable('players', {
	bonus: integer('bonus'),
	highScore: integer('high_score').notNull(),
	id: integer('id').primaryKey(),
	rating: real('rating'),
	teamId: integer('team_id').notNull(),
});

const relations = defineRelations({ players });

let sqlite: Database;
let client: ReturnType<typeof better<typeof relations>>;

beforeEach(() => {
	sqlite = new Database(':memory:');
	sqlite.run(`
		create table players (
			id integer primary key,
			team_id integer not null,
			high_score integer not null,
			bonus integer,
			rating real
		)
	`);
	sqlite.run(`
		insert into players (id, team_id, high_score, bonus, rating) values
			(1, 1, 50, null, null),
			(2, 1, 80, 10, 4.5),
			(3, 2, 20, 30, 1.5)
	`);
	client = better(drizzle({ client: sqlite, relations }));
});

afterEach(() => {
	sqlite.close();
});

const captureError = async (run: () => unknown) => {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error('Expected the call to throw.');
};

describe('max / min atomic updates', () => {
	test('max only raises the column', async () => {
		expect(
			await client.players.update({
				data: { highScore: { max: 70 } },
				where: { id: 1 },
			}),
		).toMatchObject({ highScore: 70 });
		expect(
			await client.players.update({
				data: { highScore: { max: 60 } },
				where: { id: 1 },
			}),
		).toMatchObject({ highScore: 70 });
	});

	test('min only lowers the column', async () => {
		expect(
			await client.players.update({
				data: { highScore: { min: 60 } },
				where: { id: 2 },
			}),
		).toMatchObject({ highScore: 60 });
		expect(
			await client.players.update({
				data: { highScore: { min: 90 } },
				where: { id: 2 },
			}),
		).toMatchObject({ highScore: 60 });
	});

	test('a NULL column becomes the operand', async () => {
		expect(
			await client.players.update({
				data: { bonus: { max: 5 }, rating: { min: 2.5 } },
				where: { id: 1 },
			}),
		).toMatchObject({ bonus: 5, rating: 2.5 });
	});

	test('updateMany applies per row', async () => {
		await client.players.updateMany({
			data: { bonus: { min: 20 }, highScore: { max: 60 } },
			where: { teamId: 1 },
		});
		expect(
			await client.players.findMany({
				orderBy: { id: 'asc' },
				select: { bonus: true, highScore: true, id: true },
			}),
		).toEqual([
			{ bonus: 20, highScore: 60, id: 1 },
			{ bonus: 10, highScore: 80, id: 2 },
			{ bonus: 30, highScore: 20, id: 3 },
		]);
	});

	test('updateEach accepts max / min from update callbacks', async () => {
		await client.players.updateEach({
			by: players.id,
			data: [
				{ id: 1, score: 65 },
				{ id: 2, score: 65 },
			],
			update: {
				bonus: (row) => ({ min: row.score as number }),
				highScore: (row) => ({ max: row.score as number }),
			},
		});
		expect(
			await client.players.findMany({
				orderBy: { id: 'asc' },
				select: { bonus: true, highScore: true },
				where: { teamId: 1 },
			}),
		).toEqual([
			{ bonus: 65, highScore: 65 },
			{ bonus: 10, highScore: 80 },
		]);
	});

	test('upsert applies max on the update side', async () => {
		expect(
			await client.players.upsert({
				create: { highScore: 0, id: 1, teamId: 1 },
				update: { highScore: { max: 99 } },
				where: { id: 1 },
			}),
		).toMatchObject({ highScore: 99 });
	});

	test('upsertMany applies min on the update side', async () => {
		await client.players.upsertMany({
			data: [
				{ highScore: 40, id: 2, teamId: 1 },
				{ highScore: 40, id: 4, teamId: 2 },
			],
			target: 'id',
			update: { highScore: { min: 40 } },
		});
		expect(
			await client.players.findMany({
				orderBy: { id: 'asc' },
				select: { highScore: true, id: true },
				where: { id: { in: [2, 4] } },
			}),
		).toEqual([
			{ highScore: 40, id: 2 },
			{ highScore: 40, id: 4 },
		]);
	});

	test('zero and negative operands are applied, not skipped', async () => {
		expect(
			await client.players.update({
				data: { highScore: { max: 0 } },
				where: { id: 1 },
			}),
		).toMatchObject({ highScore: 50 });
		expect(
			await client.players.update({
				data: { highScore: { min: 0 } },
				where: { id: 1 },
			}),
		).toMatchObject({ highScore: 0 });
		expect(
			await client.players.update({
				data: { highScore: { min: -5 } },
				where: { id: 1 },
			}),
		).toMatchObject({ highScore: -5 });
		expect(
			await client.players.update({
				data: { bonus: { max: -3 } },
				where: { id: 1 },
			}),
		).toMatchObject({ bonus: -3 });
	});

	test('fractional operands work on real columns', async () => {
		expect(
			await client.players.update({
				data: { rating: { max: 4.75 } },
				where: { id: 2 },
			}),
		).toMatchObject({ rating: 4.75 });
		expect(
			await client.players.update({
				data: { rating: { min: 0.25 } },
				where: { id: 1 },
			}),
		).toMatchObject({ rating: 0.25 });
	});

	test('accepts an undefined sibling next to max', async () => {
		expect(
			await client.players.update({
				data: { highScore: { max: 70, min: undefined } },
				where: { id: 1 },
			}),
		).toMatchObject({ highScore: 70 });
	});

	test('rejects max / min combined with other operators', async () => {
		for (const data of [
			{ highScore: { increment: 1, max: 5 } },
			{ highScore: { max: 5, min: 1 } },
			{ highScore: { min: 5, set: 1 } },
		]) {
			const error = await captureError(() =>
				client.players.update({
					data: data as never,
					where: { id: 1 },
				}),
			);
			expect(error).toBeInstanceOf(BetterDrizzleError);
			expect((error as BetterDrizzleError).code).toBe(
				BetterDrizzleErrorCode.InvalidArgs,
			);
		}
	});

	test('rejects non-finite operands', async () => {
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '5']) {
			const error = await captureError(() =>
				client.players.update({
					data: { highScore: { max: value as never } },
					where: { id: 1 },
				}),
			);
			expect((error as BetterDrizzleError).code).toBe(
				BetterDrizzleErrorCode.InvalidArgs,
			);
		}
		expect(
			await client.players.findUnique({ where: { id: 1 } }),
		).toMatchObject({ highScore: 50 });
	});
});
