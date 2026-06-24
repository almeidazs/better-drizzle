import { source } from '@/lib/source';

export const revalidate = false;

/**
 * An llms.txt index of the documentation, so AI tools can discover and link to
 * pages. See https://llmstxt.org.
 */
export function GET() {
	const pages = source
		.getPages()
		.map((page) => {
			const description = page.data.description
				? `: ${page.data.description}`
				: '';
			return `- [${page.data.title}](https://better-drizzle.dev${page.url})${description}`;
		})
		.join('\n');

	const body = `# better-drizzle

> Minimal, type-safe repository helpers for Drizzle ORM. Keep Drizzle's type-safety, drop the repetitive query glue: typed nested filters, relation loading, pagination, hooks, and plugins.

## Documentation

${pages}
`;

	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
}
