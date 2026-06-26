import { cache } from 'react';

const REPO_API = 'https://api.github.com/repos/almeidazs/better-drizzle';

export const getGithubStars = cache(async () => {
	try {
		const response = await fetch(REPO_API, {
			headers: { Accept: 'application/vnd.github+json' },
			next: { revalidate: 3600 },
		});

		if (!response.ok) return 0;

		const data = (await response.json()) as { stargazers_count?: number };
		return data.stargazers_count ?? 0;
	} catch {
		return 0;
	}
});

export function formatGithubStars(stars: number) {
	if (stars >= 1000) return `${Math.floor(stars / 100) / 10}k`;
	return String(stars);
}
