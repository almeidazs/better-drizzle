import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestContext, type TestContext } from './setup';

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

describe('repository()', () => {
	test('resolves repository by schema key', async () => {
		const repo = ctx.better.repository('users');
		expect(repo).toBeDefined();
		expect(typeof repo.findMany).toBe('function');
		expect(typeof repo.findFirst).toBe('function');
		expect(typeof repo.findOne).toBe('function');
		expect(typeof repo.findUnique).toBe('function');
		expect(typeof repo.create).toBe('function');
		expect(typeof repo.createMany).toBe('function');
		expect(typeof repo.update).toBe('function');
		expect(typeof repo.updateEach).toBe('function');
		expect(typeof repo.updateMany).toBe('function');
		expect(typeof repo.delete).toBe('function');
		expect(typeof repo.deleteMany).toBe('function');
		expect(typeof repo.upsert).toBe('function');
		expect(typeof repo.upsertMany).toBe('function');
		expect(typeof repo.count).toBe('function');
		expect(typeof repo.exists).toBe('function');
		expect(typeof repo.paginate).toBe('function');
	});

	test('resolves repository by db table name', async () => {
		const repo = ctx.better.repository('test_users');
		expect(repo).toBeDefined();
		expect(typeof repo.findMany).toBe('function');
	});

	test('repository works the same as direct delegate', async () => {
		const repo = ctx.better.repository('users');
		const result = await repo.findMany({ where: { id: 1 } });
		expect(result.length).toBe(1);
		expect(result[0]?.name).toBe('Alice');
	});

	test('repository works on scoped clients', async () => {
		const repo = ctx.better
			.$withContext({ requestId: 'req-1' })
			.repository('users');
		const result = await repo.findMany({ where: { id: 1 } });

		expect(result.length).toBe(1);
		expect(result[0]?.name).toBe('Alice');
	});

	test('repository works for all tables', async () => {
		const users = ctx.better.repository('users');
		const posts = ctx.better.repository('posts');
		const comments = ctx.better.repository('comments');

		expect(await users.count()).toBe(5);
		expect(await posts.count()).toBe(6);
		expect(await comments.count()).toBe(5);
	});

	test('throws for non-existent repository', () => {
		expect(() => ctx.better.repository('nonexistent')).toThrow(
			'Repository "nonexistent" not found.',
		);
	});

	test('repository supports create', async () => {
		const repo = ctx.better.repository('users');
		const result = await repo.create({
			data: {
				id: 100,
				email: 'repo@example.com',
				name: 'Repo',
				age: 40,
				active: true,
			},
		});

		expect(result).not.toBeNull();
		expect(result?.name).toBe('Repo');
	});

	test('repository supports update', async () => {
		const repo = ctx.better.repository('users');
		const result = await repo.update({
			data: { name: 'Updated via repo' },
			where: { id: 1 },
		});

		expect(result).not.toBeNull();
		expect(result?.name).toBe('Updated via repo');
	});

	test('repository supports delete', async () => {
		const repo = ctx.better.repository('users');
		const result = await repo.delete({ where: { id: 5 } });

		expect(result).not.toBeNull();
		expect(result?.name).toBe('Eve');
	});

	test('repository supports count', async () => {
		const repo = ctx.better.repository('users');
		const count = await repo.count();
		expect(count).toBe(5);
	});

	test('repository supports exists', async () => {
		const repo = ctx.better.repository('users');
		expect(await repo.exists({ where: { id: 1 } })).toBe(true);
		expect(await repo.exists({ where: { id: 9999 } })).toBe(false);
	});

	test('repository supports paginate', async () => {
		const repo = ctx.better.repository('users');
		const result = await repo.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
		});

		expect(result.data.length).toBe(2);
		expect(result.pagination.count).toBe(5);
	});
});

describe('client - table delegates', () => {
	test('all tables are accessible as properties', () => {
		expect(ctx.better.users).toBeDefined();
		expect(ctx.better.posts).toBeDefined();
		expect(ctx.better.comments).toBeDefined();
	});

	test('delegate has all expected methods', () => {
		const methods = [
			'count',
			'create',
			'createMany',
			'delete',
			'deleteMany',
			'exists',
			'findFirst',
			'findMany',
			'findOne',
			'findUnique',
			'paginate',
			'update',
			'updateEach',
			'updateMany',
			'upsert',
			'upsertMany',
		];

		for (const method of methods) {
			expect(
				typeof (ctx.better.users as Record<string, unknown>)[method],
			).toBe('function');
		}
	});
});
