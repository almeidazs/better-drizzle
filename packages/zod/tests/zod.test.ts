import { describe, expect, test } from 'bun:test';
import { better } from 'better-drizzle';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { createTestContext } from '../../../packages/core/tests/setup';
import { zod as betterZod } from '../src';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

type Expect<T extends true> = T;

const createZodContext = () => {
	const base = createTestContext();
	const client = better(base.raw, {
		plugins: [
			betterZod({
				behavior: {
					coerce: true,
					unknownKeys: 'strip',
				},
				schemas: {
					users: {
						create: {
							extend: {
								password: z.string().min(8),
							},
							omit: ['id'],
						},
						fields: {
							email: (schema) =>
								(schema as z.ZodString)
									.email()
									.transform((value) => value.toLowerCase()),
							name: (schema) => (schema as z.ZodString).min(2),
						},
						select: {
							omit: ['email'],
						},
						update: {
							omit: ['id'],
							partial: true,
						},
					},
				},
				validate: {
					count: true,
					create: true,
					createMany: true,
					cursor: true,
					delete: true,
					deleteMany: true,
					exists: true,
					findFirst: true,
					findMany: true,
					findOne: true,
					findUnique: true,
					paginate: true,
					query: true,
					result: true,
					update: true,
					updateEach: true,
					updateMany: true,
					upsert: true,
					upsertMany: true,
				},
			}),
		],
		schema: base.schema,
	});

	return {
		...base,
		client,
	};
};

describe('@better-drizzle/zod - typing', () => {
	test('exposes typed $zod schemas on delegates', () => {
		const ctx = createZodContext();

		type Schemas = typeof ctx.client.users.$zod;
		type _keys = Expect<
			Equal<
				keyof Schemas,
				| 'create'
				| 'orderBy'
				| 'pagination'
				| 'query'
				| 'select'
				| 'update'
				| 'upsert'
				| 'where'
			>
		>;

		const parsed = ctx.client.users.$zod.query.parse({
			include: {
				posts: {
					where: {
						published: true,
					},
				},
			},
			where: {
				name: {
					contains: 'Ali',
					mode: 'insensitive',
				},
			},
		});

		expect(parsed.include?.posts).toBeDefined();
		ctx.close();
	});
});

describe('@better-drizzle/zod - generated schemas', () => {
	test('create schema applies omit, extend, transform and strip', () => {
		const ctx = createZodContext();

		const parsed = ctx.client.users.$zod.create.parse({
			active: 'true',
			age: '20',
			email: 'UPPER@EXAMPLE.COM',
			id: 999,
			name: 'Gina',
			password: 'supersecret',
		});

		expect(parsed).toEqual({
			active: true,
			age: 20,
			email: 'upper@example.com',
			name: 'Gina',
			password: 'supersecret',
		});
		expect('id' in parsed).toBe(false);
		ctx.close();
	});

	test('update schema is partial and respects field overrides', () => {
		const ctx = createZodContext();

		expect(
			ctx.client.users.$zod.update.parse({
				name: 'Valid Name',
			}),
		).toEqual({
			name: 'Valid Name',
		});

		expect(() =>
			ctx.client.users.$zod.update.parse({
				name: 'A',
			}),
		).toThrow();

		ctx.close();
	});

	test('select schema respects configured omit', () => {
		const ctx = createZodContext();

		const parsed = ctx.client.users.$zod.select.parse({
			active: true,
			age: 20,
			id: 1,
			name: 'Alice',
		});

		expect(parsed).toEqual({
			active: true,
			age: 20,
			id: 1,
			name: 'Alice',
		});
		expect('email' in parsed).toBe(false);
		ctx.close();
	});

	test('where schema supports scalar and relation operators', () => {
		const ctx = createZodContext();

		const parsed = ctx.client.users.$zod.where.parse({
			AND: [{ active: true }],
			OR: [{ age: { gte: 18 } }],
			posts: {
				some: {
					published: true,
				},
			},
		});

		expect(parsed.posts?.some?.published).toBe(true);
		expect(parsed.OR).toHaveLength(1);
		ctx.close();
	});

	test('orderBy schema accepts object and array forms', () => {
		const ctx = createZodContext();

		expect(
			ctx.client.users.$zod.orderBy.parse({
				id: 'asc',
				name: 'desc',
			}),
		).toEqual({
			id: 'asc',
			name: 'desc',
		});

		expect(
			ctx.client.users.$zod.orderBy.parse([
				{ id: 'asc' },
				{ name: 'desc' },
			]),
		).toHaveLength(2);
		ctx.close();
	});

	test('pagination schema accepts limit and query fields', () => {
		const ctx = createZodContext();

		const parsed = ctx.client.users.$zod.pagination.parse({
			include: {
				posts: true,
			},
			limit: 2,
			orderBy: {
				id: 'asc',
			},
			where: {
				active: true,
			},
		});

		expect(parsed.limit).toBe(2);
		expect(parsed.include?.posts).toBe(true);
		ctx.close();
	});

	test('query schema supports nested relation query args', () => {
		const ctx = createZodContext();

		const parsed = ctx.client.users.$zod.query.parse({
			include: {
				posts: {
					orderBy: [{ id: 'asc' }],
					select: {
						id: true,
						title: true,
					},
					where: {
						comments: {
							some: {
								likes: {
									gte: 3,
								},
							},
						},
					},
				},
			},
			orderBy: {
				name: 'asc',
			},
		});

		expect(parsed.include?.posts).toBeDefined();
		ctx.close();
	});

	test('upsert schema validates create update and where parts together', () => {
		const ctx = createZodContext();

		const parsed = ctx.client.users.$zod.upsert.parse({
			create: {
				active: true,
				age: 24,
				email: 'upsert@example.com',
				name: 'Hank',
				password: 'supersecret',
			},
			update: {
				name: 'Hank Updated',
			},
			where: {
				email: 'upsert@example.com',
			},
		});

		expect(parsed.update.name).toBe('Hank Updated');
		expect(parsed.create.email).toBe('upsert@example.com');
		ctx.close();
	});
});

describe('@better-drizzle/zod - create validation', () => {
	test('validates and coerces create payloads', async () => {
		const ctx = createZodContext();

		const created = await ctx.client.users.create({
			data: {
				active: 'true' as never,
				age: '41' as never,
				email: 'NEW@EXAMPLE.COM',
				id: 6,
				name: 'Frank',
				password: 'supersecret' as never,
			},
		});

		expect(created).toMatchObject({
			active: true,
			age: 41,
			name: 'Frank',
		});
		ctx.close();
	});

	test('rejects invalid create payloads by default', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.create({
				data: {
					active: true,
					age: 18,
					email: 'invalid-email',
					id: 6,
					name: 'A',
					password: 'supersecret' as never,
				},
			}),
		).rejects.toThrow('Zod validation failed for create payload');

		ctx.close();
	});

	test('supports validate false to bypass create validation', async () => {
		const ctx = createZodContext();

		const created = await ctx.client.users.create({
			data: {
				active: true,
				age: 19,
				email: 'not-an-email',
				id: 6,
				name: 'A',
			},
			validate: false,
		});

		expect(created?.email).toBe('not-an-email');
		expect(created?.name).toBe('A');
		ctx.close();
	});

	test('validates createMany payload arrays', async () => {
		const ctx = createZodContext();

		const result = await ctx.client.users.createMany({
			data: [
				{
					active: 'true' as never,
					age: '21' as never,
					email: 'batch1@example.com',
					id: 101,
					name: 'Batch One',
					password: 'supersecret' as never,
				},
				{
					active: false,
					age: 22,
					email: 'batch2@example.com',
					id: 102,
					name: 'Batch Two',
					password: 'supersecret' as never,
				},
			],
		});

		expect(result.count).toBe(2);
		expect(result.data?.[0]).toMatchObject({
			age: 21,
			email: 'batch1@example.com',
		});
		ctx.close();
	});

	test('rejects invalid createMany rows', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.createMany({
				data: [
					{
						active: true,
						age: 20,
						email: 'ok@example.com',
						id: 111,
						name: 'Okay',
						password: 'supersecret' as never,
					},
					{
						active: true,
						age: 21,
						email: 'bad-email',
						id: 112,
						name: 'A',
						password: 'supersecret' as never,
					},
				],
			}),
		).rejects.toThrow('Zod validation failed for createMany payload');

		ctx.close();
	});
});

describe('@better-drizzle/zod - update validation', () => {
	test('validates updates with partial create rules', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.update({
				data: {
					name: 'A',
				},
				where: {
					id: 1,
				},
			}),
		).rejects.toThrow('Zod validation failed for update payload');

		const updated = await ctx.client.users.update({
			data: {
				name: 'Alice Updated',
			},
			where: {
				id: 1,
			},
		});

		expect(updated?.name).toBe('Alice Updated');
		ctx.close();
	});

	test('validates updateMany payloads', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.updateMany({
				data: {
					name: 'A',
				},
				where: {
					active: true,
				},
			}),
		).rejects.toThrow('Zod validation failed for updateMany payload');

		const updated = await ctx.client.users.updateMany({
			data: {
				name: 'Group Updated',
			},
			where: {
				active: false,
			},
		});

		expect(updated.count).toBe(2);
		ctx.close();
	});

	test('validates updateEach payload rows', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.updateEach({
				by: ctx.schema.users.email,
				data: [{ email: 'alice@example.com', name: 'A' }],
				update: {
					name: (row) => row.name,
				},
			}),
		).rejects.toThrow('Zod validation failed for updateEach payload');

		const updated = await ctx.client.users.updateEach({
			by: ctx.schema.users.email,
			data: [{ email: 'alice@example.com', name: 'Alice One' }],
			update: {
				name: (row) => row.name,
			},
		});

		expect(updated.count).toBe(1);
		ctx.close();
	});
});

describe('@better-drizzle/zod - upsert validation', () => {
	test('validates upsert create update and where', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.upsert({
				create: {
					active: true,
					age: 40,
					email: 'invalid-email',
					id: 300,
					name: 'New User',
					password: 'supersecret' as never,
				},
				update: { name: 'Upsert Updated' },
				where: { name: 'New User' },
			}),
		).rejects.toThrow('Zod validation failed for upsert payload');

		const result = await ctx.client.users.upsert({
			create: {
				active: true,
				age: 40,
				email: 'upsert@example.com',
				id: 300,
				name: 'New User',
				password: 'supersecret' as never,
			},
			update: { name: 'Upsert Updated' },
			where: { name: 'New User' },
		});

		expect(result?.email).toBe('upsert@example.com');
		ctx.close();
	});

	test('validates upsertMany data and update payloads', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.upsertMany({
				data: [
					{
						active: true,
						age: 26,
						email: 'alice@example.com',
						id: 1,
						name: 'A',
						password: 'supersecret' as never,
					},
				],
				target: 'email',
				update: {
					name: 'Alice Batch',
				},
			}),
		).rejects.toThrow('Zod validation failed for upsertMany payload');

		const result = await ctx.client.users.upsertMany({
			data: [
				{
					active: false,
					age: 26,
					email: 'alice@example.com',
					id: 1,
					name: 'Alice Batch',
					password: 'supersecret' as never,
				},
				{
					active: true,
					age: 22,
					email: 'batch-new@example.com',
					id: 300,
					name: 'Batch New',
					password: 'supersecret' as never,
				},
			],
			target: 'email',
			update: {
				active: false,
				name: 'Updated',
			},
		});

		expect(result.count).toBe(2);
		ctx.close();
	});
});

describe('@better-drizzle/zod - query arg validation', () => {
	test('validates findMany query args', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.findMany({
				orderBy: {
					name: 'sideways',
				} as never,
			}),
		).rejects.toThrow('Zod validation failed for query args');

		const rows = await ctx.client.users.findMany({
			include: {
				posts: {
					where: {
						published: true,
					},
				},
			},
			orderBy: {
				id: 'asc',
			},
			where: {
				posts: {
					some: {
						published: true,
					},
				},
			},
		});

		expect(rows.length).toBeGreaterThan(0);
		ctx.close();
	});

	test('validates findFirst and findOne query args', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.findFirst({
				orderBy: 'bad' as never,
			}),
		).rejects.toThrow('Zod validation failed for query args');

		await expect(
			ctx.client.users.findOne({
				where: 'bad' as never,
			}),
		).rejects.toThrow('Zod validation failed for query args');

		ctx.close();
	});

	test('validates findUnique query args', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.findUnique({
				where: 'bad' as never,
			}),
		).rejects.toThrow('Zod validation failed for query args');

		ctx.close();
	});

	test('validates paginate query args', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.paginate({
				limit: '2' as never,
			}),
		).rejects.toThrow('Zod validation failed for paginate args');

		const page = await ctx.client.users.paginate({
			limit: 2,
			orderBy: {
				id: 'asc',
			},
			where: {
				active: true,
			},
		});

		expect(page.pagination.type).toBe('offset');
		expect(page.data.length).toBe(2);
		ctx.close();
	});

	test('validates cursor query args', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.cursor({
				after: 1 as never,
				limit: 2,
				orderBy: [{ id: 'asc' }],
			}),
		).rejects.toThrow('Zod validation failed for cursor args');

		const page = await ctx.client.users.cursor({
			after: { id: 2 },
			limit: 2,
			orderBy: [{ id: 'asc' }],
		});

		expect(page.pagination.type).toBe('cursor');
		expect(page.data.length).toBe(2);
		ctx.close();
	});

	test('validates count and exists args', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.count({
				cursor: 'nope' as never,
			}),
		).rejects.toThrow('Zod validation failed for count args');

		await expect(
			ctx.client.users.exists({
				cursor: 'nope' as never,
			}),
		).rejects.toThrow('Zod validation failed for exists args');

		expect(
			await ctx.client.users.count({
				where: { active: true },
			}),
		).toBe(3);
		expect(
			await ctx.client.users.exists({
				where: { active: false },
			}),
		).toBe(true);
		ctx.close();
	});
});

describe('@better-drizzle/zod - delete validation', () => {
	test('validates delete args', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.delete({
				where: 'bad' as never,
			}),
		).rejects.toThrow('Zod validation failed for delete args');

		const deleted = await ctx.client.users.delete({
			where: {
				id: 5,
			},
		});

		expect(deleted?.id).toBe(5);
		ctx.close();
	});

	test('validates deleteMany args', async () => {
		const ctx = createZodContext();

		await expect(
			ctx.client.users.deleteMany({
				where: 'bad' as never,
			}),
		).rejects.toThrow('Zod validation failed for deleteMany args');

		await ctx.raw.run(sql`PRAGMA foreign_keys = OFF`);
		await ctx.raw.run(sql`DELETE FROM test_comments`);
		await ctx.raw.run(sql`DELETE FROM test_posts`);
		await ctx.raw.run(sql`PRAGMA foreign_keys = ON`);

		const deleted = await ctx.client.users.deleteMany({
			where: {
				active: false,
			},
		});

		expect(deleted.count).toBe(2);
		ctx.close();
	});
});

describe('@better-drizzle/zod - result validation', () => {
	test('validates createMany result shape', async () => {
		const ctx = createZodContext();

		const result = await ctx.client.users.createMany({
			data: [
				{
					active: true,
					age: 21,
					email: 'result1@example.com',
					id: 201,
					name: 'Result One',
					password: 'supersecret' as never,
				},
				{
					active: false,
					age: 22,
					email: 'result2@example.com',
					id: 202,
					name: 'Result Two',
					password: 'supersecret' as never,
				},
			],
			select: {
				id: true,
				name: true,
			},
		});

		expect(result).toEqual({
			count: 2,
			data: [
				{ id: 6, name: 'Result One' },
				{ id: 7, name: 'Result Two' },
			],
		});
		ctx.close();
	});

	test('validates query result shape for select', async () => {
		const ctx = createZodContext();

		const result = await ctx.client.users.findMany({
			orderBy: {
				id: 'asc',
			},
			select: {
				id: true,
				name: true,
			},
			take: 2,
		});

		expect(result).toEqual([
			{ id: 1, name: 'Alice' },
			{ id: 2, name: 'Bob' },
		]);
		ctx.close();
	});

	test('validates query result shape for include', async () => {
		const ctx = createZodContext();

		const result = await ctx.client.users.findFirst({
			include: {
				posts: {
					select: {
						id: true,
						title: true,
					},
				},
			},
			where: {
				id: 1,
			},
		});

		expect(result).not.toBeNull();
		expect(Array.isArray((result as { posts: unknown[] }).posts)).toBe(
			true,
		);
		ctx.close();
	});

	test('supports validate false on query to bypass arg validation', async () => {
		const ctx = createZodContext();

		const result = await ctx.client.users.findMany({
			orderBy: {
				name: 'sideways',
			} as never,
			validate: false,
		});

		expect(Array.isArray(result)).toBe(true);
		ctx.close();
	});
});
