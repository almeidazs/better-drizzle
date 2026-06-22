import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { PaginationType } from '../src/types';
import { createTestContext, type TestContext } from './setup';

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

describe('paginate - offset', () => {
	test('returns first page with default limit', async () => {
		const result = await ctx.better.users.paginate({
			orderBy: [{ id: 'asc' }],
		});

		expect(result.data.length).toBeGreaterThan(0);
		expect(result.pagination.count).toBe(5);
		expect(result.pagination.hasNext).toBeDefined();
		expect(result.pagination.hasPrevious).toBeDefined();
	});

	test('paginate with limit', async () => {
		const result = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
		});

		expect(result.data.length).toBe(2);
		expect(result.pagination.count).toBe(5);
		expect(result.pagination.hasNext).toBe(true);
		expect(result.pagination.hasPrevious).toBe(false);
	});

	test('paginate with skip', async () => {
		const result = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			skip: 2,
		});

		expect(result.data.length).toBe(2);
		expect(result.pagination.hasNext).toBe(true);
		expect(result.pagination.hasPrevious).toBe(true);
	});

	test('paginate last page', async () => {
		const result = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			skip: 4,
		});

		expect(result.data.length).toBe(1);
		expect(result.pagination.hasNext).toBe(false);
		expect(result.pagination.hasPrevious).toBe(true);
	});

	test('paginate with where filter', async () => {
		const result = await ctx.better.users.paginate({
			limit: 10,
			where: { active: true },
			orderBy: [{ id: 'asc' }],
		});

		expect(result.data.length).toBe(3);
		expect(result.pagination.count).toBe(3);
		expect(result.data.every((u) => u.active)).toBe(true);
	});

	test('paginate with take instead of limit', async () => {
		const result = await ctx.better.users.paginate({
			take: 3,
			orderBy: [{ id: 'asc' }],
		});
		expect(result.data.length).toBe(3);
	});

	test('paginate empty result', async () => {
		const result = await ctx.better.users.paginate({ where: { id: 9999 } });

		expect(result.data.length).toBe(0);
		expect(result.pagination.count).toBe(0);
		expect(result.pagination.hasNext).toBe(false);
		expect(result.pagination.hasPrevious).toBe(false);
	});

	test('paginate with select', async () => {
		const result = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			select: { id: true, name: true },
		});

		expect(result.data.length).toBe(2);
		for (const row of result.data) {
			expect(Object.keys(row)).toEqual(['id', 'name']);
		}
	});

	test('paginate with include', async () => {
		type PostWithAuthor = { author: unknown };

		const result = await ctx.better.posts.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			include: { author: true },
		});

		expect(result.data.length).toBe(2);
		for (const row of result.data) {
			const typed = row as unknown as PostWithAuthor;
			expect(typed.author).toBeDefined();
		}
	});

	test('paginate with where and skip returns hasPrevious true', async () => {
		const result = await ctx.better.users.paginate({
			limit: 10,
			skip: 1,
			orderBy: [{ id: 'asc' }],
		});

		expect(result.pagination.hasPrevious).toBe(true);
	});
});

describe('paginate - cursor', () => {
	test('cursor forward pagination', async () => {
		const first = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			type: PaginationType.Cursor,
		});

		expect(first.data.length).toBe(2);
		expect(first.pagination.hasNext).toBe(true);

		const lastId = first.data[first.data.length - 1]?.id;

		const second = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			after: { id: lastId },
			type: PaginationType.Cursor,
		});

		expect(second.data.length).toBe(2);
		expect(second.pagination.hasPrevious).toBe(true);
	});

	test('cursor backward pagination', async () => {
		const last = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'desc' }],
			type: PaginationType.Cursor,
		});

		expect(last.data.length).toBe(2);

		const firstId = last.data[last.data.length - 1]?.id;

		const previous = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'desc' }],
			before: { id: firstId },
			type: PaginationType.Cursor,
		});

		expect(previous.data.length).toBeGreaterThanOrEqual(1);
	});

	test('cursor pagination with where filter', async () => {
		const first = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			where: { active: true },
			type: PaginationType.Cursor,
		});

		expect(first.data.length).toBe(2);
		expect(first.data.every((u) => u.active)).toBe(true);
	});

	test('cursor pagination end of data', async () => {
		const all = await ctx.better.users.paginate({
			limit: 100,
			orderBy: [{ id: 'asc' }],
			type: PaginationType.Cursor,
		});

		expect(all.pagination.hasNext).toBe(false);
	});

	test('cursor with select', async () => {
		const result = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			type: PaginationType.Cursor,
			select: { id: true, name: true },
		});

		expect(result.data.length).toBe(2);
		for (const row of result.data) {
			expect(Object.keys(row)).toEqual(['id', 'name']);
		}
	});

	test('cursor with include', async () => {
		type PostWithAuthor = { author: unknown };

		const result = await ctx.better.posts.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			type: PaginationType.Cursor,
			include: { author: true },
		});

		expect(result.data.length).toBe(2);
		for (const row of result.data) {
			const typed = row as unknown as PostWithAuthor;
			expect(typed.author).toBeDefined();
		}
	});
});
