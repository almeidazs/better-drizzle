import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';

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
