import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: SITE_NAME,
		short_name: SITE_NAME,
		description: SITE_DESCRIPTION,
		start_url: "/",
		display: "standalone",
		background_color: "#0a0a0a",
		theme_color: "#0a0a0a",
		icons: [{ src: "/icon.png", sizes: "any", type: "image/png" }],
	};
}
