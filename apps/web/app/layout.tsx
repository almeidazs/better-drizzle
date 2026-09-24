import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import {
	KEYWORDS,
	SITE_DESCRIPTION,
	SITE_NAME,
	SITE_TITLE,
	SITE_URL,
} from "@/lib/seo";

const geistSans = Geist({
	subsets: ["latin"],
	variable: "--font-sans",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
});

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: {
		default: SITE_TITLE,
		template: `%s - ${SITE_NAME}`,
	},
	description: SITE_DESCRIPTION,
	applicationName: SITE_NAME,
	keywords: KEYWORDS,
	authors: [{ name: "Almeida", url: "https://github.com/almeidazs" }],
	creator: "Almeida",
	publisher: SITE_NAME,
	category: "technology",
	alternates: { canonical: "/" },
	formatDetection: { email: false, address: false, telephone: false },
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-image-preview": "large",
			"max-snippet": -1,
			"max-video-preview": -1,
		},
	},
	icons: {
		icon: "/icon.png",
		shortcut: "/icon.png",
		apple: "/icon.png",
	},
	openGraph: {
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		url: SITE_URL,
		siteName: SITE_NAME,
		locale: "en_US",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
	},
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#ffffff" },
		{ media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
	],
};

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html
			lang="en"
			className={`${geistSans.variable} ${geistMono.variable}`}
			suppressHydrationWarning
		>
			<body className="flex min-h-screen flex-col">
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	);
}
