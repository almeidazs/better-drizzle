import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { BetterDrizzleError } from '../src';
import { createTestContext, type TestContext } from './setup';

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

describe('paginate - offset', () => {
	test('returns first page with default metadata', async () => {
		const result = await ctx.better.users.paginate({
			orderBy: [{ id: 'asc' }],
		});

		expect(result.data.length).toBeGreaterThan(0);
		expect(result.pagination).toEqual({
			type: 'offset',
			page: 1,
			perPage: 10,
			total: 5,
			pageCount: 1,
			hasNext: false,
			hasPrevious: false,
		});
	});

	test('paginate with limit', async () => {
		const result = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
		});

		expect(result.data.map((row) => row.id)).toEqual([1, 2]);
		expect(result.pagination).toEqual({
			type: 'offset',
			page: 1,
			perPage: 2,
			total: 5,
			pageCount: 3,
			hasNext: true,
			hasPrevious: false,
		});
	});

	test('paginate with skip computes page metadata', async () => {
		const result = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			skip: 2,
		});

		expect(result.data.map((row) => row.id)).toEqual([3, 4]);
		expect(result.pagination).toEqual({
			type: 'offset',
			page: 2,
			perPage: 2,
			total: 5,
			pageCount: 3,
			hasNext: true,
			hasPrevious: true,
		});
	});

	test('paginate last page', async () => {
		const result = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			skip: 4,
		});

		expect(result.data.map((row) => row.id)).toEqual([5]);
		expect(result.pagination.hasNext).toBe(false);
		expect(result.pagination.hasPrevious).toBe(true);
		expect(result.pagination.page).toBe(3);
	});

	test('paginate with where filter', async () => {
		const result = await ctx.better.users.paginate({
			limit: 10,
			where: { active: true },
			orderBy: [{ id: 'asc' }],
		});

		expect(result.data.length).toBe(3);
		expect(result.pagination.total).toBe(3);
		expect(result.data.every((u) => u.active)).toBe(true);
	});

	test('paginate with take instead of limit', async () => {
		const result = await ctx.better.users.paginate({
			take: 3,
			orderBy: [{ id: 'asc' }],
		});

		expect(result.data.length).toBe(3);
		expect(result.pagination.perPage).toBe(3);
	});

	test('paginate empty result', async () => {
		const result = await ctx.better.users.paginate({ where: { id: 9999 } });

		expect(result.data.length).toBe(0);
		expect(result.pagination).toEqual({
			type: 'offset',
			page: 1,
			perPage: 10,
			total: 0,
			pageCount: 0,
			hasNext: false,
			hasPrevious: false,
		});
	});

	test('paginate with select', async () => {
		const result = await ctx.better.users.paginate({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			select: { id: true, name: true },
		});

		expect(result.data.length).toBe(2);
		for (const row of result.data)
			expect(Object.keys(row)).toEqual(['id', 'name']);
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
});

describe('cursor - cursor pagination', () => {
	test('cursor forward pagination returns navigation tokens', async () => {
		const first = await ctx.better.users.cursor({
			limit: 2,
			orderBy: [{ id: 'asc' }],
		});

		expect(first.data.map((row) => row.id)).toEqual([1, 2]);
		expect(first.pagination.type).toBe('cursor');
		expect(first.pagination.hasNext).toBe(true);
		expect(first.pagination.hasPrevious).toBe(false);
		expect(first.pagination.nextCursor).toEqual({ id: 2 });
		expect(first.pagination.previousCursor).toBeNull();

		const second = await ctx.better.users.cursor({
			after: first.pagination.nextCursor as { id: number },
			limit: 2,
			orderBy: [{ id: 'asc' }],
		});

		expect(second.data.map((row) => row.id)).toEqual([3, 4]);
		expect(second.pagination.hasPrevious).toBe(true);
		expect(second.pagination.previousCursor).toEqual({ id: 3 });
		expect(second.pagination.nextCursor).toEqual({ id: 4 });
	});

	test('cursor backward pagination preserves requested order', async () => {
		const previous = await ctx.better.users.cursor({
			before: { id: 4 },
			limit: 2,
			orderBy: [{ id: 'asc' }],
		});

		expect(previous.data.map((row) => row.id)).toEqual([2, 3]);
		expect(previous.pagination.hasNext).toBe(true);
		expect(previous.pagination.hasPrevious).toBe(true);
		expect(previous.pagination.nextCursor).toEqual({ id: 3 });
		expect(previous.pagination.previousCursor).toEqual({ id: 2 });
	});

	test('cursor infers orderBy from after when none is provided', async () => {
		const page = await ctx.better.users.cursor({
			after: { id: 4 },
			limit: 2,
		});

		expect(page.data.map((row) => row.id)).toEqual([3, 2]);
		expect(page.pagination.nextCursor).toEqual({ id: 2 });
		expect(page.pagination.previousCursor).toEqual({ id: 3 });
	});

	test('cursor infers orderBy from before when none is provided', async () => {
		const page = await ctx.better.users.cursor({
			before: { id: 4 },
			limit: 2,
		});

		expect(page.data.map((row) => row.id)).toEqual([2, 3]);
		expect(page.pagination.nextCursor).toEqual({ id: 3 });
		expect(page.pagination.previousCursor).toEqual({ id: 2 });
	});

	test('cursor pagination with where filter', async () => {
		const first = await ctx.better.users.cursor({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			where: { active: true },
		});

		expect(first.data.length).toBe(2);
		expect(first.data.every((u) => u.active)).toBe(true);
	});

	test('cursor pagination end of data', async () => {
		const all = await ctx.better.users.cursor({
			limit: 100,
			orderBy: [{ id: 'asc' }],
		});

		expect(all.pagination.hasNext).toBe(false);
		expect(all.pagination.nextCursor).toBeNull();
	});

	test('cursor with select', async () => {
		const result = await ctx.better.users.cursor({
			limit: 2,
			orderBy: [{ id: 'asc' }],
			select: { id: true, name: true },
		});

		expect(result.data.length).toBe(2);
		expect(result.pagination.nextCursor).toEqual({ id: 2 });
		for (const row of result.data)
			expect(Object.keys(row)).toEqual(['id', 'name']);
	});

	test('cursor with include', async () => {
		type PostWithAuthor = { author: unknown };

		const result = await ctx.better.posts.cursor({
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

	test('cursor rejects before and after together', async () => {
		await expect(
			ctx.better.users.cursor({
				before: { id: 4 },
				after: { id: 2 },
				limit: 2,
				orderBy: [{ id: 'asc' }],
			}),
		).rejects.toBeInstanceOf(BetterDrizzleError);
	});
});
