import { OG_SIZE, renderOgImage } from "@/lib/og";

export const alt = "better-drizzle - Type-safe Repository API for Drizzle ORM";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
	return renderOgImage({
		eyebrow: "Drizzle ORM",
		title: "Drizzle ORM, but better.",
		description:
			"findMany, nested relations, pagination, upsert, transactions, hooks, and plugins for PostgreSQL, MySQL, and SQLite.",
	});
}
