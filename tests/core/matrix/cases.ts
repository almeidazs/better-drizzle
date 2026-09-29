import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'bun:test';

import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { SQLiteBunDatabase } from 'drizzle-orm/bun-sqlite';

import {
	BetterDrizzleError,
	BetterDrizzleTransactionRollbackError,
	better,
	isForeignKeyViolation,
	isUniqueViolation,
} from '../../../src';
import {
	FREE_PROFILE_IDS,
	POST_AUTHOR_COUNT,
	SEED,
	USER_COUNT,
	type MatrixRelations,
	type MatrixSchema,
	type SeedUser,
} from './schema';

export type MatrixOptions = NonNullable<
	Parameters<typeof better<MatrixRelations>>[1]
>;
export type MatrixDb = ReturnType<typeof better<MatrixRelations>>;
// The PostgreSQL harness casts its client to the SQLite-typed shape: both
// dialects share one logical model, so the runtime surface is identical.
export type MatrixRaw = SQLiteBunDatabase<MatrixRelations>;

export type MatrixContext = {
	dialect: 'pg' | 'sqlite';
	db: MatrixDb;
	raw: MatrixRaw;
	schema: MatrixSchema;
	make(options?: MatrixOptions): MatrixDb;
	/** A Drizzle instance created without `relations`. */
	rawWithoutRelations(): unknown;
};

export type MatrixHarness = {
	setup?(): Promise<void>;
	reset(): Promise<MatrixContext>;
	teardown?(): Promise<void>;
};

const byNumber = (a: number, b: number) => a - b;
const ids = (rows: readonly { id: number }[]) => rows.map((row) => row.id);
const sortedIds = (rows: readonly { id: number }[]) => ids(rows).sort(byNumber);
const read = <T>(query: PromiseLike<T>) => Promise.resolve(query);

const seedUser = (id: number) => SEED.users[id - 1] as SeedUser;
const seedPost = (id: number) => SEED.posts[id - 1] as (typeof SEED.posts)[0];
const postsOf = (userId: number) =>
	SEED.posts.filter((post) => post.authorId === userId);
const commentsOf = (postId: number) =>
	SEED.comments.filter((comment) => comment.postId === postId);
const groupIdsOf = (userId: number) =>
	SEED.memberships
		.filter((membership) => membership.userId === userId)
		.map((membership) => membership.groupId)
		.sort(byNumber);
const userIdsInGroup = (groupId: number) =>
	SEED.memberships
		.filter((membership) => membership.groupId === groupId)
		.map((membership) => membership.userId)
		.sort(byNumber);
const tagIdsOf = (postId: number) =>
	SEED.postTags
		.filter((link) => link.postId === postId)
		.map((link) => link.tagId)
		.sort(byNumber);
const followingOf = (userId: number) =>
	SEED.follows
		.filter((follow) => follow.followerId === userId)
		.map((follow) => follow.followingId)
		.sort(byNumber);
const followersOf = (userId: number) =>
	SEED.follows
		.filter((follow) => follow.followingId === userId)
		.map((follow) => follow.followerId)
		.sort(byNumber);
const profileOf = (userId: number) =>
	SEED.profiles.find((profile) => profile.userId === userId) ?? null;
const range = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, index) => from + index);

export const defineMatrix = (name: string, harness: MatrixHarness) => {
	describe(`${name} compatibility matrix`, () => {
		let ctx: MatrixContext;
		let db: MatrixDb;

		beforeAll(async () => {
			await harness.setup?.();
		});

		afterAll(async () => {
			await harness.teardown?.();
		});

		beforeEach(async () => {
			ctx = await harness.reset();
			db = ctx.db;
		});

		describe('reads', () => {
			test('findMany applies where, orderBy, take and skip', async () => {
				const rows = await db.users.findMany({
					orderBy: { id: 'desc' },
					skip: 2,
					take: 5,
					where: { active: true, age: { gte: 40 } },
				});
				const expected = SEED.users
					.filter((user) => user.active && user.age >= 40)
					.sort((a, b) => b.id - a.id)
					.slice(2, 7);
				expect(rows).toEqual(expected);
			});

			test('findMany supports OR, NOT, in and null filters', async () => {
				const rows = await db.users.findMany({
					orderBy: { id: 'asc' },
					where: {
						OR: [{ id: { in: [1, 2, 3] } }, { nickname: null }],
						NOT: { id: { gt: 20 } },
					},
				});
				expect(ids(rows)).toEqual([1, 2, 3, 4, 8, 12, 16, 20]);
			});

			test('findFirst returns full typed row including Date and boolean', async () => {
				const row = await db.users.findFirst({
					orderBy: { createdAt: 'desc' },
				});
				expect(row).toEqual(seedUser(USER_COUNT));
				expect(row?.createdAt).toBeInstanceOf(Date);
				expect(typeof row?.active).toBe('boolean');
			});

			test('findOne and findUnique resolve rows, null and .throw()', async () => {
				expect(await db.users.findOne({ where: { id: 7 } })).toEqual(
					seedUser(7),
				);
				expect(
					await db.users.findUnique({
						where: { email: 'user9@matrix.test' },
					}),
				).toEqual(seedUser(9));
				expect(
					await db.users.findUnique({ where: { id: 9999 } }),
				).toBeNull();
				expect(
					await db.users.findOne({ where: { id: 9999 } }),
				).toBeNull();
				await expect(
					read(db.users.findOne({ where: { id: 9999 } }).throw()),
				).rejects.toBeInstanceOf(BetterDrizzleError);
			});

			test('count and exists', async () => {
				expect(await db.users.count()).toBe(USER_COUNT);
				expect(
					await db.posts.count({ where: { published: true } }),
				).toBe(SEED.posts.filter((post) => post.published).length);
				expect(await db.users.exists({ where: { id: 1 } })).toBe(true);
				expect(await db.users.exists({ where: { id: 9999 } })).toBe(
					false,
				);
			});

			test('paginate returns offset metadata', async () => {
				const active = SEED.users.filter((user) => user.active);
				const { data, pagination } = await db.users.paginate({
					limit: 10,
					orderBy: { id: 'asc' },
					skip: 20,
					where: { active: true },
				});
				expect(ids(data)).toEqual(ids(active.slice(20, 30)));
				expect(pagination).toEqual({
					hasNext: true,
					hasPrevious: true,
					page: 3,
					pageCount: Math.ceil(active.length / 10),
					perPage: 10,
					total: active.length,
					type: 'offset',
				});
			});

			test('cursor paginates forward to the end', async () => {
				const first = await db.users.cursor({
					limit: 5,
					orderBy: { id: 'asc' },
				});
				expect(ids(first.data)).toEqual([1, 2, 3, 4, 5]);
				expect(first.pagination).toEqual({
					hasNext: true,
					hasPrevious: false,
					nextCursor: { id: 5 },
					previousCursor: null,
					type: 'cursor',
				});

				const middle = await db.users.cursor({
					after: first.pagination.nextCursor as { id: number },
					limit: 5,
					orderBy: { id: 'asc' },
				});
				expect(ids(middle.data)).toEqual([6, 7, 8, 9, 10]);
				expect(middle.pagination.hasPrevious).toBe(true);
				expect(middle.pagination.hasNext).toBe(true);
				expect(middle.pagination.previousCursor).toEqual({ id: 6 });

				const last = await db.users.cursor({
					after: { id: USER_COUNT - 5 },
					limit: 5,
					orderBy: { id: 'asc' },
				});
				expect(ids(last.data)).toEqual(
					range(USER_COUNT - 4, USER_COUNT),
				);
				expect(last.pagination.hasNext).toBe(false);
				expect(last.pagination.nextCursor).toBeNull();
				expect(last.pagination.hasPrevious).toBe(true);
			});

			test('cursor paginates backward and with filters', async () => {
				const back = await db.users.cursor({
					before: { id: 6 },
					limit: 5,
					orderBy: { id: 'asc' },
				});
				expect(ids(back.data)).toEqual([1, 2, 3, 4, 5]);
				expect(back.pagination.hasPrevious).toBe(false);
				expect(back.pagination.hasNext).toBe(true);

				const backMid = await db.users.cursor({
					before: { id: 20 },
					limit: 3,
					orderBy: { id: 'asc' },
				});
				expect(ids(backMid.data)).toEqual([17, 18, 19]);
				expect(backMid.pagination.hasPrevious).toBe(true);
				expect(backMid.pagination.hasNext).toBe(true);

				const inactive = SEED.users.filter((user) => !user.active);
				const filtered = await db.users.cursor({
					after: { id: 3 },
					limit: 4,
					orderBy: { id: 'desc' },
					where: { active: false },
				});
				// Descending: rows strictly after id 3 in desc order are < 3.
				expect(ids(filtered.data)).toEqual([]);
				const desc = await db.users.cursor({
					after: { id: 30 },
					limit: 4,
					orderBy: { id: 'desc' },
					where: { active: false },
				});
				expect(ids(desc.data)).toEqual(
					ids(
						inactive
							.filter((user) => user.id < 30)
							.sort((a, b) => b.id - a.id)
							.slice(0, 4),
					),
				);
				expect(desc.pagination.hasPrevious).toBe(true);
				expect(desc.pagination.hasNext).toBe(true);
			});

			test('orderBy supports nulls first and nulls last', async () => {
				const first = await db.users.findMany({
					orderBy: [
						{ nickname: { direction: 'asc', nulls: 'first' } },
						{ id: 'asc' },
					],
					take: 5,
				});
				expect(ids(first)).toEqual([4, 8, 12, 16, 20]);

				const last = await db.posts.findMany({
					orderBy: [
						{ editorId: { direction: 'desc', nulls: 'last' } },
						{ id: 'asc' },
					],
					where: { authorId: { in: [1, 2] } },
				});
				const expected = SEED.posts
					.filter((post) => post.authorId <= 2)
					.sort((a, b) => {
						if (a.editorId === b.editorId) return a.id - b.id;
						if (a.editorId === null) return 1;
						if (b.editorId === null) return -1;
						return b.editorId - a.editorId;
					});
				expect(ids(last)).toEqual(ids(expected));
			});
		});

		describe('relation loading', () => {
			test('one relations owned by the source (author, nullable editor, category)', async () => {
				const rows = await db.posts.findMany({
					include: { author: true, category: true, editor: true },
					orderBy: { id: 'asc' },
					where: { id: { in: [1, 2, 33] } },
				});
				expect(rows).toEqual(
					[1, 2, 33].map((id) => {
						const post = seedPost(id);
						return {
							...post,
							author: seedUser(post.authorId),
							category:
								SEED.categories.find(
									(category) =>
										category.id === post.categoryId,
								) ?? null,
							editor:
								post.editorId === null
									? null
									: seedUser(post.editorId),
						};
					}),
				);
				expect(rows[0]?.editor).toBeNull();
				expect(rows[2]?.category).toBeNull();
			});

			test('one-to-one where the foreign key lives on the target', async () => {
				const rows = await db.users.findMany({
					include: { profile: true },
					orderBy: { id: 'asc' },
					where: { id: { in: [1, 2, 3] } },
				});
				expect(rows.map((row) => row.profile)).toEqual([
					profileOf(1),
					null,
					profileOf(3),
				]);
			});

			test('many relations with nested orderBy', async () => {
				const user = await db.users.findFirst({
					include: { posts: { orderBy: { id: 'desc' } } },
					where: { id: 5 },
				});
				expect(user?.posts).toEqual(
					postsOf(5).sort((a, b) => b.id - a.id),
				);
				const lonely = await db.users.findFirst({
					include: { posts: true },
					where: { id: USER_COUNT },
				});
				expect(lonely?.posts).toEqual([]);
			});

			test('many-to-many in both directions (groups)', async () => {
				const users = await db.users.findMany({
					include: { groups: { orderBy: { id: 'asc' } } },
					orderBy: { id: 'asc' },
					where: { id: { in: [7, 10, 110] } },
				});
				expect(users.map((user) => ids(user.groups))).toEqual([
					groupIdsOf(7),
					groupIdsOf(10),
					[],
				]);
				expect(users[0]?.groups[0]).toEqual(
					SEED.groups[(groupIdsOf(7)[0] as number) - 1],
				);

				const group = await db.groups.findFirst({
					include: {
						users: {
							orderBy: { id: 'asc' },
							where: { id: { lte: 30 } },
						},
					},
					where: { id: 3 },
				});
				expect(ids(group?.users ?? [])).toEqual(
					userIdsInGroup(3).filter((id) => id <= 30),
				);
			});

			test('many-to-many in both directions (tags)', async () => {
				const post = await db.posts.findFirst({
					include: { tags: { orderBy: { id: 'asc' } } },
					where: { id: 4 },
				});
				expect(ids(post?.tags ?? [])).toEqual(tagIdsOf(4));
				const noTags = await db.posts.findFirst({
					include: { tags: true },
					where: { id: 3 },
				});
				expect(noTags?.tags).toEqual([]);

				const tag = await db.tags.findFirst({
					include: { posts: { orderBy: { id: 'asc' }, take: 5 } },
					where: { id: 2 },
				});
				const expected = SEED.postTags
					.filter((link) => link.tagId === 2)
					.map((link) => link.postId)
					.sort(byNumber)
					.slice(0, 5);
				expect(ids(tag?.posts ?? [])).toEqual(expected);
			});

			test('self one/many relations nest three levels', async () => {
				const roots = await db.categories.findMany({
					include: {
						children: {
							include: {
								children: { include: { parent: true } },
							},
							orderBy: { id: 'asc' },
						},
						parent: true,
					},
					orderBy: { id: 'asc' },
					where: { parentId: null },
				});
				expect(ids(roots)).toEqual([1, 2, 3]);
				const childIds = (parentId: number | null) =>
					SEED.categories
						.filter((category) => category.parentId === parentId)
						.map((category) => category.id)
						.sort(byNumber);
				for (const root of roots) {
					expect(root.parent).toBeNull();
					expect(ids(root.children)).toEqual(childIds(root.id));
					for (const child of root.children)
						expect(sortedIds(child.children)).toEqual(
							childIds(child.id),
						);
				}
				const cat4 = roots[0]?.children.find((child) => child.id === 4);
				expect(cat4?.children).toEqual([
					{
						id: 10,
						name: 'Cat 10',
						parent: { id: 4, name: 'Cat 4', parentId: 1 },
						parentId: 4,
					},
				]);
			});

			test('self many-to-many (following/followers)', async () => {
				const rows = await db.users.findMany({
					include: {
						followers: { orderBy: { id: 'asc' } },
						following: { orderBy: { id: 'asc' } },
					},
					orderBy: { id: 'asc' },
					where: { id: { in: [1, 11, 61] } },
				});
				expect(
					rows.map((row) => ({
						followers: ids(row.followers),
						following: ids(row.following),
					})),
				).toEqual(
					[1, 11, 61].map((id) => ({
						followers: followersOf(id),
						following: followingOf(id),
					})),
				);
			});

			test('aliased relations to the same table stay separate', async () => {
				const user = await db.users.findFirst({
					include: {
						comments: { orderBy: { id: 'asc' } },
						editedPosts: { orderBy: { id: 'asc' } },
						posts: { orderBy: { id: 'asc' } },
					},
					where: { id: 3 },
				});
				expect(ids(user?.posts ?? [])).toEqual(ids(postsOf(3)));
				expect(ids(user?.editedPosts ?? [])).toEqual(
					SEED.posts
						.filter((post) => post.editorId === 3)
						.map((post) => post.id),
				);
				expect(ids(user?.comments ?? [])).toEqual(
					SEED.comments
						.filter((comment) => comment.authorId === 3)
						.map((comment) => comment.id),
				);
				const comment = await db.comments.findFirst({
					include: {
						author: true,
						post: { include: { author: true } },
					},
					where: { id: 1 },
				});
				const seedComment = SEED
					.comments[0] as (typeof SEED.comments)[0];
				expect(comment?.author).toEqual(seedUser(seedComment.authorId));
				expect(comment?.post.id).toBe(seedComment.postId);
				expect(comment?.post.author).toEqual(
					seedUser(seedPost(seedComment.postId).authorId),
				);
			});

			test('nested select projects exact keys', async () => {
				const user = await db.users.findFirst({
					select: {
						id: true,
						name: true,
						posts: {
							orderBy: { id: 'asc' },
							select: { id: true, title: true },
							where: { published: true },
						},
						profile: { select: { bio: true } },
						groups: {
							orderBy: { id: 'asc' },
							select: { name: true },
						},
					},
					where: { id: 1 },
				});
				expect(user).toEqual({
					groups: groupIdsOf(1).map((id) => ({
						name: `Group ${id}`,
					})),
					id: 1,
					name: 'User 001',
					posts: postsOf(1)
						.filter((post) => post.published)
						.map((post) => ({ id: post.id, title: post.title })),
					profile: { bio: 'Bio 1' },
				});
				expect(Object.keys(user ?? {}).sort()).toEqual([
					'groups',
					'id',
					'name',
					'posts',
					'profile',
				]);
			});

			test('three-level include with nested where/orderBy/take/skip', async () => {
				const userIds = [1, 2, 3, 4];
				const rows = await db.users.findMany({
					include: {
						posts: {
							include: {
								comments: {
									include: {
										author: {
											select: { email: true, id: true },
										},
									},
									orderBy: { id: 'desc' },
									take: 1,
									where: { likes: { gte: 3 } },
								},
							},
							orderBy: [{ score: 'desc' }, { id: 'asc' }],
							skip: 1,
							take: 1,
							where: { published: true },
						},
					},
					orderBy: { id: 'asc' },
					where: { id: { in: userIds } },
				});
				const expected = userIds.map((userId) => {
					const posts = postsOf(userId)
						.filter((post) => post.published)
						.sort((a, b) => b.score - a.score || a.id - b.id)
						.slice(1, 2);
					return {
						id: userId,
						posts: posts.map((post) => ({
							comments: commentsOf(post.id)
								.filter((comment) => comment.likes >= 3)
								.sort((a, b) => b.id - a.id)
								.slice(0, 1)
								.map((comment) => ({
									...comment,
									author: {
										email: seedUser(comment.authorId).email,
										id: comment.authorId,
									},
								})),
							id: post.id,
						})),
					};
				});
				expect(
					rows.map((row) => ({
						id: row.id,
						posts: row.posts.map((post) => ({
							comments: post.comments,
							id: post.id,
						})),
					})),
				).toEqual(expected);
			});

			test('_count on many, many-to-many and self many-to-many', async () => {
				const rows = await db.users.findMany({
					include: {
						_count: {
							select: {
								comments: { where: { likes: { gte: 10 } } },
								followers: true,
								following: true,
								groups: true,
								posts: true,
							},
						},
					},
					orderBy: { id: 'asc' },
					where: { id: { in: [1, 11, 100, 120] } },
				});
				expect(rows.map((row) => row._count)).toEqual(
					[1, 11, 100, 120].map((id) => ({
						comments: SEED.comments.filter(
							(comment) =>
								comment.authorId === id && comment.likes >= 10,
						).length,
						followers: followersOf(id).length,
						following: followingOf(id).length,
						groups: groupIdsOf(id).length,
						posts: postsOf(id).length,
					})),
				);

				const posts = await db.posts.findMany({
					include: {
						_count: {
							select: {
								comments: true,
								tags: { where: { id: { lte: 6 } } },
							},
						},
					},
					orderBy: { id: 'asc' },
					take: 12,
				});
				expect(posts.map((post) => post._count)).toEqual(
					range(1, 12).map((id) => ({
						comments: commentsOf(id).length,
						tags: tagIdsOf(id).filter((tagId) => tagId <= 6).length,
					})),
				);
			});
		});

		describe('relation filters', () => {
			test('is / isNot / null on one relations', async () => {
				const inactiveAuthors = await db.posts.findMany({
					orderBy: { id: 'asc' },
					where: { author: { is: { active: false } } },
				});
				expect(ids(inactiveAuthors)).toEqual(
					SEED.posts
						.filter((post) => !seedUser(post.authorId).active)
						.map((post) => post.id),
				);

				const notYoungEditor = await db.posts.findMany({
					orderBy: { id: 'asc' },
					where: {
						authorId: { lte: 10 },
						editor: {
							is: { age: { gte: 40 } },
						},
					},
				});
				expect(ids(notYoungEditor)).toEqual(
					SEED.posts
						.filter(
							(post) =>
								post.authorId <= 10 &&
								post.editorId !== null &&
								seedUser(post.editorId).age >= 40,
						)
						.map((post) => post.id),
				);

				expect(
					await db.posts.count({ where: { editor: { is: null } } }),
				).toBe(
					SEED.posts.filter((post) => post.editorId === null).length,
				);
				expect(
					await db.posts.count({
						where: { editor: { isNot: null } },
					}),
				).toBe(
					SEED.posts.filter((post) => post.editorId !== null).length,
				);
				expect(
					await db.users.count({ where: { profile: { is: null } } }),
				).toBe(
					USER_COUNT -
						SEED.users.filter((u) => profileOf(u.id)).length,
				);
			});

			test('isNot on a nullable one keeps rows with no related record', async () => {
				const rows = await db.posts.findMany({
					orderBy: { id: 'asc' },
					where: {
						authorId: { lte: 10 },
						editor: { isNot: { age: { lt: 40 } } },
					},
				});
				expect(ids(rows)).toEqual(
					SEED.posts
						.filter(
							(post) =>
								post.authorId <= 10 &&
								(post.editorId === null ||
									seedUser(post.editorId).age >= 40),
						)
						.map((post) => post.id),
				);
			});

			test('some / every / none on many relations', async () => {
				const some = await db.users.findMany({
					orderBy: { id: 'asc' },
					where: { posts: { some: { score: { gte: 90 } } } },
				});
				expect(ids(some)).toEqual(
					SEED.users
						.filter((user) =>
							postsOf(user.id).some((post) => post.score >= 90),
						)
						.map((user) => user.id),
				);

				const every = await db.users.findMany({
					orderBy: { id: 'asc' },
					where: { posts: { every: { published: true } } },
				});
				expect(ids(every)).toEqual(
					SEED.users
						.filter((user) =>
							postsOf(user.id).every((post) => post.published),
						)
						.map((user) => user.id),
				);

				const none = await db.users.findMany({
					orderBy: { id: 'asc' },
					where: { posts: { none: {} } },
				});
				expect(ids(none)).toEqual(
					range(POST_AUTHOR_COUNT + 1, USER_COUNT),
				);
			});

			test('some / every / none through many-to-many (both directions)', async () => {
				const inGroup3 = await db.users.findMany({
					orderBy: { id: 'asc' },
					where: { groups: { some: { name: 'Group 3' } } },
				});
				expect(ids(inGroup3)).toEqual(userIdsInGroup(3));

				const everyLow = await db.users.count({
					where: { groups: { every: { id: { lte: 4 } } } },
				});
				expect(everyLow).toBe(
					SEED.users.filter((user) =>
						groupIdsOf(user.id).every((id) => id <= 4),
					).length,
				);

				const noneGroup1 = await db.users.count({
					where: { groups: { none: { id: 1 } } },
				});
				expect(noneGroup1).toBe(USER_COUNT - userIdsInGroup(1).length);

				const groupsWithInactive = await db.groups.findMany({
					orderBy: { id: 'asc' },
					where: {
						users: { some: { active: false, id: { lte: 12 } } },
					},
				});
				expect(ids(groupsWithInactive)).toEqual(
					SEED.groups
						.filter((group) =>
							userIdsInGroup(group.id).some(
								(id) => id <= 12 && !seedUser(id).active,
							),
						)
						.map((group) => group.id),
				);

				const tagsOnHighScore = await db.tags.findMany({
					orderBy: { id: 'asc' },
					where: { posts: { some: { score: { gte: 97 } } } },
				});
				expect(ids(tagsOnHighScore)).toEqual(
					SEED.tags
						.filter((tag) =>
							SEED.postTags.some(
								(link) =>
									link.tagId === tag.id &&
									seedPost(link.postId).score >= 97,
							),
						)
						.map((tag) => tag.id),
				);
			});

			test('relation filters nested two levels', async () => {
				const rows = await db.users.findMany({
					orderBy: { id: 'asc' },
					where: {
						posts: {
							some: {
								comments: { some: { likes: { gte: 18 } } },
							},
						},
					},
				});
				expect(ids(rows)).toEqual(
					SEED.users
						.filter((user) =>
							postsOf(user.id).some((post) =>
								commentsOf(post.id).some(
									(comment) => comment.likes >= 18,
								),
							),
						)
						.map((user) => user.id),
				);

				const posts = await db.posts.findMany({
					orderBy: { id: 'asc' },
					where: { author: { is: { groups: { some: { id: 1 } } } } },
				});
				const group1 = new Set(userIdsInGroup(1));
				expect(ids(posts)).toEqual(
					SEED.posts
						.filter((post) => group1.has(post.authorId))
						.map((post) => post.id),
				);
			});

			test('self relation filters (membership path) and self _count', async () => {
				const children = await db.categories.findMany({
					orderBy: { id: 'asc' },
					where: { parent: { is: { name: 'Cat 1' } } },
				});
				expect(ids(children)).toEqual([4, 7]);

				const counted = await db.categories.findMany({
					include: { _count: { select: { children: true } } },
					orderBy: { id: 'asc' },
				});
				expect(counted.map((row) => row._count.children)).toEqual(
					SEED.categories.map(
						(category) =>
							SEED.categories.filter(
								(child) => child.parentId === category.id,
							).length,
					),
				);
			});

			test('self relation EXISTS filters (some/none, is null/isNot null, self many-to-many)', async () => {
				const followedBy1 = await db.users.findMany({
					orderBy: { id: 'asc' },
					where: { followers: { some: { id: 1 } } },
				});
				expect(ids(followedBy1)).toEqual(followingOf(1));
				expect(
					await db.users.count({
						where: { following: { none: {} } },
					}),
				).toBe(USER_COUNT - 60);
				const parents = await db.categories.findMany({
					orderBy: { id: 'asc' },
					where: { children: { some: {} } },
				});
				expect(ids(parents)).toEqual([1, 2, 3, 4]);
				const leaves = await db.categories.findMany({
					orderBy: { id: 'asc' },
					where: { children: { none: {} } },
				});
				expect(ids(leaves)).toEqual([5, 6, 7, 8, 9, 10]);
				const roots = await db.categories.findMany({
					orderBy: { id: 'asc' },
					where: { parent: { is: null } },
				});
				expect(ids(roots)).toEqual([1, 2, 3]);
				expect(
					await db.categories.count({
						where: { parent: { isNot: null } },
					}),
				).toBe(7);
			});
		});

		describe('parity with raw Drizzle core queries', () => {
			test('many relation matches a core select', async () => {
				const { posts } = ctx.schema;
				const rawPosts = await ctx.raw
					.select()
					.from(posts)
					.where(eq(posts.authorId, 5))
					.orderBy(asc(posts.id));
				const user = await db.users.findFirst({
					include: { posts: { orderBy: { id: 'asc' } } },
					where: { id: 5 },
				});
				expect(user?.posts).toEqual(rawPosts);
			});

			test('many-to-many matches a core join', async () => {
				const { groups, memberships } = ctx.schema;
				const rawGroups = await ctx.raw
					.select({ id: groups.id, name: groups.name })
					.from(groups)
					.innerJoin(memberships, eq(memberships.groupId, groups.id))
					.where(eq(memberships.userId, 7))
					.orderBy(asc(groups.id));
				const user = await db.users.findFirst({
					include: { groups: { orderBy: { id: 'asc' } } },
					where: { id: 7 },
				});
				expect(user?.groups).toEqual(rawGroups);
			});

			test('self many-to-many and filtered counts match core queries', async () => {
				const { follows, posts, users } = ctx.schema;
				const rawFollowing = await ctx.raw
					.select({ user: users })
					.from(users)
					.innerJoin(follows, eq(follows.followingId, users.id))
					.where(eq(follows.followerId, 11))
					.orderBy(asc(users.id));
				const user = await db.users.findFirst({
					include: { following: { orderBy: { id: 'asc' } } },
					where: { id: 11 },
				});
				expect(user?.following).toEqual(
					rawFollowing.map((row) => row.user),
				);

				const [rawCount] = await ctx.raw
					.select({ value: count() })
					.from(posts)
					.where(
						and(
							eq(posts.published, true),
							inArray(posts.authorId, [1, 2, 3, 4, 5]),
						),
					);
				expect(
					await db.posts.count({
						where: {
							authorId: { in: [1, 2, 3, 4, 5] },
							published: true,
						},
					}),
				).toBe(Number(rawCount?.value));
			});
		});

		describe('writes', () => {
			test('create returns and persists the row', async () => {
				const created = await db.users.create({
					data: newUserFor(500),
				});
				expect(created).toEqual(newUserFor(500));
				expect(
					await db.users.findUnique({ where: { id: 500 } }),
				).toEqual(newUserFor(500));
			});

			test('create skipDuplicates (true and column list)', async () => {
				const duplicate = {
					...newUserFor(501),
					email: 'user1@matrix.test',
				};
				expect(
					await db.users.create({
						data: duplicate,
						skipDuplicates: true,
					}),
				).toBeNull();
				expect(
					await db.users.create({
						data: duplicate,
						skipDuplicates: ['email'],
					}),
				).toBeNull();
				expect(
					await db.users.create({
						data: newUserFor(502),
						skipDuplicates: true,
					}),
				).toEqual(newUserFor(502));
				expect(await db.users.count()).toBe(USER_COUNT + 1);
			});

			test('createMany with and without skipDuplicates', async () => {
				const plain = await db.users.createMany({
					data: [newUserFor(510), newUserFor(511)],
				});
				expect(plain.count).toBe(2);

				const skipped = await db.users.createMany({
					data: [
						newUserFor(512),
						{ ...newUserFor(513), email: 'user2@matrix.test' },
						newUserFor(514),
					],
					skipDuplicates: true,
				});
				expect(skipped.count).toBe(2);

				const targeted = await db.users.createMany({
					data: [
						{ ...newUserFor(515), email: 'user3@matrix.test' },
						newUserFor(516),
					],
					skipDuplicates: ['email'],
				});
				expect(targeted.count).toBe(1);
				expect(
					sortedIds(
						await db.users.findMany({
							where: { id: { gte: 500 } },
						}),
					),
				).toEqual([510, 511, 512, 514, 516]);
			});

			test('update, updateMany and atomic updates', async () => {
				const updated = await db.users.update({
					data: { name: 'Renamed', nickname: null },
					where: { id: 2 },
				});
				expect(updated).toEqual({
					...seedUser(2),
					name: 'Renamed',
					nickname: null,
				});
				expect(
					await db.users.update({
						data: { name: 'x' },
						where: { id: 9999 },
					}),
				).toBeNull();

				const many = await db.posts.updateMany({
					data: { published: false },
					where: { authorId: 1 },
				});
				expect(many.count).toBe(3);
				expect(
					await db.posts.count({
						where: { authorId: 1, published: true },
					}),
				).toBe(0);

				const bumped = await db.posts.update({
					data: { score: { increment: 5 } },
					where: { id: 10 },
				});
				expect(bumped?.score).toBe(seedPost(10).score + 5);
				const toggled = await db.users.update({
					data: { active: { toggle: true }, age: { decrement: 1 } },
					where: { id: 3 },
				});
				expect(toggled?.active).toBe(!seedUser(3).active);
				expect(toggled?.age).toBe(seedUser(3).age - 1);

				const bulk = await db.comments.updateMany({
					data: { likes: { increment: 100 } },
					where: { postId: 1 },
				});
				expect(bulk.count).toBe(commentsOf(1).length);
				expect(
					(await db.comments.findMany({ where: { postId: 1 } })).map(
						(comment) => comment.likes,
					),
				).toEqual(commentsOf(1).map((comment) => comment.likes + 100));
			});

			test('updateEach applies distinct values per row', async () => {
				const result = await db.posts.updateEach({
					by: ctx.schema.posts.id,
					data: [
						{ id: 1, score: 901, title: 'Each 1' },
						{ id: 2, score: 902, title: 'Each 2' },
						{ id: 3, score: 903, title: 'Each 3' },
					],
					select: { id: true, score: true, title: true },
					update: {
						score: (row) => row.score,
						title: (row) => row.title,
					},
				});
				expect(result.count).toBe(3);
				expect([...result.data].sort((a, b) => a.id - b.id)).toEqual([
					{ id: 1, score: 901, title: 'Each 1' },
					{ id: 2, score: 902, title: 'Each 2' },
					{ id: 3, score: 903, title: 'Each 3' },
				]);
				expect(
					(
						await db.posts.findMany({
							orderBy: { id: 'asc' },
							where: { id: { in: [1, 2, 3, 4] } },
						})
					).map((post) => post.score),
				).toEqual([901, 902, 903, seedPost(4).score]);
			});

			test('delete and deleteMany', async () => {
				const deleted = await db.comments.delete({ where: { id: 1 } });
				expect(deleted).toEqual(SEED.comments[0] as never);
				expect(
					await db.comments.delete({ where: { id: 1 } }),
				).toBeNull();

				const many = await db.comments.deleteMany({
					where: { likes: { gte: 15 } },
				});
				expect(many.count).toBe(
					SEED.comments.filter(
						(comment) => comment.id !== 1 && comment.likes >= 15,
					).length,
				);
				expect(await db.comments.count()).toBe(
					SEED.comments.length - 1 - many.count,
				);
			});

			test('upsert create and update branches', async () => {
				const created = await db.users.upsert({
					create: newUserFor(520),
					update: { name: 'unused' },
					where: { email: 'new520@matrix.test' },
				});
				expect(created).toEqual(newUserFor(520));

				const updated = await db.users.upsert({
					create: { ...newUserFor(521), email: 'user4@matrix.test' },
					update: { name: 'Upserted', age: { increment: 1 } },
					where: { email: 'user4@matrix.test' },
				});
				expect(updated).toEqual({
					...seedUser(4),
					age: seedUser(4).age + 1,
					name: 'Upserted',
				});
				expect(await db.users.count()).toBe(USER_COUNT + 1);
			});

			test('upsertMany mixes inserts and conflict updates', async () => {
				const result = await db.users.upsertMany({
					data: [
						{ ...seedUser(1), age: 99, name: 'Upsert 1' },
						{ ...seedUser(2), age: 98, name: 'Upsert 2' },
						newUserFor(530),
					],
					select: { age: true, id: true, name: true },
					target: 'email',
					update: ['name', 'age'],
				});
				expect(result.count).toBe(3);
				expect([...result.data].sort((a, b) => a.id - b.id)).toEqual([
					{ age: 99, id: 1, name: 'Upsert 1' },
					{ age: 98, id: 2, name: 'Upsert 2' },
					{ age: 33, id: 530, name: 'New 530' },
				]);
				expect(await db.users.count()).toBe(USER_COUNT + 1);
			});
		});

		describe('relation writes', () => {
			test('create connects one (owned), nullable one and many-to-many', async () => {
				const post = await db.posts.create({
					data: {
						author: { connect: { email: 'user7@matrix.test' } },
						category: { connect: { id: 2 } },
						editor: { connect: { id: 8 } },
						id: 1000,
						published: true,
						score: 1,
						tags: { connect: [{ name: 'tag-1' }, { id: 2 }] },
						title: 'Connected',
					},
					include: {
						author: true,
						editor: true,
						tags: { orderBy: { id: 'asc' } },
					},
				});
				expect(post.authorId).toBe(7);
				expect(post.editorId).toBe(8);
				expect(post.categoryId).toBe(2);
				expect(post.author).toEqual(seedUser(7));
				expect(post.editor).toEqual(seedUser(8));
				expect(ids(post.tags)).toEqual([1, 2]);
			});

			test('update connect / disconnect / set on an owned nullable one', async () => {
				const connected = await db.posts.update({
					data: { editor: { connect: { id: 50 } } },
					where: { id: 1 },
				});
				expect(connected?.editorId).toBe(50);
				const disconnected = await db.posts.update({
					data: { editor: { disconnect: true } },
					where: { id: 1 },
				});
				expect(disconnected?.editorId).toBeNull();
				const set = await db.posts.update({
					data: { editor: { set: { email: 'user9@matrix.test' } } },
					where: { id: 1 },
				});
				expect(set?.editorId).toBe(9);
				const cleared = await db.posts.update({
					data: { editor: { set: null } },
					where: { id: 1 },
				});
				expect(cleared?.editorId).toBeNull();
			});

			test('required one cannot be disconnected and rolls back scalars', async () => {
				await expect(
					db.posts.update({
						data: {
							author: { disconnect: true },
							title: 'should rollback',
						},
						where: { id: 1 },
					}),
				).rejects.toThrow('Cannot disconnect required relation');
				expect(
					(await db.posts.findUnique({ where: { id: 1 } }))?.title,
				).toBe('Post 1');
			});

			test('many connect / disconnect / set (nullable FK on target)', async () => {
				const reparented = await db.users.update({
					data: { posts: { connect: [{ id: 1 }, { id: 2 }] } },
					include: { posts: { orderBy: { id: 'asc' } } },
					where: { id: 110 },
				});
				expect(ids(reparented?.posts ?? [])).toEqual([1, 2]);

				const originalEdited = SEED.posts
					.filter((post) => post.editorId === 5)
					.map((post) => post.id);
				expect(originalEdited.length).toBeGreaterThan(0);
				await db.users.update({
					data: { editedPosts: { set: [{ id: 1 }, { id: 4 }] } },
					where: { id: 5 },
				});
				expect(
					sortedIds(
						await db.posts.findMany({ where: { editorId: 5 } }),
					),
				).toEqual([1, 4]);
				for (const id of originalEdited)
					if (id !== 1 && id !== 4)
						expect(
							(await db.posts.findUnique({ where: { id } }))
								?.editorId,
						).toBeNull();

				await db.users.update({
					data: { editedPosts: { disconnect: { id: 4 } } },
					where: { id: 5 },
				});
				expect(
					sortedIds(
						await db.posts.findMany({ where: { editorId: 5 } }),
					),
				).toEqual([1]);
			});

			test('many-to-many connect / disconnect / set in both directions', async () => {
				const { memberships } = ctx.schema;
				const groupsOf = async (userId: number) =>
					(
						await ctx.raw
							.select({ groupId: memberships.groupId })
							.from(memberships)
							.where(eq(memberships.userId, userId))
					)
						.map((row) => row.groupId)
						.sort(byNumber);

				await db.users.update({
					data: { groups: { connect: [{ id: 1 }, { id: 8 }] } },
					where: { id: 110 },
				});
				expect(await groupsOf(110)).toEqual([1, 8]);
				// Connecting an already linked target is idempotent.
				await db.users.update({
					data: { groups: { connect: { id: 1 } } },
					where: { id: 110 },
				});
				expect(await groupsOf(110)).toEqual([1, 8]);

				await db.users.update({
					data: { groups: { disconnect: { id: 1 } } },
					where: { id: 110 },
				});
				expect(await groupsOf(110)).toEqual([8]);

				await db.users.update({
					data: { groups: { set: [{ name: 'Group 2' }, { id: 3 }] } },
					where: { id: 110 },
				});
				expect(await groupsOf(110)).toEqual([2, 3]);

				await db.groups.update({
					data: { users: { connect: { id: 111 } } },
					where: { id: 5 },
				});
				expect(await groupsOf(111)).toEqual([5]);

				await db.posts.update({
					data: { tags: { set: [{ id: 12 }] } },
					where: { id: 1 },
				});
				expect(
					ids(
						(
							await db.posts.findFirst({
								include: { tags: true },
								where: { id: 1 },
							})
						)?.tags ?? [],
					),
				).toEqual([12]);
			});

			test('self many-to-many connect and disconnect', async () => {
				await db.users.update({
					data: {
						following: { connect: [{ id: 100 }, { id: 101 }] },
					},
					where: { id: 90 },
				});
				const user = await db.users.findFirst({
					include: { following: { orderBy: { id: 'asc' } } },
					where: { id: 90 },
				});
				expect(ids(user?.following ?? [])).toEqual([100, 101]);
				const followed = await db.users.findFirst({
					include: { followers: true },
					where: { id: 101 },
				});
				expect(sortedIds(followed?.followers ?? [])).toEqual(
					[...followersOf(101), 90].sort(byNumber),
				);
				await db.users.update({
					data: { followers: { disconnect: { id: 90 } } },
					where: { id: 101 },
				});
				const { follows } = ctx.schema;
				expect(
					await ctx.raw
						.select()
						.from(follows)
						.where(eq(follows.followerId, 90))
						.orderBy(asc(follows.followingId)),
				).toEqual([{ followerId: 90, followingId: 100 }]);
			});

			test('one-to-one with FK on target: connect and set null', async () => {
				const connected = await db.users.update({
					data: { profile: { connect: { id: FREE_PROFILE_IDS[0] } } },
					include: { profile: true },
					where: { id: 2 },
				});
				expect(connected?.profile).toEqual({
					bio: `Free ${FREE_PROFILE_IDS[0]}`,
					id: FREE_PROFILE_IDS[0],
					userId: 2,
				});

				const cleared = await db.users.update({
					data: { profile: { set: null } },
					include: { profile: true },
					where: { id: 1 },
				});
				expect(cleared?.profile).toBeNull();
				expect(
					(await db.profiles.findUnique({ where: { id: 1 } }))
						?.userId,
				).toBeNull();

				const created = await db.users.create({
					data: {
						...newUserFor(600),
						profile: { connect: { id: FREE_PROFILE_IDS[1] } },
					},
					include: { profile: true },
				});
				expect(created.profile?.id).toBe(FREE_PROFILE_IDS[1]);
			});

			test('one-to-one with FK on target: disconnect: true', async () => {
				const result = await db.users.update({
					data: { profile: { disconnect: true } },
					include: { profile: true },
					where: { id: 1 },
				});
				expect(result?.profile).toBeNull();
				expect(
					(await db.profiles.findUnique({ where: { id: 1 } }))
						?.userId,
				).toBeNull();
			});

			test('one-to-one with FK on target: connect replaces the existing target', async () => {
				const result = await db.users.update({
					data: { profile: { connect: { id: FREE_PROFILE_IDS[2] } } },
					include: { profile: true },
					where: { id: 1 },
				});
				expect(result?.profile?.id).toBe(FREE_PROFILE_IDS[2]);
				expect(
					(await db.profiles.findUnique({ where: { id: 1 } }))
						?.userId,
				).toBeNull();
			});

			test('failed relation selector rolls back the whole update', async () => {
				await expect(
					db.users.update({
						data: {
							groups: { connect: { id: 999 } },
							name: 'nope',
						},
						where: { id: 1 },
					}),
				).rejects.toThrow('Relation selector did not match a record.');
				expect(
					(await db.users.findUnique({ where: { id: 1 } }))?.name,
				).toBe('User 001');
				expect(
					sortedIds(
						(
							await db.users.findFirst({
								include: { groups: true },
								where: { id: 1 },
							})
						)?.groups ?? [],
					),
				).toEqual(groupIdsOf(1));
			});
		});

		describe('transactions', () => {
			test('commit persists and returns the callback value', async () => {
				const value = await db.transaction(async (tx) => {
					await tx.users.create({ data: newUserFor(700) });
					await tx.users.update({
						data: { name: 'In tx' },
						where: { id: 1 },
					});
					return tx.users.count();
				});
				expect(value).toBe(USER_COUNT + 1);
				expect(await db.users.count()).toBe(USER_COUNT + 1);
				expect(
					(await db.users.findUnique({ where: { id: 1 } }))?.name,
				).toBe('In tx');
			});

			test('throw and tx.rollback() roll back', async () => {
				await expect(
					db.transaction(async (tx) => {
						await tx.users.create({ data: newUserFor(701) });
						throw new Error('boom');
					}),
				).rejects.toThrow('boom');
				await expect(
					db.transaction(async (tx) => {
						await tx.users.create({ data: newUserFor(702) });
						tx.rollback();
					}),
				).rejects.toBeInstanceOf(BetterDrizzleTransactionRollbackError);
				expect(await db.users.count()).toBe(USER_COUNT);
			});

			test('nested savepoint rollback keeps the outer transaction', async () => {
				await db.transaction(async (tx) => {
					await tx.users.create({ data: newUserFor(710) });
					await expect(
						tx.transaction(async (inner) => {
							await inner.users.create({ data: newUserFor(711) });
							inner.rollback('inner');
						}),
					).rejects.toBeInstanceOf(
						BetterDrizzleTransactionRollbackError,
					);
					await tx.transaction(async (inner) => {
						await inner.users.create({ data: newUserFor(712) });
					});
				});
				expect(
					sortedIds(
						await db.users.findMany({
							where: { id: { gte: 700 } },
						}),
					),
				).toEqual([710, 712]);
			});

			test('afterCommit / afterRollback callbacks', async () => {
				const calls: string[] = [];
				await db.transaction(async (tx) => {
					tx.afterCommit(() => {
						calls.push('commit');
					});
					tx.afterRollback(() => {
						calls.push('rollback-1');
					});
					await tx.users.create({ data: newUserFor(720) });
					expect(calls).toEqual([]);
				});
				expect(calls).toEqual(['commit']);

				await expect(
					db.transaction(async (tx) => {
						tx.afterCommit(() => {
							calls.push('commit-2');
						});
						tx.afterRollback(() => {
							calls.push('rollback');
						});
						throw new Error('fail');
					}),
				).rejects.toThrow('fail');
				expect(calls).toEqual(['commit', 'rollback']);
			});

			test('relation reads inside a transaction see uncommitted writes', async () => {
				await db
					.transaction(async (tx) => {
						await tx.users.update({
							data: { groups: { set: [{ id: 4 }] } },
							where: { id: 1 },
						});
						const user = await tx.users.findFirst({
							include: { groups: true },
							where: { id: 1 },
						});
						expect(ids(user?.groups ?? [])).toEqual([4]);
						tx.rollback();
					})
					.catch(() => {});
				const user = await db.users.findFirst({
					include: { groups: { orderBy: { id: 'asc' } } },
					where: { id: 1 },
				});
				expect(ids(user?.groups ?? [])).toEqual(groupIdsOf(1));
			});
		});

		describe('hooks, context and laziness', () => {
			test('$withContext meta reaches query and mutation hooks', async () => {
				const seen: unknown[] = [];
				const client = ctx.make({
					hooks: {
						beforeCreate(hook) {
							seen.push(['create', hook.meta]);
						},
						beforeQuery(hook) {
							seen.push(['query', hook.action, hook.meta]);
						},
					},
				});
				const scoped = client.$withContext({
					requestId: 'r1',
					tenant: 't1',
				});
				await scoped.users.findMany({ take: 1 });
				await scoped.users.create({
					data: newUserFor(800),
					meta: { requestId: 'r2' },
				});
				await scoped.posts.findFirst({
					include: { author: true },
					where: { id: 1 },
				});
				expect(seen).toEqual([
					['query', 'findMany', { requestId: 'r1', tenant: 't1' }],
					['create', { requestId: 'r2', tenant: 't1' }],
					['query', 'findFirst', { requestId: 'r1', tenant: 't1' }],
				]);
			});

			test('.explain() without awaiting the read does not run hooks', async () => {
				let calls = 0;
				const client = ctx.make({
					hooks: {
						beforeQuery() {
							calls += 1;
						},
					},
				});
				const plan = await client.users
					.findMany({
						include: {
							groups: true,
							posts: { include: { comments: true } },
						},
						where: { active: true },
					})
					.explain();
				expect(calls).toBe(0);
				expect(plan.driver).toBe(ctx.dialect);
				expect(plan.operation).toBe('findMany');
				expect(
					plan.statements.map((statement) => statement.key),
				).toEqual(['data']);
				expect(
					plan.deferredRelations
						.map((relation) => relation.path)
						.sort(),
				).toEqual(['groups', 'posts', 'posts.comments']);

				const countPlan = await client.users
					.count({ where: { posts: { some: {} } } })
					.explain();
				expect(
					countPlan.statements.map((statement) => statement.key),
				).toEqual(['count']);
				expect(calls).toBe(0);
			});

			test('reads are lazy and an awaited read runs once', async () => {
				let calls = 0;
				const client = ctx.make({
					hooks: {
						beforeQuery() {
							calls += 1;
						},
					},
				});
				const pending = client.users.findMany({
					include: { posts: true },
					where: { id: 1 },
				});
				await new Promise((resolve) => setTimeout(resolve, 5));
				expect(calls).toBe(0);
				const first = await pending;
				const second = await pending;
				expect(calls).toBe(1);
				expect(second).toBe(first);
				expect(ids(first[0]?.posts ?? [])).toEqual(ids(postsOf(1)));
			});
		});

		describe('errors', () => {
			test('isUniqueViolation detects the raw thrown Drizzle error', async () => {
				let error: unknown;
				try {
					await ctx.raw.insert(ctx.schema.users).values({
						...newUserFor(900),
						email: 'user1@matrix.test',
					});
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).cause).toBeDefined();
				expect(isUniqueViolation(error)).toBe(true);
				expect(isForeignKeyViolation(error)).toBe(false);

				let fkError: unknown;
				try {
					await ctx.raw.insert(ctx.schema.posts).values({
						authorId: 9999,
						editorId: null,
						categoryId: null,
						id: 5000,
						published: true,
						score: 1,
						title: 'orphan',
					});
				} catch (caught) {
					fkError = caught;
				}
				expect(isForeignKeyViolation(fkError)).toBe(true);
				expect(isUniqueViolation(fkError)).toBe(false);
			});

			test('isUniqueViolation detects errors thrown by delegates', async () => {
				let error: unknown;
				try {
					await db.users.create({
						data: {
							...newUserFor(901),
							email: 'user1@matrix.test',
						},
					});
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeDefined();
				expect(isUniqueViolation(error)).toBe(true);
			});

			test('unsupported relations fail instead of being ignored', async () => {
				await expect(
					read(
						db.users.findMany({
							include: { publishedPosts: true },
						}),
					),
				).rejects.toThrow('cannot be loaded');
				await expect(
					read(
						db.users.findMany({
							where: { publishedPosts: { some: {} } },
						}),
					),
				).rejects.toThrow('cannot be filtered');
				await expect(
					read(db.posts.findMany({ include: { firstTag: true } })),
				).rejects.toThrow('cannot be loaded');
				// Supported relations on the same tables keep working.
				expect(
					await db.posts.count({ where: { tags: { some: {} } } }),
				).toBe(new Set(SEED.postTags.map((link) => link.postId)).size);
			});

			test('drizzle() without relations is rejected at bootstrap', () => {
				expect(() =>
					better(ctx.rawWithoutRelations() as never),
				).toThrow('No tables found on the Drizzle instance');
			});
		});
	});
};

const newUserFor = (id: number) => ({
	active: true,
	age: 33,
	createdAt: new Date(Date.UTC(2025, 5, 1)),
	email: `new${id}@matrix.test`,
	id,
	name: `New ${id}`,
	nickname: null,
});
