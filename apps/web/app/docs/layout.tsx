import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';

import { DialectSelect } from '@/components/dialect-select';
import { DocsSiteHeader } from '@/components/site-header';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			tree={source.getPageTree()}
			{...baseOptions()}
			links={[]}
			slots={{ header: DocsSiteHeader }}
			sidebar={{
				defaultOpenLevel: 1,
				banner: <DialectSelect key="dialect" />,
			}}
		>
			{children}
		</DocsLayout>
	);
}
