import { describe, expect, test } from 'bun:test';

import { param } from '../../src';
import { createDb } from './order-by-relations.fixture';

const ids = (rows: { id: number }[]) => rows.map((row) => row.id);

describe('orderBy relation fields', () => {
	test('sorts by a one relation field, missing related rows as NULL', async () => {
		const db = createDb();
		const rows = await db.posts.findMany({
			orderBy: [
				{ author: { name: { direction: 'asc', nulls: 'last' } } },
				{ id: 'asc' },
			],
		});
		expect(ids(rows)).toEqual([2, 5, 3, 1, 4]);
	});

	test('sorts by a field two one relations away', async () => {
		const db = createDb();
		const rows = await db.posts.findMany({
			orderBy: [
				{
					author: {
						profile: { bio: { direction: 'desc', nulls: 'last' } },
					},
				},
				{ id: 'asc' },
			],
		});
		expect(ids(rows)).toEqual([1, 3, 2, 4, 5]);
	});

	test('sorts by the row count of a many relation', async () => {
		const db = createDb();
		const rows = await db.authors.findMany({
			orderBy: [{ posts: { _count: 'desc' } }, { id: 'asc' }],
		});
		expect(ids(rows)).toEqual([2, 1, 3, 4]);
	});

	test('sorts by the row count of a many-to-many relation', async () => {
		const db = createDb();
		expect(
			ids(
				await db.posts.findMany({
					orderBy: [{ tags: { _count: 'desc' } }, { id: 'asc' }],
				}),
			),
		).toEqual([1, 5, 3, 2, 4]);
		expect(
			ids(
				await db.tags.findMany({
					orderBy: { posts: { _count: 'asc' } },
				}),
			),
		).toEqual([3, 2, 1]);
	});

	test('sorts by a to-many count behind a one relation', async () => {
		const db = createDb();
		const rows = await db.profiles.findMany({
			orderBy: [{ author: { posts: { _count: 'desc' } } }, { id: 'asc' }],
		});
		expect(ids(rows)).toEqual([2, 1, 3]);
	});

	test('sorts self relations by their own alias', async () => {
		const db = createDb();
		expect(
			ids(
				await db.categories.findMany({
					orderBy: [
						{
							parent: {
								name: { direction: 'asc', nulls: 'last' },
							},
						},
						{ id: 'asc' },
					],
				}),
			),
		).toEqual([4, 6, 7, 3, 1, 2, 5]);
		expect(
			ids(
				await db.categories.findMany({
					orderBy: [
						{
							parent: {
								parent: {
									name: { direction: 'asc', nulls: 'last' },
								},
							},
						},
						{ children: { _count: 'desc' } },
						{ id: 'desc' },
					],
				}),
			),
		).toEqual([7, 6, 4, 3, 2, 1, 5]);
	});

	test('sorts nested include rows, with and without take', async () => {
		const db = createDb();
		const authorsWithPosts = await db.authors.findMany({
			include: {
				posts: {
					orderBy: [{ tags: { _count: 'desc' } }, { id: 'asc' }],
				},
			},
			where: { id: 2 },
		});
		expect(ids(authorsWithPosts[0]?.posts ?? [])).toEqual([5, 2]);

		const tagsWithPosts = await db.tags.findMany({
			include: {
				posts: { orderBy: { author: { name: 'asc' } }, take: 2 },
			},
			orderBy: { id: 'asc' },
		});
		expect(tagsWithPosts.map((tag) => ids(tag.posts))).toEqual([
			[5, 3],
			[5, 1],
			[1],
		]);
	});

	test('sorts the joined one relation include path', async () => {
		const db = createDb();
		const rows = await db.posts.findMany({
			include: { author: true },
			orderBy: [{ author: { name: 'desc' } }, { id: 'asc' }],
			where: { author: { is: { id: { in: [1, 2, 3] } } } },
		});
		expect(ids(rows)).toEqual([1, 3, 2, 5]);
		expect(rows[0]?.author?.name).toBe('Carol');
	});

	test('works with every read helper', async () => {
		const db = createDb();
		const orderBy = [{ author: { name: 'asc' } }, { id: 'desc' }] as const;
		const {
			data,
			pagination: { total },
		} = await db.posts.paginate({
			orderBy: [...orderBy],
			page: 1,
			perPage: 2,
			where: { authorId: { not: null } },
		});
		expect(ids(data)).toEqual([5, 2]);
		expect(total).toBe(4);
		expect(
			(
				await db.posts.findFirst({
					orderBy: [...orderBy],
					where: { authorId: { not: null } },
				})
			)?.id,
		).toBe(5);
		expect(
			(
				await db.authors.findOne({
					orderBy: { posts: { _count: 'desc' } },
				})
			)?.id,
		).toBe(2);
	});

	test('shows the sort subquery in explain()', async () => {
		const db = createDb();
		const { statements } = await db.posts
			.findMany({ orderBy: { author: { name: 'asc' } } })
			.explain();
		expect(statements[0]?.sql).toContain('__better_order_0');
	});

	test('skips undefined relation sort fields at every depth', async () => {
		const db = createDb();
		for (const orderBy of [
			{ author: undefined },
			{ author: { name: undefined } },
			{ author: { profile: { bio: undefined } } },
		]) {
			const { statements } = await db.posts
				.findMany({ orderBy })
				.explain();
			expect(statements[0]?.sql).not.toContain('order by');
		}
	});

	test('prepares reads with relation sorts', async () => {
		const db = createDb();
		const statement = db.posts
			.findMany({
				orderBy: [{ author: { name: 'asc' } }, { id: 'asc' }],
				where: { id: { gt: param('min') } },
			})
			.prepare();
		// SQLite sorts NULL first ascending, so the post without an author leads.
		expect(ids(await statement.execute({ min: 1 }))).toEqual([4, 2, 5, 3]);
		expect(ids(await statement.execute({ min: 3 }))).toEqual([4, 5]);
	});

	test('rejects invalid relation sort shapes with INVALID_ARGS', async () => {
		const db = createDb();
		const invalid = [
			{ author: 'asc' },
			{ author: { _count: 'asc' } },
			{ posts: 'desc' },
			{ posts: { title: 'asc' } },
			{ posts: { _count: 'up' } },
			{ posts: { _count: 'asc', title: 'asc' } },
		];
		for (const orderBy of invalid) {
			const delegate = ('author' in orderBy
				? db.posts
				: db.authors) as unknown as {
				findMany(args: unknown): PromiseLike<unknown>;
			};
			await expect(
				Promise.resolve(delegate.findMany({ orderBy })),
			).rejects.toMatchObject({ code: 'INVALID_ARGS' });
		}
	});

	test('rejects relation sorts combined with cursors', async () => {
		const db = createDb();
		await expect(
			Promise.resolve(
				db.posts.findMany({
					cursor: { id: 2 },
					orderBy: [{ author: { name: 'asc' } }, { id: 'asc' }],
				}),
			),
		).rejects.toMatchObject({ code: 'INVALID_ARGS' });
		await expect(
			Promise.resolve(
				db.posts.cursor({
					limit: 2,
					orderBy: [{ author: { name: 'asc' } }, { id: 'asc' }],
				}),
			),
		).rejects.toMatchObject({ code: 'INVALID_ARGS' });
		await expect(
			Promise.resolve(
				db.authors.findMany({
					include: {
						posts: {
							cursor: { id: 2 },
							orderBy: [
								{ tags: { _count: 'asc' } },
								{ id: 'asc' },
							],
						},
					},
				}),
			),
		).rejects.toMatchObject({ code: 'INVALID_ARGS' });
	});
});
