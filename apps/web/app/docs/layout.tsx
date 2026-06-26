import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { DocsSiteHeader } from '@/components/site-header';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			tree={source.getPageTree()}
			{...baseOptions()}
			slots={{ header: DocsSiteHeader }}
			sidebar={{ defaultOpenLevel: 1 }}
		>
			{children}
		</DocsLayout>
	);
}
