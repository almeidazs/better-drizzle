import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{ userAgent: '*', allow: '/' },
			{
				userAgent: [
					'OAI-SearchBot',
					'GPTBot',
					'Claude-SearchBot',
					'Claude-User',
					'ClaudeBot',
				],
				allow: '/',
			},
		],
		sitemap: 'https://better-drizzle.com/sitemap.xml',
	};
}
