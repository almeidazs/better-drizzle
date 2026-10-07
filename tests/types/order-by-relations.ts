// Type-level assertions; checked by `bunx tsc --noEmit`, never executed.
import { createDb } from '../core/order-by-relations.fixture';

declare const db: ReturnType<typeof createDb>;

db.posts.findMany({
	orderBy: [
		{
			author: {
				profile: { bio: { direction: 'desc', nulls: 'last' } },
			},
		},
		{ author: { posts: { _count: 'asc' } } },
		{ id: 'asc' },
	],
});
db.authors.findMany({ orderBy: { posts: { _count: 'desc' } } });
db.posts.findMany({ orderBy: { tags: { _count: 'asc' } } });
db.authors.findMany({
	include: { posts: { orderBy: { author: { name: 'asc' } } } },
});
// @ts-expect-error To-many relations sort by _count only.
db.authors.findMany({ orderBy: { posts: { title: 'asc' } } });
// @ts-expect-error One relations take a field map, not _count.
db.posts.findMany({ orderBy: { author: { _count: 'asc' } } });
// @ts-expect-error Unknown orderBy keys are rejected.
db.posts.findMany({ orderBy: { writer: { name: 'asc' } } });
