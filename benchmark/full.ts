import { deepStrictEqual } from 'node:assert';

import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { bench, do_not_optimize, group, run, summary } from 'mitata';

import {
	betterActiveCount,
	betterComplexJoinEquivalent,
	betterCursorPaginate,
	betterExists,
	betterFilteredList,
	betterMultiOpTransaction,
	betterOffsetPaginate,
	betterPointLookup,
	betterReadOnlyTransaction,
	betterRelationCounts,
	betterRelationGraph,
	betterSimpleTransaction,
	rawActiveCount,
	rawComplexRelationFilter,
	rawCursorPaginate,
	rawExists,
	rawFilteredList,
	rawMultiOpTransaction,
	rawOffsetPaginate,
	rawPointLookup,
	rawReadOnlyTransaction,
	rawRelationCounts,
	rawRelationGraph,
	rawSimpleTransaction,
} from './scenarios';
import { benchWrites, comments, posts, users } from './schema';
import { type BenchmarkContext, createBenchmarkContext } from './setup';

type Operation = () => Promise<unknown>;

// biome-ignore lint/suspicious/noExplicitAny: benchmark type erasure
type Any = any;

const betterClient = (context: BenchmarkContext) =>
	context.better as unknown as {
		$raw: Any;
		benchWrites: Any;
		users: Any;
	};

const normalizeRows = (rows: readonly Record<string, unknown>[]) =>
	[...rows].sort((left, right) => Number(left.id) - Number(right.id));

const createExtendedOperations = (
	context: BenchmarkContext,
	mode: 'better' | 'raw',
) => {
	let batchId = 100_000;
	let updateIteration = 0;

	return {
		async batchCreateDelete() {
			const start = batchId;
			batchId += 25;
			const data = Array.from({ length: 25 }, (_, index) => {
				const id = start + index;
				return {
					id,
					payload: `Full batch ${id}`,
					token: `full-batch-${id}`,
					value: id % 1_000,
				};
			});

			if (mode === 'raw') {
				const created = await context.raw
					.insert(benchWrites)
					.values(data)
					.returning();
				await context.raw
					.delete(benchWrites)
					.where(
						inArray(
							benchWrites.id,
							data.map((row) => row.id),
						),
					)
					.returning();
				return normalizeRows(created);
			}

			const created = await betterClient(context).benchWrites.createMany({
				data,
			});
			await betterClient(context).benchWrites.deleteMany({
				where: { id: { in: data.map((row) => row.id) } },
			});
			return normalizeRows(created.data);
		},
		async nestedRelationPage() {
			if (mode === 'raw') {
				const roots = await context.raw
					.select()
					.from(users)
					.orderBy(asc(users.id))
					.limit(30);
				const postRows = await context.raw
					.select()
					.from(posts)
					.where(
						and(
							inArray(
								posts.userId,
								roots.map((row) => row.id),
							),
							eq(posts.published, true),
						),
					)
					.orderBy(asc(posts.userId), desc(posts.score));
				const postsByUser = new Map<number, typeof postRows>();
				for (const post of postRows) {
					const group = postsByUser.get(post.userId);
					if (group) {
						if (group.length < 2) group.push(post);
					} else postsByUser.set(post.userId, [post]);
				}
				const selectedPosts = [...postsByUser.values()].flat();
				const commentRows = await context.raw
					.select()
					.from(comments)
					.where(
						inArray(
							comments.postId,
							selectedPosts.map((post) => post.id),
						),
					)
					.orderBy(asc(comments.postId), desc(comments.likes));
				const commentByPost = new Map<
					number,
					(typeof commentRows)[number]
				>();
				for (const comment of commentRows)
					if (!commentByPost.has(comment.postId))
						commentByPost.set(comment.postId, comment);

				return roots.map((user) => ({
					...user,
					posts: (postsByUser.get(user.id) ?? []).map((post) => ({
						...post,
						comments: commentByPost.has(post.id)
							? [commentByPost.get(post.id)]
							: [],
					})),
				}));
			}

			return betterClient(context).users.findMany({
				include: {
					posts: {
						include: {
							comments: { orderBy: { likes: 'desc' }, take: 1 },
						},
						orderBy: { score: 'desc' },
						take: 2,
						where: { published: true },
					},
				},
				orderBy: { id: 'asc' },
				take: 30,
			});
		},
		async projection() {
			if (mode === 'raw')
				return context.raw
					.select({
						email: users.email,
						id: users.id,
						name: users.name,
					})
					.from(users)
					.where(gte(users.age, 40))
					.orderBy(asc(users.id))
					.limit(60);
			return betterClient(context).users.findMany({
				orderBy: { id: 'asc' },
				select: { email: true, id: true, name: true },
				take: 60,
				where: { age: { gte: 40 } },
			});
		},
		async rawSql() {
			if (mode === 'raw')
				return context.raw
					.select({ id: users.id, name: users.name })
					.from(users)
					.where(and(eq(users.active, true), gte(users.age, 50)))
					.orderBy(asc(users.id))
					.limit(40);
			return betterClient(context).$raw<{ id: number; name: string }>`
				select id, name from users
				where active = ${1} and age >= ${50}
				order by id asc limit 40
			`;
		},
		async relationWrite() {
			const postIds = [5, 6];
			if (mode === 'raw')
				return context.raw.transaction(async (tx) => {
					await tx
						.update(posts)
						.set({ userId: 1 })
						.where(inArray(posts.id, postIds));
					const root = (
						await tx
							.select()
							.from(users)
							.where(eq(users.id, 1))
							.limit(1)
					)[0];
					if (!root) return null;
					const related = await tx
						.select()
						.from(posts)
						.where(
							and(
								eq(posts.userId, 1),
								inArray(posts.id, postIds),
							),
						)
						.orderBy(asc(posts.id));
					return { ...root, posts: related };
				});

			return betterClient(context).users.update({
				data: { posts: { connect: postIds.map((id) => ({ id })) } },
				include: {
					posts: {
						orderBy: { id: 'asc' },
						where: { id: { in: postIds } },
					},
				},
				where: { id: 1 },
			});
		},
		async updateEach() {
			updateIteration += 1;
			const data = Array.from({ length: 20 }, (_, index) => ({
				id: index + 1,
				payload: `Each ${updateIteration}-${index}`,
				value: updateIteration * 100 + index,
			}));
			if (mode === 'raw') {
				const payloadCases = data.map(
					(row) => sql`when ${row.id} then ${row.payload}`,
				);
				const valueCases = data.map(
					(row) => sql`when ${row.id} then ${row.value}`,
				);
				const rows = await context.raw
					.update(benchWrites)
					.set({
						payload: sql`case ${benchWrites.id} ${sql.join(payloadCases, sql` `)} else ${benchWrites.payload} end`,
						value: sql`case ${benchWrites.id} ${sql.join(valueCases, sql` `)} else ${benchWrites.value} end`,
					})
					.where(
						inArray(
							benchWrites.id,
							data.map((row) => row.id),
						),
					)
					.returning();
				return normalizeRows(rows);
			}

			const result = await betterClient(context).benchWrites.updateEach({
				by: benchWrites.id,
				data,
				select: { id: true, payload: true, token: true, value: true },
				update: {
					payload: (row: (typeof data)[number]) => row.payload,
					value: (row: (typeof data)[number]) => row.value,
				},
			});
			return normalizeRows(result.data);
		},
		async updateMany() {
			updateIteration += 1;
			const payload = `Many ${updateIteration}`;
			if (mode === 'raw') {
				const result = await context.raw
					.update(benchWrites)
					.set({ payload })
					.where(
						and(gte(benchWrites.id, 100), lte(benchWrites.id, 140)),
					)
					.returning({ id: benchWrites.id });
				return { count: result.length };
			}
			const result = await betterClient(context).benchWrites.updateMany({
				data: { payload },
				where: { id: { gte: 100, lte: 140 } },
			});
			return { count: result.count };
		},
		async upsertMany() {
			updateIteration += 1;
			const data = Array.from({ length: 25 }, (_, index) => ({
				id: index + 1,
				payload: `Upsert ${updateIteration}-${index}`,
				token: `seed-${index + 1}`,
				value: updateIteration * 10 + index,
			}));
			if (mode === 'raw') {
				const rows = await context.raw
					.insert(benchWrites)
					.values(data)
					.onConflictDoUpdate({
						set: {
							payload: sql`excluded.payload`,
							value: sql`excluded.value`,
						},
						target: benchWrites.token,
					})
					.returning();
				return normalizeRows(rows);
			}
			const result = await betterClient(context).benchWrites.upsertMany({
				data,
				select: { id: true, payload: true, token: true, value: true },
				target: 'token',
				update: ['payload', 'value'],
			});
			return normalizeRows(result.data);
		},
	};
};

const readPairs = (raw: BenchmarkContext, better: BenchmarkContext) => {
	const rawExtended = createExtendedOperations(raw, 'raw');
	const betterExtended = createExtendedOperations(better, 'better');
	return [
		[
			'point lookup',
			() => rawPointLookup(raw),
			() => betterPointLookup(better),
		],
		[
			'filtered list',
			() => rawFilteredList(raw),
			() => betterFilteredList(better),
		],
		['projection', rawExtended.projection, betterExtended.projection],
		[
			'relation graph',
			() => rawRelationGraph(raw),
			() => betterRelationGraph(better),
		],
		[
			'relation counts',
			() => rawRelationCounts(raw),
			() => betterRelationCounts(better),
		],
		[
			'nested relation page',
			rawExtended.nestedRelationPage,
			betterExtended.nestedRelationPage,
		],
		['count', () => rawActiveCount(raw), () => betterActiveCount(better)],
		['exists', () => rawExists(raw), () => betterExists(better)],
		[
			'offset pagination',
			() => rawOffsetPaginate(raw),
			() => betterOffsetPaginate(better),
		],
		[
			'cursor pagination',
			() => rawCursorPaginate(raw),
			() => betterCursorPaginate(better),
		],
		[
			'relation filter',
			() => rawComplexRelationFilter(raw),
			() => betterComplexJoinEquivalent(better),
		],
		['raw sql', rawExtended.rawSql, betterExtended.rawSql],
	] as const;
};

const writePairs = (raw: BenchmarkContext, better: BenchmarkContext) => {
	const rawExtended = createExtendedOperations(raw, 'raw');
	const betterExtended = createExtendedOperations(better, 'better');
	return [
		[
			'createMany + deleteMany',
			rawExtended.batchCreateDelete,
			betterExtended.batchCreateDelete,
		],
		['updateMany', rawExtended.updateMany, betterExtended.updateMany],
		['updateEach', rawExtended.updateEach, betterExtended.updateEach],
		['upsertMany', rawExtended.upsertMany, betterExtended.upsertMany],
		[
			'relation connect + reload',
			rawExtended.relationWrite,
			betterExtended.relationWrite,
		],
	] as const;
};

const transactionPairs = (raw: BenchmarkContext, better: BenchmarkContext) =>
	[
		[
			'simple transaction',
			() => rawSimpleTransaction(raw),
			() => betterSimpleTransaction(better),
		],
		[
			'multi-op transaction',
			() => rawMultiOpTransaction(raw),
			() => betterMultiOpTransaction(better),
		],
		[
			'read-only transaction',
			() => rawReadOnlyTransaction(raw),
			() => betterReadOnlyTransaction(better),
		],
	] as const;

const verifyParity = async () => {
	const raw = createBenchmarkContext();
	const better = createBenchmarkContext();
	try {
		for (const [name, rawOperation, betterOperation] of readPairs(
			raw,
			better,
		)) {
			try {
				deepStrictEqual(
					await betterOperation(),
					await rawOperation(),
					`Read parity failed: ${name}`,
				);
			} catch (error) {
				console.error(`Read parity scenario failed: ${name}`);
				throw error;
			}
		}
		for (const [name, rawOperation, betterOperation] of writePairs(
			raw,
			better,
		)) {
			try {
				deepStrictEqual(
					await betterOperation(),
					await rawOperation(),
					`Write parity failed: ${name}`,
				);
			} catch (error) {
				console.error(`Write parity scenario failed: ${name}`);
				throw error;
			}
		}

		for (const [name, rawOperation, betterOperation] of transactionPairs(
			raw,
			better,
		)) {
			try {
				deepStrictEqual(await rawOperation(), await betterOperation());
			} catch (error) {
				console.error(`Transaction parity scenario failed: ${name}`);
				throw error;
			}
		}
	} finally {
		raw.close();
		better.close();
	}
};

const registerPairs = (
	name: string,
	pairs: readonly (readonly [string, Operation, Operation])[],
) => {
	group(name, () => {
		summary(() => {
			for (const [scenario, raw, better] of pairs) {
				bench(`drizzle: ${scenario}`, async () =>
					do_not_optimize(await raw()),
				);
				bench(`better: ${scenario}`, async () =>
					do_not_optimize(await better()),
				);
			}
		});
	});
};

await verifyParity();
console.log('Full benchmark parity validation passed.');

if (Bun.env.BENCH_VERIFY_ONLY !== '1') {
	const raw = createBenchmarkContext();
	const better = createBenchmarkContext();

	registerPairs('full parity: reads', readPairs(raw, better));
	registerPairs('full parity: writes', writePairs(raw, better));
	registerPairs('full parity: transactions', transactionPairs(raw, better));

	await run();

	raw.close();
	better.close();
}
