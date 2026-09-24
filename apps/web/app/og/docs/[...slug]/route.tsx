import { notFound } from "next/navigation";

import { renderOgImage } from "@/lib/og";
import { source } from "@/lib/source";

export const revalidate = false;

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ slug: string[] }> },
) {
	const { slug } = await params;
	const page = source.getPage(slug.slice(0, -1));

	if (!page) notFound();

	return renderOgImage({
		eyebrow: "Docs",
		title: page.data.title,
		description: page.data.description,
	});
}

export function generateStaticParams() {
	return source.getPages().map((page) => ({
		slug: [...page.slugs, "image.png"],
	}));
}
