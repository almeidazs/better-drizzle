import type { MetadataRoute } from 'next';

import { source } from '@/lib/source';

const BASE = 'https://better-drizzle.com';

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		{ url: BASE, priority: 1 },
		...source.getPages().map((page) => ({ url: `${BASE}${page.url}` })),
	];
}
