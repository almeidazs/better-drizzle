import { expect, test } from 'bun:test';

import { createDb } from './order-by-relations.fixture';

test('cursor explain rejects relation sorts on the first page', async () => {
	const db = createDb();
	await expect(
		db.posts
			.cursor({
				limit: 2,
				orderBy: [{ author: { name: 'asc' } }, { id: 'asc' }],
			})
			.explain(),
	).rejects.toMatchObject({ code: 'INVALID_ARGS' });
});
