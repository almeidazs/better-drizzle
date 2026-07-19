import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from 'fumadocs-ui/layouts/docs/page';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ComponentProps, ComponentType } from 'react';
import { source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';

type PageParams = { params: Promise<{ slug?: string[] }> };
type DocsPageData = {
	body: ComponentType<{ components?: ReturnType<typeof getMDXComponents> }>;
	description?: string;
	full?: boolean;
	title: string;
	toc?: ComponentProps<typeof DocsPage>['toc'];
};

export default async function Page(props: PageParams) {
	const { slug } = await props.params;
	const page = source.getPage(slug);

	if (!page) notFound();

	const data = page.data as typeof page.data & DocsPageData;
	const MDX = data.body;

	return (
		<DocsPage toc={data.toc} full={data.full}>
			<DocsTitle>{data.title}</DocsTitle>
			<DocsDescription>{data.description}</DocsDescription>
			<DocsBody>
				<MDX
					components={getMDXComponents({
						a: createRelativeLink(source, page),
					})}
				/>
			</DocsBody>
		</DocsPage>
	);
}

export function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(props: PageParams): Promise<Metadata> {
	const { slug } = await props.params;
	const page = source.getPage(slug);

	if (!page) notFound();

	return {
		title: page.data.title,
		description: page.data.description,
	};
}
