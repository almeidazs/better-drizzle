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

import { JsonLd } from '@/components/json-ld';
import { SITE_NAME, SITE_URL } from '@/lib/seo';
import { source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';

type PageParams = { params: Promise<{ slug?: string[] }> };
type DocsPageData = {
	body: ComponentType<{ components?: ReturnType<typeof getMDXComponents> }>;
	description?: string;
	full?: boolean;
	seoDescription?: string;
	seoTitle?: string;
	title: string;
	toc?: ComponentProps<typeof DocsPage>['toc'];
};

export default async function Page(props: PageParams) {
	const { slug } = await props.params;
	const page = source.getPage(slug);

	if (!page) notFound();

	const data = page.data as typeof page.data & DocsPageData;
	const MDX = data.body;
	const url = `${SITE_URL}${page.url}`;
	const breadcrumb = [
		{ name: SITE_NAME, url: SITE_URL },
		{ name: 'Documentation', url: `${SITE_URL}/docs` },
	];
	if (page.slugs.length > 0) breadcrumb.push({ name: data.title, url });

	return (
		<DocsPage toc={data.toc} full={data.full}>
			<JsonLd
				data={{
					'@context': 'https://schema.org',
					'@graph': [
						{
							'@type': 'TechArticle',
							headline: data.seoTitle ?? data.title,
							description:
								data.seoDescription ?? data.description,
							url,
							image: `${SITE_URL}/og/docs/${[...page.slugs, 'image.png'].join('/')}`,
							inLanguage: 'en',
							about: 'Drizzle ORM',
							isPartOf: { '@id': `${SITE_URL}/#website` },
							publisher: {
								'@type': 'Organization',
								name: SITE_NAME,
								url: SITE_URL,
							},
						},
						{
							'@type': 'BreadcrumbList',
							itemListElement: breadcrumb.map((item, index) => ({
								'@type': 'ListItem',
								position: index + 1,
								name: item.name,
								item: item.url,
							})),
						},
					],
				}}
			/>
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

	const data = page.data as typeof page.data & DocsPageData;
	const title = data.seoTitle ?? data.title;
	const description = data.seoDescription ?? data.description;
	const image = `/og/docs/${[...page.slugs, 'image.png'].join('/')}`;

	return {
		title,
		description,
		alternates: { canonical: page.url },
		openGraph: {
			title: `${title} - ${SITE_NAME}`,
			description,
			url: page.url,
			siteName: SITE_NAME,
			locale: 'en_US',
			type: 'article',
			images: [{ url: image, width: 1200, height: 630, alt: data.title }],
		},
		twitter: {
			card: 'summary_large_image',
			title: `${title} - ${SITE_NAME}`,
			description,
			images: [image],
		},
	};
}
