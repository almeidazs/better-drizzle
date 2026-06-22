import { and, asc, count, desc, eq, gte, like } from 'drizzle-orm';

import { OrderType, PaginationType } from '../packages/core/src';

import { benchWrites, posts, users } from './schema';
import type { BenchmarkContext } from './setup';

const nextWriteId = (context: BenchmarkContext) => {
	const id = context.counters.createDeleteId;
	context.counters.createDeleteId += 1;
	return id;
};

const nextWriteToken = (context: BenchmarkContext) => {
	const token = `bench-${context.counters.createDeleteToken}`;
	context.counters.createDeleteToken += 1;
	return token;
};

const nextUpdateId = (context: BenchmarkContext) => {
	context.counters.updateOffset =
		(context.counters.updateOffset + 1) % context.ids.updatePoolSize;

	return context.counters.updateOffset + 1;
};

export const rawPointLookup = async (context: BenchmarkContext) => {
	const rows = await context.raw
		.select()
		.from(users)
		.where(eq(users.id, context.ids.userLookupId))
		.limit(1);

	return rows[0] ?? null;
};

export const betterPointLookup = async (context: BenchmarkContext) =>
	context.better.users.findFirst({
		take: 1,
		where: { id: context.ids.userLookupId },
	});

export const rawFilteredList = async (context: BenchmarkContext) =>
	context.raw
		.select()
		.from(users)
		.where(
			and(
				eq(users.active, true),
				gte(users.age, 30),
				like(users.email, '%@example.com'),
			),
		)
		.orderBy(desc(users.age), asc(users.id))
		.limit(25);

export const betterFilteredList = async (context: BenchmarkContext) =>
	context.better.users.findMany({
		orderBy: [{ age: 'desc' }, { id: 'asc' }],
		take: 25,
		where: {
			active: true,
			age: { gte: 30 },
			email: { endsWith: '@example.com' },
		},
	});

export const rawRelationGraph = async (context: BenchmarkContext) =>
	context.raw.query.users.findMany({
		limit: context.ids.relationLimit,
		with: {
			posts: {
				with: {
					comments: true,
				},
			},
		},
	});

export const betterRelationGraph = async (context: BenchmarkContext) =>
	context.better.users.findMany({
		include: {
			posts: {
				include: {
					comments: true,
				},
			},
		},
		take: context.ids.relationLimit,
	});

export const rawActiveCount = async (context: BenchmarkContext) =>
	Number(
		(
			await context.raw
				.select({ count: count() })
				.from(users)
				.where(and(eq(users.active, true), gte(users.age, 30)))
		)[0]?.count ?? 0,
	);

export const betterActiveCount = async (context: BenchmarkContext) =>
	context.better.users.count({
		where: {
			active: true,
			age: { gte: 30 },
		},
	});

export const rawExists = async (context: BenchmarkContext) => {
	const rows = await context.raw
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.active, true), gte(users.age, 50)))
		.limit(1);

	return rows.length > 0;
};

export const betterExists = async (context: BenchmarkContext) =>
	context.better.users.exists({
		where: {
			active: true,
			age: { gte: 50 },
		},
	});

export const rawOffsetPaginate = async (context: BenchmarkContext) => {
	const [data, total] = await Promise.all([
		context.raw
			.select()
			.from(users)
			.orderBy(asc(users.id))
			.limit(25)
			.offset(80),
		context.raw.select({ count: count() }).from(users),
	]);

	return {
		data,
		pagination: {
			count: Number(total[0]?.count ?? 0),
			hasNext: data.length >= 25,
			hasPrevious: true,
		},
	};
};

export const betterOffsetPaginate = async (context: BenchmarkContext) =>
	context.better.users.paginate({
		limit: 25,
		orderBy: [{ id: OrderType.Asc }],
		skip: 80,
		type: PaginationType.Offset,
	});

export const rawCursorPaginate = async (context: BenchmarkContext) => {
	const [data, total] = await Promise.all([
		context.raw
			.select()
			.from(users)
			.where(gte(users.id, context.ids.cursorAfterId + 1))
			.orderBy(asc(users.id))
			.limit(25),
		context.raw.select({ count: count() }).from(users),
	]);

	return {
		data,
		pagination: {
			count: Number(total[0]?.count ?? 0),
			hasNext: data.length >= 25,
			hasPrevious: true,
		},
	};
};

export const betterCursorPaginate = async (context: BenchmarkContext) =>
	context.better.users.paginate({
		after: { id: context.ids.cursorAfterId },
		limit: 25,
		orderBy: [{ id: OrderType.Asc }],
		type: PaginationType.Cursor,
	});

export const rawCreateDeleteRoundtrip = async (context: BenchmarkContext) => {
	const id = nextWriteId(context);
	const token = nextWriteToken(context);

	const createdRows = await context.raw
		.insert(benchWrites)
		.values({
			id,
			payload: `payload-${id}`,
			token,
			value: id % 1000,
		})
		.returning();

	await context.raw
		.delete(benchWrites)
		.where(eq(benchWrites.id, id))
		.returning();

	return createdRows[0] ?? null;
};

export const rawCreateDeleteBare = async (context: BenchmarkContext) => {
	const id = nextWriteId(context);
	const token = nextWriteToken(context);

	await context.raw.insert(benchWrites).values({
		id,
		payload: `payload-${id}`,
		token,
		value: id % 1000,
	});

	await context.raw.delete(benchWrites).where(eq(benchWrites.id, id));
};

export const betterCreateDeleteRoundtrip = async (
	context: BenchmarkContext,
) => {
	const id = nextWriteId(context);
	const token = nextWriteToken(context);

	const created = await context.better.benchWrites.create({
		data: {
			id,
			payload: `payload-${id}`,
			token,
			value: id % 1000,
		},
	});

	await context.better.benchWrites.delete({
		where: { id },
	});

	return created;
};

export const rawUpdateAndLoad = async (context: BenchmarkContext) => {
	const id = nextUpdateId(context);
	const nextValue = (context.counters.updateOffset * 19) % 10_000;

	const rows = await context.raw
		.update(benchWrites)
		.set({
			payload: `payload-updated-${nextValue}`,
			value: nextValue,
		})
		.where(eq(benchWrites.id, id))
		.returning();

	return rows[0] ?? null;
};

export const betterUpdateAndLoad = async (context: BenchmarkContext) => {
	const id = nextUpdateId(context);
	const nextValue = (context.counters.updateOffset * 19) % 10_000;

	return context.better.benchWrites.update({
		data: {
			payload: `payload-updated-${nextValue}`,
			value: nextValue,
		},
		where: { id },
	});
};

export const rawComplexRelationFilter = async (context: BenchmarkContext) =>
	context.raw
		.select({
			author: {
				active: users.active,
				age: users.age,
				email: users.email,
				id: users.id,
				name: users.name,
			},
			body: posts.body,
			id: posts.id,
			published: posts.published,
			score: posts.score,
			title: posts.title,
			userId: posts.userId,
		})
		.from(posts)
		.innerJoin(users, eq(posts.userId, users.id))
		.where(and(eq(users.active, true), gte(posts.score, 100)))
		.orderBy(desc(posts.score), asc(posts.id))
		.limit(40);

export const rawComplexJoinFlat = async (context: BenchmarkContext) =>
	context.raw
		.select({
			postId: posts.id,
			postScore: posts.score,
			userId: users.id,
		})
		.from(posts)
		.innerJoin(users, eq(posts.userId, users.id))
		.where(and(eq(users.active, true), gte(posts.score, 100)))
		.orderBy(desc(posts.score), asc(posts.id))
		.limit(40);

export const betterComplexJoinEquivalent = async (context: BenchmarkContext) =>
	context.better.posts.findMany({
		include: {
			author: true,
		},
		orderBy: [{ score: 'desc' }, { id: 'asc' }],
		take: 40,
		where: {
			score: { gte: 100 },
			author: {
				is: {
					active: true,
				},
			},
		},
	});
