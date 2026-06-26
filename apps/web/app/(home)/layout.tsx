import { HomeLayout } from 'fumadocs-ui/layouts/home';
import type { ReactNode } from 'react';
import { HomeSiteHeader } from '@/components/site-header';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<HomeLayout {...baseOptions()} slots={{ header: HomeSiteHeader }}>
			{children}
		</HomeLayout>
	);
}
