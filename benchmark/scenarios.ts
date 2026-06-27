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

const betterClient = (context: BenchmarkContext) =>
	context.better as unknown as {
		benchWrites: any;
		posts: any;
		transaction<T>(callback: (tx: any) => Promise<T> | T): Promise<T>;
		users: any;
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
	betterClient(context).users.findFirst({
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
	betterClient(context).users.findMany({
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
	betterClient(context).users.findMany({
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
	betterClient(context).users.count({
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
	betterClient(context).users.exists({
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
	betterClient(context).users.paginate({
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
	betterClient(context).users.paginate({
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

	const created = await betterClient(context).benchWrites.create({
		data: {
			id,
			payload: `payload-${id}`,
			token,
			value: id % 1000,
		},
	});

	await betterClient(context).benchWrites.delete({
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

	return betterClient(context).benchWrites.update({
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
	betterClient(context).posts.findMany({
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

// ---------------------------------------------------------------------------
// Transaction benchmarks
// ---------------------------------------------------------------------------

/**
 * Raw Drizzle: simple transaction – one insert + one select inside a
 * `db.transaction()` callback.
 */
export const rawSimpleTransaction = async (context: BenchmarkContext) =>
	context.raw.transaction(async (tx) => {
		const id = nextWriteId(context);
		const token = nextWriteToken(context);

		await tx
			.insert(benchWrites)
			.values({
				id,
				payload: `payload-${id}`,
				token,
				value: id % 1000,
			})
			.returning();

		return tx
			.select()
			.from(benchWrites)
			.where(eq(benchWrites.id, id))
			.limit(1);
	});

/**
 * Better Drizzle: simple transaction – one insert + one select inside a
 * `client.transaction()` callback.
 */
export const betterSimpleTransaction = async (context: BenchmarkContext) =>
	betterClient(context).transaction(async (tx: any) => {
		const id = nextWriteId(context);
		const token = nextWriteToken(context);

		await tx.benchWrites.create({
			data: {
				id,
				payload: `payload-${id}`,
				token,
				value: id % 1000,
			},
		});

		return tx.benchWrites.findFirst({
			where: { id },
		});
	});

/**
 * Raw Drizzle: multi-operation transaction – three inserts, one update,
 * and one select inside a single transaction.
 */
export const rawMultiOpTransaction = async (context: BenchmarkContext) =>
	context.raw.transaction(async (tx) => {
		const baseId = nextWriteId(context);
		const id2 = nextWriteId(context);
		const id3 = nextWriteId(context);
		const baseToken = nextWriteToken(context);

		await tx
			.insert(benchWrites)
			.values({
				id: baseId,
				payload: `payload-${baseId}`,
				token: baseToken,
				value: baseId % 1000,
			})
			.returning();

		await tx
			.insert(benchWrites)
			.values({
				id: id2,
				payload: `payload-${id2}`,
				token: `bench-${context.counters.createDeleteToken}`,
				value: id2 % 1000,
			})
			.returning();
		context.counters.createDeleteToken += 1;

		await tx
			.insert(benchWrites)
			.values({
				id: id3,
				payload: `payload-${id3}`,
				token: `bench-${context.counters.createDeleteToken}`,
				value: id3 % 1000,
			})
			.returning();
		context.counters.createDeleteToken += 1;

		const nextValue = (context.counters.updateOffset * 19) % 10_000;
		await tx
			.update(benchWrites)
			.set({
				payload: `payload-updated-${nextValue}`,
				value: nextValue,
			})
			.where(eq(benchWrites.id, baseId))
			.returning();

		return tx
			.select()
			.from(benchWrites)
			.where(eq(benchWrites.id, baseId))
			.limit(1);
	});

/**
 * Better Drizzle: multi-operation transaction – three creates, one update,
 * and one findFirst inside a single transaction.
 */
export const betterMultiOpTransaction = async (context: BenchmarkContext) =>
	betterClient(context).transaction(async (tx: any) => {
		const baseId = nextWriteId(context);
		const id2 = nextWriteId(context);
		const id3 = nextWriteId(context);
		const baseToken = nextWriteToken(context);

		await tx.benchWrites.create({
			data: {
				id: baseId,
				payload: `payload-${baseId}`,
				token: baseToken,
				value: baseId % 1000,
			},
		});

		await tx.benchWrites.create({
			data: {
				id: id2,
				payload: `payload-${id2}`,
				token: `bench-${context.counters.createDeleteToken}`,
				value: id2 % 1000,
			},
		});
		context.counters.createDeleteToken += 1;

		await tx.benchWrites.create({
			data: {
				id: id3,
				payload: `payload-${id3}`,
				token: `bench-${context.counters.createDeleteToken}`,
				value: id3 % 1000,
			},
		});
		context.counters.createDeleteToken += 1;

		const nextValue = (context.counters.updateOffset * 19) % 10_000;
		await tx.benchWrites.update({
			data: {
				payload: `payload-updated-${nextValue}`,
				value: nextValue,
			},
			where: { id: baseId },
		});

		return tx.benchWrites.findFirst({
			where: { id: baseId },
		});
	});

/**
 * Better Drizzle: nested transaction with savepoints – an outer transaction
 * creates a row, then spawns an inner savepoint transaction that creates
 * another row and reads both. This scenario has no raw Drizzle parity
 * equivalent because Drizzle's SQLite transaction does not natively support
 * nested savepoints.
 */
export const betterNestedTransaction = async (context: BenchmarkContext) =>
	betterClient(context).transaction(async (tx: any) => {
		const outerId = nextWriteId(context);
		const outerToken = nextWriteToken(context);

		await tx.benchWrites.create({
			data: {
				id: outerId,
				payload: `payload-${outerId}`,
				token: outerToken,
				value: outerId % 1000,
			},
		});

		await tx.transaction(async (innerTx: any) => {
			const innerId = nextWriteId(context);
			const innerToken = nextWriteToken(context);

			await innerTx.benchWrites.create({
				data: {
					id: innerId,
					payload: `payload-${innerId}`,
					token: innerToken,
					value: innerId % 1000,
				},
			});

			return innerTx.benchWrites.findMany({
				where: {
					id: { in: [outerId, innerId] },
				},
			});
		});

		return tx.benchWrites.findFirst({
			where: { id: outerId },
		});
	});

/**
 * Raw Drizzle: read-only transaction – two selects inside a transaction to
 * verify that read-path transaction overhead is minimal.
 */
export const rawReadOnlyTransaction = async (context: BenchmarkContext) =>
	context.raw.transaction(async (tx) => {
		const first = await tx
			.select()
			.from(users)
			.where(eq(users.id, context.ids.userLookupId))
			.limit(1);

		const second = await tx
			.select()
			.from(benchWrites)
			.where(eq(benchWrites.id, context.ids.userLookupId))
			.limit(1);

		return { benchWrite: second[0] ?? null, user: first[0] ?? null };
	});

/**
 * Better Drizzle: read-only transaction – two findFirst calls inside a
 * transaction to compare with the raw read-only transaction path.
 */
export const betterReadOnlyTransaction = async (context: BenchmarkContext) =>
	betterClient(context).transaction(async (tx: any) => {
		const user = await tx.users.findFirst({
			where: { id: context.ids.userLookupId },
		});

		const benchWrite = await tx.benchWrites.findFirst({
			where: { id: context.ids.userLookupId },
		});

		return { benchWrite, user };
	});
