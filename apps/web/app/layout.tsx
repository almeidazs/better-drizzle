import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

const geistSans = Geist({
	subsets: ['latin'],
	variable: '--font-sans',
});

const geistMono = Geist_Mono({
	subsets: ['latin'],
	variable: '--font-mono',
});

export const metadata: Metadata = {
	title: {
		default: 'better-drizzle — Drizzle ORM, but better',
		template: '%s — better-drizzle',
	},
	description:
		'Minimal, type-safe repository helpers for Drizzle ORM. Keep Drizzle’s type-safety, drop the repetitive query glue: typed nested filters, relation loading, pagination, hooks, and plugins.',
	metadataBase: new URL('https://better-drizzle.com'),
	icons: {
		icon: '/icon.png',
		shortcut: '/icon.png',
		apple: '/icon.png',
	},
	openGraph: {
		title: 'better-drizzle — Drizzle ORM, but better',
		description:
			'Type-safe repository helpers for Drizzle ORM: nested filters, relation loading, pagination, hooks, and plugins — without giving up the metal.',
		url: 'https://better-drizzle.com',
		siteName: 'better-drizzle',
		type: 'website',
		images: [{ url: '/icon.png' }],
	},
	twitter: {
		card: 'summary_large_image',
		images: ['/icon.png'],
	},
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
