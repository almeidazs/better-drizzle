import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';

import { BetterDrizzleErrorCode } from '../src';
import { createTestContext, type TestContext } from './setup';

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

describe('create', () => {
	test('creates a single record and returns it', async () => {
		const result = await ctx.better.users.create({
			data: {
				id: 100,
				email: 'new@example.com',
				name: 'New',
				age: 20,
				active: true,
			},
		});

		expect(result).toEqual({
			id: 100,
			email: 'new@example.com',
			name: 'New',
			age: 20,
			active: true,
		});
	});

	test('creates a record with default values', async () => {
		const result = await ctx.better.users.create({
			data: {
				id: 101,
				email: 'defaults@example.com',
				name: 'Defaults',
				age: 40,
				active: false,
			},
		});

		expect(result).not.toBeNull();
		expect(result?.active).toBe(false);
	});

	test('create returns inserted data with select', async () => {
		const result = await ctx.better.users.create({
			data: {
				id: 102,
				email: 'select@example.com',
				name: 'Select',
				age: 50,
				active: true,
			},
			select: { id: true, name: true },
		});

		expect(result).toEqual({ id: 102, name: 'Select' });
	});

	test('create returns inserted data with include', async () => {
		await ctx.better.users.create({
			data: {
				id: 103,
				email: 'inc@example.com',
				name: 'Inc',
				age: 30,
				active: true,
			},
		});

		type PostWithAuthor = { author: { id: number; name: string } };

		const post = await ctx.better.posts.create({
			data: {
				id: 100,
				userId: 103,
				title: 'My Post',
				body: 'Hello',
				score: 5,
				published: true,
			},
			include: { author: true },
		});

		expect(post).toBeDefined();
		const typed = post as unknown as PostWithAuthor;
		expect(typed.author).toBeDefined();
		expect(typed.author.id).toBe(103);
	});

	test('create throws on unique constraint violation', async () => {
		expect(
			ctx.better.users.create({
				data: {
					id: 200,
					email: 'alice@example.com',
					name: 'Dup',
					age: 1,
					active: true,
				},
			}),
		).rejects.toThrow();
	});

	test('create ignores duplicate conflicts when skipDuplicates is true', async () => {
		const result = await ctx.better.users.create({
			data: {
				id: 205,
				email: 'alice@example.com',
				name: 'Ignored',
				age: 44,
				active: true,
			},
			skipDuplicates: true,
		});

		expect(result).toBeNull();
	});

	test('create inserts normally when skipDuplicates is true and no conflict exists', async () => {
		const result = await ctx.better.users.create({
			data: {
				id: 206,
				email: 'ignore-ok@example.com',
				name: 'Ignore Ok',
				age: 31,
				active: true,
			},
			skipDuplicates: true,
		});

		expect(result).toEqual({
			id: 206,
			email: 'ignore-ok@example.com',
			name: 'Ignore Ok',
			age: 31,
			active: true,
		});
	});

	test('create ignores conflicts on explicit targets', async () => {
		const result = await ctx.better.users.create({
			data: {
				id: 207,
				email: 'bob@example.com',
				name: 'Target Ignore',
				age: 29,
				active: false,
			},
			skipDuplicates: ['email'],
		});

		expect(result).toBeNull();
	});

	test('create still throws by default when skipDuplicates is not set', async () => {
		expect(
			ctx.better.users.create({
				data: {
					id: 208,
					email: 'charlie@example.com',
					name: 'Target Throw',
					age: 40,
					active: true,
				},
			}),
		).rejects.toThrow();
	});

	test('create rejects invalid skipDuplicates targets', async () => {
		await expect(
			ctx.better.users.create({
				data: {
					id: 209,
					email: 'invalid-target@example.com',
					name: 'Invalid Target',
					age: 26,
					active: true,
				},
				skipDuplicates: ['missing'] as unknown as ['email'],
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.OperationError,
		});
	});
});

describe('createMany', () => {
	test('creates multiple records and returns count', async () => {
		const result = await ctx.better.users.createMany({
			data: [
				{
					id: 201,
					email: 'm1@example.com',
					name: 'M1',
					age: 18,
					active: true,
				},
				{
					id: 202,
					email: 'm2@example.com',
					name: 'M2',
					age: 19,
					active: false,
				},
			],
		});

		expect(result.count).toBe(2);
		expect(result.data).toBeDefined();
		expect(result.data?.length).toBe(2);
	});

	test('createMany returns data array with correct records', async () => {
		const result = await ctx.better.users.createMany({
			data: [
				{
					id: 203,
					email: 'm3@example.com',
					name: 'M3',
					age: 20,
					active: true,
				},
				{
					id: 204,
					email: 'm4@example.com',
					name: 'M4',
					age: 21,
					active: false,
				},
			],
			select: { id: true, name: true },
		});

		expect(result.data).toBeDefined();
		expect(result.data?.length).toBe(2);
		expect(result.data?.[0]).toEqual({ id: 203, name: 'M3' });
		expect(result.data?.[1]).toEqual({ id: 204, name: 'M4' });
	});

	test('createMany counts only inserted rows when conflicts are ignored', async () => {
		const result = await ctx.better.users.createMany({
			data: [
				{
					id: 210,
					email: 'diana@example.com',
					name: 'Ignored Batch',
					age: 41,
					active: true,
				},
				{
					id: 211,
					email: 'batch-inserted@example.com',
					name: 'Inserted Batch',
					age: 24,
					active: false,
				},
			],
			skipDuplicates: true,
		});

		expect(result.count).toBe(1);
		expect(result.data).toBeDefined();
		expect(result.data?.length).toBe(1);
		expect(result.data?.[0]).toEqual({
			id: 211,
			email: 'batch-inserted@example.com',
			name: 'Inserted Batch',
			age: 24,
			active: false,
		});
	});

	test('createMany keeps projection for inserted rows when conflicts are ignored', async () => {
		const result = await ctx.better.users.createMany({
			data: [
				{
					id: 212,
					email: 'eve@example.com',
					name: 'Ignored Projected',
					age: 32,
					active: false,
				},
				{
					id: 213,
					email: 'projected-inserted@example.com',
					name: 'Projected Inserted',
					age: 27,
					active: true,
				},
			],
			skipDuplicates: ['email'],
			select: { id: true, name: true },
		});

		expect(result.count).toBe(1);
		expect(result.data).toEqual([{ id: 213, name: 'Projected Inserted' }]);
	});
});

describe('update', () => {
	test('updates a record and returns the updated row', async () => {
		const result = await ctx.better.users.update({
			data: { name: 'Alice Updated' },
			where: { id: 1 },
		});

		expect(result).not.toBeNull();
		expect(result?.name).toBe('Alice Updated');
		expect(result?.id).toBe(1);
	});

	test('update returns null for non-existent record', async () => {
		const result = await ctx.better.users.update({
			data: { name: 'Ghost' },
			where: { id: 9999 },
		});

		expect(result).toBeNull();
	});

	test('update with select returns only selected fields', async () => {
		const result = await ctx.better.users.update({
			data: { name: 'Bob Updated' },
			where: { id: 2 },
			select: { id: true, name: true },
		});

		expect(result).toEqual({ id: 2, name: 'Bob Updated' });
	});

	test('update with include returns related data', async () => {
		type PostWithAuthor = { title: string; author: { id: number } };

		const result = await ctx.better.posts.update({
			data: { title: 'Updated Title' },
			where: { id: 1 },
			include: { author: true },
		});

		expect(result).toBeDefined();
		const typed = result as unknown as PostWithAuthor;
		expect(typed.title).toBe('Updated Title');
		expect(typed.author).toBeDefined();
		expect(typed.author.id).toBe(1);
	});

	test('update changes are persisted', async () => {
		await ctx.better.users.update({
			data: { age: 99 },
			where: { id: 1 },
		});

		const fresh = await ctx.better.users.findFirst({ where: { id: 1 } });
		expect(fresh?.age).toBe(99);
	});
});

describe('updateMany', () => {
	test('updates multiple matching records', async () => {
		const result = await ctx.better.users.updateMany({
			data: { active: false },
			where: { active: true },
		});

		expect(result.count).toBe(3);
	});

	test('updateMany returns count 0 when no matches', async () => {
		const result = await ctx.better.users.updateMany({
			data: { name: 'No Match' },
			where: { id: 9999 },
		});

		expect(result.count).toBe(0);
	});

	test('updateMany without where returns count 0', async () => {
		const result = await ctx.better.users.updateMany({
			data: { name: 'No Where' },
		});

		expect(result.count).toBe(0);
	});

	test('updateMany changes are persisted', async () => {
		await ctx.better.users.updateMany({
			data: { active: true },
			where: { active: false },
		});

		const all = await ctx.better.users.findMany();
		const inactiveCount = all.filter((u) => !u.active).length;
		expect(inactiveCount).toBe(0);
	});
});

describe('updateEach', () => {
	test('updates multiple rows with different values', async () => {
		const result = await ctx.better.users.updateEach({
			by: ctx.schema.users.id,
			data: [
				{ id: 1, name: 'Alice One', age: 26 },
				{ id: 2, name: 'Bob Two', age: 31 },
			],
			update: {
				age: (row) => row.age,
				name: (row) => row.name,
			},
		});

		expect(result.count).toBe(2);

		const rows = await ctx.better.users.findMany({
			orderBy: { id: 'asc' },
			where: { id: { in: [1, 2] } },
		});
		expect(rows[0]?.name).toBe('Alice One');
		expect(rows[0]?.age).toBe(26);
		expect(rows[1]?.name).toBe('Bob Two');
		expect(rows[1]?.age).toBe(31);
	});

	test('supports select projection and extra where filter', async () => {
		const result = await ctx.better.users.updateEach({
			by: ctx.schema.users.id,
			data: [
				{ id: 1, active: false },
				{ id: 3, active: true },
			],
			select: { id: true, active: true },
			update: {
				active: (row) => row.active,
			},
			where: { active: true },
		});

		expect(result.count).toBe(1);
		expect(result.data).toEqual([{ id: 1, active: false }]);
	});

	test('returns count 0 on empty input by default', async () => {
		const result = await ctx.better.users.updateEach({
			by: ctx.schema.users.id,
			data: [],
			update: {
				name: () => 'ignored',
			},
		});

		expect(result.count).toBe(0);
	});

	test('throws on empty input when configured', async () => {
		await expect(
			ctx.better.users.updateEach({
				by: ctx.schema.users.id,
				data: [],
				onEmpty: 'throw',
				update: {
					name: () => 'ignored',
				},
			}),
		).rejects.toThrow('updateEach requires at least one input row.');
	});

	test('rejects duplicate match values', async () => {
		await expect(
			ctx.better.users.updateEach({
				by: ctx.schema.users.id,
				data: [
					{ id: 1, name: 'A' },
					{ id: 1, name: 'B' },
				],
				update: {
					name: (row) => row.name,
				},
			}),
		).rejects.toThrow('updateEach received duplicate "id" values.');
	});
});

describe('delete', () => {
	test('deletes a record and returns it', async () => {
		const result = await ctx.better.users.delete({
			where: { id: 5 },
		});

		expect(result).not.toBeNull();
		expect(result?.id).toBe(5);
		expect(result?.name).toBe('Eve');
	});

	test('delete returns null for non-existent record', async () => {
		const result = await ctx.better.users.delete({
			where: { id: 9999 },
		});

		expect(result).toBeNull();
	});

	test('delete is persisted', async () => {
		await ctx.better.users.delete({ where: { id: 5 } });

		const result = await ctx.better.users.findFirst({ where: { id: 5 } });
		expect(result).toBeNull();
	});
});

describe('deleteMany', () => {
	test('deletes multiple matching records', async () => {
		await ctx.raw.run(sql`PRAGMA foreign_keys = OFF`);
		await ctx.raw.run(sql`DELETE FROM test_comments`);
		await ctx.raw.run(sql`DELETE FROM test_posts`);
		await ctx.raw.run(sql`PRAGMA foreign_keys = ON`);

		const result = await ctx.better.users.deleteMany({
			where: { active: false },
		});

		expect(result.count).toBe(2);
	});

	test('deleteMany returns count 0 when no matches', async () => {
		const result = await ctx.better.users.deleteMany({
			where: { id: 9999 },
		});

		expect(result.count).toBe(0);
	});

	test('deleteMany is persisted', async () => {
		await ctx.raw.run(sql`PRAGMA foreign_keys = OFF`);
		await ctx.raw.run(sql`DELETE FROM test_comments`);
		await ctx.raw.run(sql`DELETE FROM test_posts`);
		await ctx.raw.run(sql`PRAGMA foreign_keys = ON`);

		await ctx.better.users.deleteMany({ where: { active: false } });

		const remaining = await ctx.better.users.findMany();
		const allActive = remaining.every((u) => u.active);
		expect(allActive).toBe(true);
	});
});

describe('upsert', () => {
	test('upsert creates record when it does not exist', async () => {
		const result = await ctx.better.users.upsert({
			where: { name: 'New User' },
			create: {
				id: 300,
				email: 'upsert@example.com',
				name: 'New User',
				age: 40,
				active: true,
			},
			update: { name: 'Upsert Updated' },
		});

		expect(result).not.toBeNull();
		expect(result?.name).toBe('New User');
	});

	test('upsert updates record when it exists', async () => {
		const result = await ctx.better.users.upsert({
			where: { name: 'Alice' },
			create: {
				id: 1,
				email: 'alice@example.com',
				name: 'Alice',
				age: 25,
				active: true,
			},
			update: { name: 'Alice Upserted' },
		});

		expect(result).not.toBeNull();
		expect(result?.name).toBe('Alice Upserted');
	});

	test('upsert with select returns only selected fields', async () => {
		const result = await ctx.better.users.upsert({
			where: { name: 'Bob' },
			create: {
				id: 2,
				email: 'bob@example.com',
				name: 'Bob',
				age: 30,
				active: true,
			},
			update: { name: 'Bob Updated' },
			select: { id: true, name: true },
		});

		expect(result).toEqual({ id: 2, name: 'Bob Updated' });
	});

	test('upsert with include returns related data', async () => {
		type PostWithAuthor = { title: string; author: { id: number } };

		const result = await ctx.better.posts.upsert({
			where: { title: 'First Post' },
			create: {
				id: 1,
				userId: 1,
				title: 'First Post',
				body: 'Body',
				score: 0,
				published: false,
			},
			update: { title: 'Post Upserted' },
			include: { author: true },
		});

		expect(result).toBeDefined();
		const typed = result as unknown as PostWithAuthor;
		expect(typed.title).toBe('Post Upserted');
		expect(typed.author).toBeDefined();
	});
});

describe('upsertMany', () => {
	test('upsertMany inserts and updates rows in one batch', async () => {
		const result = await ctx.better.users.upsertMany({
			data: [
				{
					id: 1,
					email: 'alice@example.com',
					name: 'Alice Batch',
					age: 26,
					active: false,
				},
				{
					id: 300,
					email: 'batch-new@example.com',
					name: 'Batch New',
					age: 22,
					active: true,
				},
			],
			target: 'email',
			update: 'all',
		});

		expect(result.count).toBe(2);
		expect(result.data?.length).toBe(2);

		const updated = await ctx.better.users.findFirst({
			where: { email: 'alice@example.com' },
		});
		const created = await ctx.better.users.findFirst({
			where: { email: 'batch-new@example.com' },
		});

		expect(updated).toMatchObject({
			id: 1,
			name: 'Alice Batch',
			age: 26,
			active: false,
		});
		expect(created).toMatchObject({
			id: 300,
			name: 'Batch New',
			age: 22,
			active: true,
		});
	});

	test('upsertMany supports select projection', async () => {
		const result = await ctx.better.users.upsertMany({
			data: [
				{
					id: 2,
					email: 'bob@example.com',
					name: 'Bob Projected',
					age: 30,
					active: true,
				},
			],
			target: 'email',
			update: ['name'],
			select: { id: true, name: true },
		});

		expect(result).toEqual({
			count: 1,
			data: [{ id: 2, name: 'Bob Projected' }],
		});
	});

	test('upsertMany updates only requested columns for column-array strategy', async () => {
		await ctx.better.users.upsertMany({
			data: [
				{
					id: 3,
					email: 'charlie@example.com',
					name: 'Charlie Renamed',
					age: 99,
					active: true,
				},
			],
			target: 'email',
			update: ['name'],
		});

		const row = await ctx.better.users.findFirst({
			where: { email: 'charlie@example.com' },
		});
		expect(row).toMatchObject({
			id: 3,
			name: 'Charlie Renamed',
			age: 35,
			active: false,
		});
	});

	test('upsertMany supports callback update strategy', async () => {
		await ctx.better.users.upsertMany({
			data: [
				{
					id: 4,
					email: 'diana@example.com',
					name: 'Diana Callback',
					age: 28,
					active: true,
				},
			],
			target: 'email',
			update: ({ excluded }) => ({
				age: sql`length(${excluded.name})`,
				name: excluded.name,
			}),
		});

		const row = await ctx.better.users.findFirst({
			where: { email: 'diana@example.com' },
		});
		expect(row).toMatchObject({
			id: 4,
			name: 'Diana Callback',
			age: 'Diana Callback'.length,
		});
	});

	test('upsertMany applies where only to the conflict update side', async () => {
		const result = await ctx.better.users.upsertMany({
			data: [
				{
					id: 5,
					email: 'eve@example.com',
					name: 'Eve Skipped',
					age: 99,
					active: true,
				},
				{
					id: 301,
					email: 'where-new@example.com',
					name: 'Where New',
					age: 19,
					active: true,
				},
			],
			target: 'email',
			update: 'all',
			where: sql`${ctx.schema.users.active} = 1`,
		});

		expect(result.count).toBe(1);

		const skipped = await ctx.better.users.findFirst({
			where: { email: 'eve@example.com' },
		});
		const created = await ctx.better.users.findFirst({
			where: { email: 'where-new@example.com' },
		});

		expect(skipped).toMatchObject({
			id: 5,
			name: 'Eve',
			age: 22,
			active: false,
		});
		expect(created).toMatchObject({
			id: 301,
			name: 'Where New',
		});
	});

	test('upsertMany supports chunking with batchSize', async () => {
		const result = await ctx.better.users.upsertMany({
			data: [
				{
					id: 1,
					email: 'alice@example.com',
					name: 'Alice Chunk 1',
					age: 26,
					active: true,
				},
				{
					id: 2,
					email: 'bob@example.com',
					name: 'Bob Chunk 2',
					age: 31,
					active: false,
				},
				{
					id: 302,
					email: 'chunk-new@example.com',
					name: 'Chunk New',
					age: 18,
					active: true,
				},
			],
			target: 'email',
			update: ['name', 'age', 'active'],
			batchSize: 2,
		});

		expect(result.count).toBe(3);
		expect(result.data?.length).toBe(3);
	});

	test('upsertMany supports composite targets', async () => {
		const result = await ctx.better.memberships.upsertMany({
			data: [
				{
					id: 1,
					userId: 1,
					label: 'owner',
					note: 'Updated owner',
				},
				{
					id: 3,
					userId: 1,
					label: 'viewer',
					note: 'Inserted viewer',
				},
			],
			target: ['userId', 'label'],
			update: ['note'],
			select: { id: true, note: true },
		});

		expect(result.count).toBe(2);
		expect(result.data).toEqual([
			{ id: 1, note: 'Updated owner' },
			{ id: 3, note: 'Inserted viewer' },
		]);
	});

	test('upsertMany returns count 0 for empty input', async () => {
		const result = await ctx.better.users.upsertMany({
			data: [],
			target: 'email',
			update: 'all',
		});

		expect(result).toEqual({ count: 0 });
	});

	test('upsertMany rejects invalid target columns', async () => {
		await expect(
			ctx.better.users.upsertMany({
				data: [
					{
						id: 400,
						email: 'invalid-target-upsert@example.com',
						name: 'Invalid Target',
						age: 20,
						active: true,
					},
				],
				target: 'missing' as never,
				update: 'all',
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.OperationError,
		});
	});

	test('upsertMany rejects invalid update columns', async () => {
		await expect(
			ctx.better.users.upsertMany({
				data: [
					{
						id: 401,
						email: 'invalid-update-upsert@example.com',
						name: 'Invalid Update',
						age: 20,
						active: true,
					},
				],
				target: 'email',
				update: ['missing'] as never,
			}),
		).rejects.toMatchObject({
			code: BetterDrizzleErrorCode.OperationError,
		});
	});
});
