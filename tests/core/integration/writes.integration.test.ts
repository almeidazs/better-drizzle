import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
	createMassiveContext,
	ENTRY_COUNT,
	entries,
	type MassiveContext,
	POSTS_PER_USER,
	USER_COUNT,
} from './setup';

let ctx: MassiveContext;

beforeEach(() => {
	ctx = createMassiveContext();
});

afterEach(() => {
	ctx.close();
});

describe('massive sqlite writes', () => {
	test('creates one row with scalar select and persists it', async () => {
		const created = await ctx.client.entries.create({
			data: {
				id: ENTRY_COUNT + 1,
				payload: 'Created payload',
				token: 'created-token',
				value: 777,
			},
			select: { id: true, token: true },
		});
		const persisted = await ctx.client.entries.findFirst({
			where: { id: ENTRY_COUNT + 1 },
		});

		expect(created).toEqual({
			id: ENTRY_COUNT + 1,
			token: 'created-token',
		});
		expect(persisted?.payload).toBe('Created payload');
	});

	test('creates a large batch and returns every inserted row', async () => {
		const data = Array.from({ length: 250 }, (_, index) => ({
			id: ENTRY_COUNT + index + 1,
			payload: `Batch payload ${index}`,
			token: `batch-token-${index}`,
			value: index,
		}));
		const result = await ctx.client.entries.createMany({ data });

		expect(result.count).toBe(250);
		expect(result.data).toHaveLength(250);
		expect(await ctx.client.entries.count()).toBe(ENTRY_COUNT + 250);
	});

	test('skips duplicate inserts and reports only real changes', async () => {
		const one = await ctx.client.entries.create({
			data: {
				id: ENTRY_COUNT + 1,
				payload: 'Duplicate',
				token: 'token-1',
				value: 1,
			},
			skipDuplicates: true,
		});
		const many = await ctx.client.entries.createMany({
			data: [
				{
					id: ENTRY_COUNT + 2,
					payload: 'Duplicate',
					token: 'token-2',
					value: 2,
				},
				{
					id: ENTRY_COUNT + 3,
					payload: 'Inserted',
					token: 'new-token',
					value: 3,
				},
			],
			skipDuplicates: true,
		});

		expect(one).toBeNull();
		expect(many.count).toBe(1);
		expect(many.data.map((row) => row.token)).toEqual(['new-token']);
	});

	test('updates one row, projects it and supports throw', async () => {
		const updated = await ctx.client.entries
			.update({
				data: { payload: 'Updated once', value: 991 },
				select: { id: true, payload: true, value: true },
				where: { token: 'token-177' },
			})
			.throw();

		expect(updated).toEqual({
			id: 177,
			payload: 'Updated once',
			value: 991,
		});
		expect(
			await ctx.client.entries.findFirst({ where: { id: 177 } }),
		).toMatchObject({ payload: 'Updated once', value: 991 });
	});

	test('updates many rows and verifies every persisted value', async () => {
		const result = await ctx.client.entries.updateMany({
			data: { payload: 'Bulk changed' },
			where: { id: { gte: 101, lte: 250 } },
		});
		const persisted = await ctx.client.entries.findMany({
			where: { payload: 'Bulk changed' },
		});

		expect(result.count).toBe(150);
		expect(persisted).toHaveLength(150);
	});

	test('updates each row with distinct values in one operation', async () => {
		const data = Array.from({ length: 120 }, (_, index) => ({
			id: index + 1,
			payload: `Distinct ${index + 1}`,
			value: 10_000 + index,
		}));
		const result = await ctx.client.entries.updateEach({
			by: entries.id,
			data,
			select: { id: true, payload: true, value: true },
			update: {
				payload: (row) => row.payload,
				value: (row) => row.value,
			},
		});

		expect(result.count).toBe(120);
		expect(result.data).toHaveLength(120);
		expect(result.data[119]).toEqual({
			id: 120,
			payload: 'Distinct 120',
			value: 10_119,
		});
	});

	test('upserts both create and update branches', async () => {
		const created = await ctx.client.entries.upsert({
			create: {
				id: ENTRY_COUNT + 1,
				payload: 'Created by upsert',
				token: 'upsert-new',
				value: 1,
			},
			update: { payload: 'Unused' },
			where: { token: 'upsert-new' },
		});
		const updated = await ctx.client.entries.upsert({
			create: {
				id: ENTRY_COUNT + 2,
				payload: 'Unused',
				token: 'token-10',
				value: 2,
			},
			update: { payload: 'Updated by upsert', value: 44 },
			where: { token: 'token-10' },
		});

		expect(created.payload).toBe('Created by upsert');
		expect(updated).toMatchObject({
			id: 10,
			payload: 'Updated by upsert',
			value: 44,
		});
	});

	test('upserts a large mixed batch using native conflicts', async () => {
		const result = await ctx.client.entries.upsertMany({
			data: Array.from({ length: 200 }, (_, index) => {
				const existing = index < 100;
				const id = existing ? index + 1 : ENTRY_COUNT + index + 1;
				return {
					id,
					payload: `Upsert batch ${id}`,
					token: existing ? `token-${id}` : `upsert-batch-${id}`,
					value: 20_000 + index,
				};
			}),
			select: { id: true, payload: true },
			target: 'token',
			update: ['payload', 'value'],
		});

		expect(result.count).toBe(200);
		expect(result.data).toHaveLength(200);
		expect(await ctx.client.entries.count()).toBe(ENTRY_COUNT + 100);
	});

	test('deletes one and many rows and verifies absence', async () => {
		const deleted = await ctx.client.entries.delete({ where: { id: 1 } });
		const many = await ctx.client.entries.deleteMany({
			where: { id: { gte: 2, lte: 101 } },
		});

		expect(deleted?.id).toBe(1);
		expect(many.count).toBe(100);
		expect(await ctx.client.entries.count()).toBe(ENTRY_COUNT - 101);
	});
});

describe('massive sqlite relation writes', () => {
	test('creates a required to-one relation through connect', async () => {
		const post = await ctx.client.posts.create({
			data: {
				author: { connect: { email: 'user-200@example.com' } },
				body: 'Connected body',
				id: USER_COUNT * POSTS_PER_USER + 1,
				published: true,
				score: 999,
				title: 'Connected title',
			},
			include: { author: true },
		});

		expect(post.userId).toBe(200);
		expect(post.author.email).toBe('user-200@example.com');
	});

	test('reconnects a to-one relation and reparents many children', async () => {
		const post = await ctx.client.posts.update({
			data: { author: { connect: { id: 200 } } },
			where: { id: 1 },
		});
		const user = await ctx.client.users.update({
			data: { posts: { connect: [{ id: 5 }, { id: 6 }] } },
			include: { posts: { orderBy: { id: 'asc' } } },
			where: { id: 1 },
		});

		expect(post?.userId).toBe(200);
		expect(user?.posts.map((row) => row.id)).toEqual([2, 3, 4, 5, 6]);
	});

	test('connects, disconnects and sets an optional one relation', async () => {
		await ctx.client.users.update({
			data: { profile: { disconnect: { id: 1 } } },
			where: { id: 1 },
		});
		let user = await ctx.client.users.findFirst({
			include: { profile: true },
			where: { id: 1 },
		});
		expect(user?.profile).toBeNull();

		await ctx.client.users.update({
			data: { profile: { connect: { id: 1 } } },
			where: { id: USER_COUNT },
		});
		user = await ctx.client.users.findFirst({
			include: { profile: true },
			where: { id: USER_COUNT },
		});
		expect(user?.profile?.id).toBe(1);

		await ctx.client.users.update({
			data: { profile: { set: null } },
			where: { id: USER_COUNT },
		});
		expect(
			(
				await ctx.client.users.findFirst({
					include: { profile: true },
					where: { id: USER_COUNT },
				})
			)?.profile,
		).toBeNull();
	});

	test('connects, disconnects and replaces many-to-many rows', async () => {
		await ctx.client.users.update({
			data: { groups: { connect: [{ id: 2 }, { id: 3 }, { id: 4 }] } },
			where: { id: 1 },
		});
		await ctx.client.users.update({
			data: { groups: { disconnect: { id: 2 } } },
			where: { id: 1 },
		});
		await ctx.client.users.update({
			data: { groups: { set: [{ id: 7 }, { id: 8 }] } },
			where: { id: 1 },
		});
		const user = await ctx.client.users.findFirst({
			include: { groups: { orderBy: { id: 'asc' } } },
			where: { id: 1 },
		});

		expect(user?.groups.map((group) => group.id)).toEqual([7, 8]);
	});

	test('rolls back scalar and relation changes together', async () => {
		await expect(
			ctx.client.users.update({
				data: {
					name: 'Must roll back',
					posts: { disconnect: { id: 1 } },
				},
				where: { id: 1 },
			}),
		).rejects.toThrow('Cannot disconnect required relation');
		const user = await ctx.client.users.findFirst({
			include: { posts: true },
			where: { id: 1 },
		});

		expect(user?.name).toBe('User 1');
		expect(user?.posts).toHaveLength(POSTS_PER_USER);
	});

	test('rejects zero-match, multi-match and invalid relation commands', async () => {
		await expect(
			ctx.client.posts.update({
				data: { author: { connect: { id: USER_COUNT + 1 } } },
				where: { id: 1 },
			}),
		).rejects.toThrow('did not match a record');
		await expect(
			ctx.client.posts.update({
				data: { author: { connect: { active: true } } },
				where: { id: 1 },
			}),
		).rejects.toThrow('more than one record');
		await expect(
			ctx.client.users.update({
				data: {
					groups: {
						connect: { id: 1 },
						set: [{ id: 2 }],
					} as never,
				},
				where: { id: 1 },
			}),
		).rejects.toThrow('set cannot be combined');
	});
});
