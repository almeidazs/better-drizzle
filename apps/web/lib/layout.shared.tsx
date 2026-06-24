import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Wordmark } from '@/components/logo';

/**
 * Shared layout options for both the docs shell and the home/landing shell, so
 * the navbar (logo, links, GitHub, search, theme toggle) stays consistent.
 */
export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			title: <Wordmark />,
			transparentMode: 'top',
		},
		githubUrl: 'https://github.com/almeidazs/better-drizzle',
		links: [
			{
				text: 'Documentation',
				url: '/docs',
				active: 'nested-url',
			},
			{
				text: 'Plugins',
				url: '/docs/plugins/overview',
			},
			{
				text: 'Benchmarks',
				url: '/docs/performance/benchmarks',
			},
		],
	};
}
