'use client';

import { useDocsLayout } from 'fumadocs-ui/layouts/docs';
import { useHomeLayout } from 'fumadocs-ui/layouts/home';
import { SidebarIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FaGithub } from 'react-icons/fa';
import { Logo } from '@/components/logo';
import { formatGithubStars } from '@/lib/github';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
	{ href: '/docs', label: 'Documentation' },
	{ href: '/docs/plugins/overview', label: 'Plugins' },
	{ href: '/docs/performance/benchmarks', label: 'Benchmarks' },
];

function NavLinks() {
	const pathname = usePathname();

	return (
		<nav className="hidden items-center gap-1 md:flex">
			{NAV_LINKS.map((link) => {
				const active =
					link.href === '/docs'
						? pathname.startsWith('/docs')
						: pathname === link.href ||
							pathname.startsWith(`${link.href}/`);

				return (
					<Link
						key={link.href}
						href={link.href}
						className={cn(
							'rounded-md px-3 py-2 text-sm font-medium transition-colors',
							active
								? 'text-fd-foreground'
								: 'text-fd-muted-foreground hover:text-fd-foreground',
						)}
					>
						{link.label}
					</Link>
				);
			})}
		</nav>
	);
}

function GithubStarsButton({ stars }: { stars: number }) {
	return (
		<a
			href="https://github.com/almeidazs/better-drizzle"
			target="_blank"
			rel="noreferrer"
			aria-label="better-drizzle GitHub"
			className="inline-flex h-9 items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-3 text-sm font-semibold text-fd-foreground transition-colors hover:border-[#686868] hover:bg-white/[0.06]"
		>
			<FaGithub className="size-4" />
			<span>{formatGithubStars(stars)}</span>
		</a>
	);
}

function GithubStarsCompactButton({ stars }: { stars: number }) {
	return (
		<a
			href="https://github.com/almeidazs/better-drizzle"
			target="_blank"
			rel="noreferrer"
			aria-label="better-drizzle GitHub"
			className="inline-flex h-9 items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-2.5 text-sm font-semibold text-fd-foreground transition-colors hover:border-[#686868] hover:bg-white/[0.06]"
		>
			<FaGithub className="size-4" />
			<span>{formatGithubStars(stars)}</span>
		</a>
	);
}

function useGithubStars() {
	const [stars, setStars] = useState(0);

	useEffect(() => {
		let cancelled = false;

		fetch('https://api.github.com/repos/almeidazs/better-drizzle', {
			headers: { Accept: 'application/vnd.github+json' },
		})
			.then((response) => (response.ok ? response.json() : null))
			.then((data: { stargazers_count?: number } | null) => {
				if (!cancelled && data?.stargazers_count != null)
					setStars(data.stargazers_count);
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	}, []);

	return stars;
}

function HeaderShell({
	children,
	right,
	className,
}: {
	children?: React.ReactNode;
	right?: React.ReactNode;
	className?: string;
}) {
	const stars = useGithubStars();

	return (
		<header
			className={cn(
				'sticky top-0 z-40 min-w-0 border-b border-fd-border/70 bg-fd-background/80 backdrop-blur-lg',
				className,
			)}
		>
			<div className="mx-auto flex h-14 min-w-0 max-w-6xl items-center gap-3 px-4 sm:px-6">
				<Link href="/" className="shrink-0">
					<Logo className="w-28 sm:w-32" />
				</Link>
				<NavLinks />
				<div className="ml-auto flex min-w-0 items-center gap-2">
					{children}
					<div className="hidden sm:block">
						<GithubStarsButton stars={stars} />
					</div>
					<div className="sm:hidden">
						<GithubStarsCompactButton stars={stars} />
					</div>
					{right}
				</div>
			</div>
		</header>
	);
}

export function HomeSiteHeader() {
	const { slots } = useHomeLayout();

	return (
		<HeaderShell
			right={
				<>
					<div className="hidden lg:block">
						{slots.searchTrigger && (
							<slots.searchTrigger.full
								hideIfDisabled
								className="w-full max-w-[220px] rounded-full ps-2.5"
							/>
						)}
					</div>
					{slots.themeSwitch && <slots.themeSwitch />}
				</>
			}
		/>
	);
}

export function DocsSiteHeader() {
	const { slots } = useDocsLayout();

	return (
		<HeaderShell
			className="[grid-area:header]"
			right={
				<>
					<div className="hidden lg:block">
						{slots.searchTrigger && (
							<slots.searchTrigger.full
								hideIfDisabled
								className="w-full max-w-[220px] rounded-full ps-2.5"
							/>
						)}
					</div>
					{slots.themeSwitch && <slots.themeSwitch />}
					<div className="flex items-center md:hidden">
						{slots.searchTrigger && (
							<slots.searchTrigger.sm
								hideIfDisabled
								className="p-2"
							/>
						)}
						<slots.sidebar.trigger className="inline-flex size-9 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground">
							<SidebarIcon className="size-5" />
						</slots.sidebar.trigger>
					</div>
				</>
			}
		/>
	);
}
