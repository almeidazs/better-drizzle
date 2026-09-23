import {
	ArrowRight,
	Blocks,
	BookOpenText,
	Filter,
	GitBranch,
	Layers,
	Lock,
	ScanSearch,
	ShieldCheck,
	Terminal,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { SiPostgresql } from 'react-icons/si';

import { JsonLd } from '@/components/json-ld';
import { CodeWindow } from '@/components/landing/code-window';
import { SponsorHeart } from '@/components/landing/database-logos';
import { InstallCommand } from '@/components/landing/install-command';
import { Logo } from '@/components/logo';
import {
	GITHUB_URL,
	KEYWORDS,
	NPM_URL,
	SITE_DESCRIPTION,
	SITE_NAME,
	SITE_URL,
} from '@/lib/seo';

const HERO_CODE = `import { better } from 'better-drizzle';

const client = better(db, { schema });

const authors = await client.users.findMany({
  where: {
    active: true,
    posts: { some: { published: true } },
  },
  include: {
    _count: { select: { posts: { where: { published: true } } } },
    posts: {
      where: { published: true },
      orderBy: [{ score: 'desc' }],
      take: 3,
    },
  },
  take: 20,
});

authors[0]._count.posts; // number
authors[0].posts[0].title; // string`;

const RAW_CODE = `import { and, desc, eq } from 'drizzle-orm';

const rows = await db
  .select({
    id: posts.id,
    title: posts.title,
    author: { id: users.id, name: users.name },
  })
  .from(posts)
  .innerJoin(users, eq(posts.authorId, users.id))
  .where(and(eq(posts.published, true), eq(users.active, true)))
  .orderBy(desc(posts.id))
  .limit(20);`;

const BETTER_CODE = `const rows = await client.posts.findMany({
  where: {
    published: true,
    author: { is: { active: true } },
  },
  select: {
    id: true,
    title: true,
    author: { select: { id: true, name: true } },
  },
  orderBy: [{ id: 'desc' }],
  take: 20,
});`;

const PLUGINS_CODE = `// one package — every plugin is a subpath export
import { better } from 'better-drizzle';
import { recommended, rules } from 'better-drizzle/rules';
import { softDelete } from 'better-drizzle/soft-delete';
import { timestamps } from 'better-drizzle/timestamps';
import { zod } from 'better-drizzle/zod';

const client = better(db, {
  schema,
  plugins: [
    rules(recommended({ noRawUnsafe: true })),
    zod({ validate: { create: true, update: true } }),
    timestamps(),
    softDelete({
      column: 'deletedAt',
      defaults: { visibility: 'without' },
    }),
  ],
});

await client.users.delete({
  where: { id: 1 },
  mode: 'soft',
}); // typed plugin arg

await client.users.findMany({ deleted: 'only' }); // typed filter
await client.users.restore({ where: { id: 1 } }); // plugin method
client.users.$zod.create; // generated Zod schema`;

const FEATURES = [
	{
		icon: Filter,
		title: 'Typed nested filters',
		body: 'Query across relations with some / every / none / is — inferred from your Drizzle schema, no subqueries by hand. Typed JSONB path filters on PostgreSQL.',
	},
	{
		icon: Layers,
		title: 'Batched relation loading',
		body: 'Nested include and select run one query per relation node — no N+1, no cartesian blowup. Project relation totals with _count without an extra round-trip.',
	},
	{
		icon: GitBranch,
		title: 'Relational writes',
		body: 'connect, disconnect, and exclusive set on create and update. Junction tables are inferred, and the whole write runs in one implicit transaction.',
	},
	{
		icon: BookOpenText,
		title: 'One pagination shape',
		body: 'Use paginate() for offset pages and cursor() for feed-style navigation. Both return { data, pagination } without rebuilding metadata by hand.',
	},
	{
		icon: ScanSearch,
		title: 'Query plans, inline',
		body: 'Every read helper is a thenable with .explain(). Get a structured, cross-dialect plan — including deferred relation stages — without running the query twice.',
	},
	{
		icon: Lock,
		title: 'Row locks',
		body: 'lock, skipLocked, and noWait on PostgreSQL and MySQL, with an opt-in guard that rejects locked reads outside a transaction.',
	},
	{
		icon: Blocks,
		title: 'First-class plugins',
		body: 'Rules, Zod, timestamps, and soft delete ship in the box — with transforms, lifecycle hooks, and typed operation args you can add yourself.',
	},
	{
		icon: ShieldCheck,
		title: 'Guardrails, static and runtime',
		body: 'better-drizzle/eslint catches what a linter can see; better-drizzle/rules enforces the rest at runtime — raw SQL, destructive writes, unbounded reads.',
	},
	{
		icon: Terminal,
		title: 'Raw SQL, when you want it',
		body: '$raw, $executeRaw, and guarded $rawUnsafe are first-class, with their own hooks. Drop to SQL only when it genuinely reads better.',
	},
];

const STATS = [
	{ value: '9.1×', label: 'faster relation loading at parity' },
	{ value: '< 9%', label: 'read latency overhead at parity' },
	{ value: '< 5%', label: 'write overhead at parity' },
	{ value: '0', label: 'codegen or build steps' },
];

const STRUCTURED_DATA = {
	'@context': 'https://schema.org',
	'@graph': [
		{
			'@type': 'WebSite',
			'@id': `${SITE_URL}/#website`,
			url: SITE_URL,
			name: SITE_NAME,
			description: SITE_DESCRIPTION,
			inLanguage: 'en',
		},
		{
			'@type': 'SoftwareSourceCode',
			'@id': `${SITE_URL}/#software`,
			name: SITE_NAME,
			description: SITE_DESCRIPTION,
			url: SITE_URL,
			codeRepository: GITHUB_URL,
			programmingLanguage: 'TypeScript',
			runtimePlatform: ['Node.js', 'Bun'],
			license: 'https://www.apache.org/licenses/LICENSE-2.0',
			keywords: KEYWORDS.join(', '),
			sameAs: [GITHUB_URL, NPM_URL],
		},
	],
};

export default function HomePage() {
	return (
		<>
			<JsonLd data={STRUCTURED_DATA} />
			<section className="relative overflow-hidden">
				<div className="bd-grid pointer-events-none absolute inset-0" />
				<div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-28">
					<div className="bd-rise flex flex-col items-start">
						<span className="border-fd-border bg-fd-card/60 text-fd-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur">
							<Logo className="w-10" />
							Drizzle ORM, but better
						</span>
						<h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
							Type-safe repository helpers for{' '}
							<span className="text-brand">Drizzle</span>.
						</h1>
						<p className="text-fd-muted-foreground mt-5 max-w-xl text-lg text-pretty">
							Keep Drizzle&rsquo;s type-safety. Drop the
							repetitive query glue. better-drizzle wraps your
							client and gives every table reads, writes, relation
							loading, pagination, hooks, and plugins — without
							giving up the metal.
						</p>
						<div className="mt-7 w-full">
							<InstallCommand />
						</div>
						<div className="mt-6 flex flex-wrap items-center gap-3">
							<Link
								href="/docs"
								className="bg-brand text-brand-contrast inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
							>
								Get started
								<ArrowRight className="size-4" />
							</Link>
							<a
								href="https://github.com/almeidazs/better-drizzle"
								target="_blank"
								rel="noreferrer"
								className="border-fd-border hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors"
							>
								<FaGithub className="size-4" />
								Star on GitHub
							</a>
						</div>
					</div>

					<div
						className="bd-rise lg:pl-4"
						style={{ animationDelay: '80ms' }}
					>
						<CodeWindow code={HERO_CODE} title="posts.ts" accent />
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-6xl px-6 py-20">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="text-3xl font-semibold tracking-tight">
						The same query, without the glue
					</h2>
					<p className="text-fd-muted-foreground mt-4">
						Both are fully typed. The difference is the dozens of
						these you write across a codebase — and which one
						you&rsquo;d rather read.
					</p>
				</div>
				<div className="mt-12 grid items-start gap-6 lg:grid-cols-2">
					<div className="flex flex-col gap-3">
						<span className="text-fd-muted-foreground text-sm font-medium">
							Raw Drizzle
						</span>
						<CodeWindow code={RAW_CODE} title="raw-drizzle.ts" />
					</div>
					<div className="flex flex-col gap-3">
						<span className="text-brand text-sm font-medium">
							better-drizzle
						</span>
						<CodeWindow
							code={BETTER_CODE}
							title="better-drizzle.ts"
							accent
						/>
					</div>
				</div>
			</section>

			<section className="bg-fd-card/30">
				<div className="mx-auto max-w-6xl px-6 py-20">
					<div className="max-w-2xl">
						<h2 className="text-3xl font-semibold tracking-tight">
							Everything you rewrite, once
						</h2>
						<p className="text-fd-muted-foreground mt-4">
							A consistent repository API per table — the patterns
							every service ends up re-implementing, generated
							from your schema and kept typed.
						</p>
					</div>
					<div className="border-fd-border bg-fd-border mt-12 grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-3">
						{FEATURES.map((feature) => (
							<div
								key={feature.title}
								className="bg-fd-background flex flex-col gap-3 p-6"
							>
								<feature.icon className="text-brand size-5" />
								<h3 className="font-semibold">
									{feature.title}
								</h3>
								<p className="text-fd-muted-foreground text-sm">
									{feature.body}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-6xl px-6 py-20">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="text-3xl font-semibold tracking-tight">
						Close to the metal
					</h2>
					<p className="text-fd-muted-foreground mt-4">
						Measured against raw Drizzle with fair, API-parity
						comparisons. Relation loading is <em>faster</em> through
						the wrapper; the rest stays close — and where it
						doesn&rsquo;t, the benchmarks say so.
					</p>
				</div>
				<div className="border-fd-border bg-fd-border mt-12 grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4">
					{STATS.map((stat) => (
						<div
							key={stat.label}
							className="bg-fd-background flex flex-col gap-2 p-6 text-center"
						>
							<span className="text-brand text-3xl font-semibold tracking-tight">
								{stat.value}
							</span>
							<span className="text-fd-muted-foreground text-sm">
								{stat.label}
							</span>
						</div>
					))}
				</div>
				<p className="text-fd-muted-foreground mt-6 text-center text-sm">
					Numbers from the repository&rsquo;s suite (SQLite
					in-memory).{' '}
					<Link
						href="/docs/performance/benchmarks"
						className="text-brand font-medium hover:underline"
					>
						See the full benchmarks →
					</Link>
				</p>
			</section>

			<section className="mx-auto max-w-6xl px-6 py-20">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="text-3xl font-semibold tracking-tight">
						Works with your existing database
					</h2>
					<p className="text-fd-muted-foreground mt-4">
						better-drizzle stays on top of Drizzle, so your driver
						choice does not change.
					</p>
				</div>
				<div className="border-fd-border bg-fd-border mt-10 grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4">
					<div className="bg-fd-background relative flex items-center gap-4 p-6">
						<div className="absolute top-3 right-4 inline-flex items-center gap-1 rounded-full border border-rose-200/70 bg-rose-50 px-2 py-1 text-[10px] font-semibold tracking-[0.16em] text-rose-700 uppercase dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
							OUR SPONSOR
							<SponsorHeart className="size-3 fill-current stroke-current" />
						</div>
						<Image
							src="https://neon.com/brand/neon-logomark-dark-color.svg"
							alt="Neon"
							className="size-8 shrink-0"
							width={32}
							height={32}
						/>
						<div className="pr-12">
							<p className="font-semibold">Neon</p>
							<p className="text-fd-muted-foreground text-sm">
								Serverless Postgres for modern Drizzle
								workflows.
							</p>
						</div>
					</div>
					<div className="bg-fd-background flex items-center gap-4 p-6">
						<SiPostgresql className="size-8 text-[#336791]" />
						<div>
							<p className="font-semibold">PostgreSQL</p>
							<p className="text-fd-muted-foreground text-sm">
								Typed delegates on top of the Drizzle pg stack.
							</p>
						</div>
					</div>
					<div className="bg-fd-background flex items-center gap-4 p-6">
						<svg
							viewBox="0 0 170 170"
							className="size-8 shrink-0"
							aria-hidden="true"
						>
							<path
								d="m103.096 71.5961c-.057.7219-.091 1.191-.091 1.191s-2.189 14.7578-4.7948 19.1617c-.4122.6981.0449 3.5653 1.1953 7.8121.6725-1.1629 3.5115-6.1371 4.0815-7.7398.642-1.8121.777-2.3313.777-2.3313s-1.557 8.0114-4.112 12.6862c.56 1.89 1.229 3.979 1.986 6.212.968-1.698 3.285-5.809 3.795-7.235.103-.293.19-.542.268-.77.025.137.05.274.075.411-.585 2.482-1.734 6.801-3.307 9.992 3.49 18.165 15.393 42.445 27.596 53.278l-79.6048 0c-5.3352 0-9.7004-4.366-9.7004-9.701l0-87.7892c0-5.3347 4.3652-9.7 9.7004-9.7l52.4298 0c-.378 4.5762-.504 9.6391-.294 14.5223"
								fill="#0f80cc"
							/>
							<path
								d="m99.4055 99.7609c.6725-1.1629 3.5115-6.1371 4.0815-7.7398.642-1.8121.777-2.3313.777-2.3313s-1.557 8.0114-4.112 12.6862c.56 1.89 1.229 3.979 1.986 6.212.885-1.553 2.896-5.12 3.623-6.81.027.319.054.638.082.954-.644 2.475-1.622 5.715-2.874 8.254 3.214 16.725 13.559 38.625 24.704 50.448l-76.7128 0c-3.7883 0-6.8711-3.082-6.8711-6.871l0-81.3841c17.3738 6.668 38.323 12.7633 56.3529 12.502-.6693 2.5812-1.4315 4.9152-2.2318 6.2679-.4122.6981.0449 3.5653 1.1953 7.8121"
								fill="#97d9f6"
							/>
							<path
								d="m149.133 167.137c-5.452 4.862-12.053 2.909-18.568-2.873-.967-.859-1.932-1.812-2.892-2.83-11.145-11.823-21.49-33.723-24.704-50.448 1.252-2.539 2.23-5.779 2.874-8.254.165-.635.314-1.231.433-1.738.283-1.1999.435-1.978.435-1.978s-.1.3781-.51 1.567c-.078.228-.165.477-.268.77-.044.121-.105.268-.172.425-.727 1.69-2.738 5.257-3.623 6.81-.757-2.233-1.426-4.322-1.986-6.212 2.555-4.6748 4.112-12.6862 4.112-12.6862s-.135.5192-.777 2.3313c-.57 1.6027-3.409 6.5769-4.0815 7.7398-1.1504-4.2468-1.6075-7.114-1.1953-7.8121.8003-1.3527 1.5625-3.6867 2.2318-6.2679 1.512-5.8149 2.563-12.8938 2.563-12.8938s.034-.4691.091-1.191c-.21-4.8832-.084-9.9461.294-14.5223.501-6.0578 1.444-11.2617 2.646-14.0468l.816.4449c-1.765 5.4871-2.482 12.6781-2.168 20.9711.475 12.6761 3.392 27.9629 8.782 43.896 9.106 24.052 21.74 43.35 33.303 52.566-10.539-9.518-24.803-40.327-29.073-51.736-4.781-12.776-8.169-24.7651-10.211-36.2518 3.523 10.7687 14.914 15.3976 14.914 15.3976s5.587 6.8903 12.116 16.7342c-3.911-.892-10.333-2.419-12.484-3.323-3.173-1.331-4.028-1.785-4.028-1.785s10.278 6.259 19.096 9.093c12.127 19.1 25.339 46.234 12.034 58.103"
								fill="#003b57"
							/>
						</svg>
						<div>
							<p className="font-semibold">SQLite</p>
							<p className="text-fd-muted-foreground text-sm">
								Fast local dev and benchmark-friendly in-memory
								setups.
							</p>
						</div>
					</div>
					<div className="bg-fd-background flex items-center gap-4 p-6">
						<svg
							viewBox="0 0 256 252"
							className="size-8 shrink-0 text-[#00546B] dark:text-[#F0F0F0]"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M235.648 194.212c-13.918-.347-24.705 1.045-33.752 4.872-2.61 1.043-6.786 1.044-7.134 4.35 1.392 1.392 1.566 3.654 2.784 5.567 2.09 3.479 5.741 8.177 9.047 10.614 3.653 2.783 7.308 5.566 11.134 8.002 6.786 4.176 14.442 6.611 21.053 10.787 3.829 2.434 7.654 5.568 11.482 8.177 1.914 1.39 3.131 3.654 5.568 4.523v-.521c-1.219-1.567-1.567-3.828-2.784-5.568-1.738-1.74-3.48-3.306-5.22-5.046-5.045-6.784-11.308-12.7-18.093-17.571-5.567-3.828-17.747-9.047-20.008-15.485 0 0-.175-.173-.348-.347 3.827-.348 8.35-1.74 12.005-2.784 5.915-1.567 11.308-1.218 17.398-2.784 2.783-.696 5.567-1.566 8.35-2.436v-1.565c-3.13-3.132-5.392-7.307-8.698-10.265-8.873-7.657-18.617-15.137-28.707-21.4-5.394-3.48-12.354-5.742-18.095-8.699-2.086-1.045-5.567-1.566-6.784-3.306-3.133-3.827-4.873-8.872-7.134-13.396-5.044-9.57-9.917-20.182-14.267-30.272-3.13-6.786-5.044-13.572-8.872-19.834-17.92-29.577-37.406-47.497-67.33-65.07-6.438-3.653-14.093-5.219-22.27-7.132-4.348-.175-8.699-.522-13.048-.697-2.784-1.218-5.568-4.523-8.004-6.089C34.006 4.573 8.429-8.996 1.122 8.924c-4.698 11.308 6.96 22.442 10.96 28.185 2.96 4.001 6.786 8.524 8.874 13.048 1.218 2.956 1.565 6.09 2.783 9.221 2.785 7.653 5.393 16.18 9.048 23.314 1.914 3.653 4.001 7.48 6.437 10.786 1.392 1.913 3.827 2.784 4.35 5.915-2.435 3.48-2.61 8.7-4.003 13.049-6.263 19.66-3.826 44.017 5.046 58.457 2.783 4.348 9.395 13.92 18.268 10.265 7.83-3.131 6.09-13.048 8.35-21.747.524-2.09.176-3.48 1.219-4.872v.349c2.436 4.87 4.871 9.569 7.133 14.44 5.394 8.524 14.788 17.398 22.617 23.314 4.177 3.13 7.482 8.524 12.702 10.438v-.523h-.349c-1.044-1.566-2.61-2.261-4.001-3.48-3.131-3.13-6.612-6.958-9.047-10.438-7.306-9.744-13.745-20.53-19.486-31.665-2.783-5.392-5.22-11.308-7.481-16.701-1.045-2.09-1.045-5.22-2.784-6.263-2.61 3.827-6.437 7.133-8.351 11.83-3.304 7.481-3.653 16.702-4.871 26.27-.696.176-.349 0-.697.35-5.566-1.394-7.48-7.134-9.569-12.006-5.22-12.352-6.09-32.186-1.565-46.452 1.218-3.654 6.438-15.136 4.35-18.616-1.044-3.306-4.525-5.22-6.438-7.829-2.261-3.306-4.698-7.48-6.263-11.135-4.176-9.743-6.264-20.53-10.787-30.273-2.088-4.524-5.74-9.22-8.699-13.396-3.305-4.697-6.959-8.004-9.569-13.571-.869-1.913-2.088-5.045-.696-7.133.348-1.392 1.043-1.913 2.436-2.261 2.262-1.915 8.7.521 10.96 1.565 6.438 2.608 11.831 5.046 17.225 8.699 2.435 1.74 5.045 5.046 8.176 5.916h3.654c5.568 1.217 11.83.348 17.05 1.913 9.222 2.957 17.572 7.307 25.054 12.005 22.792 14.44 41.58 34.97 54.282 59.501 2.088 4 2.957 7.656 4.871 11.83 3.655 8.526 8.178 17.225 11.83 25.576 3.654 8.176 7.133 16.528 12.353 23.314 2.61 3.652 13.048 5.567 17.746 7.481 3.48 1.565 8.874 2.958 12.005 4.871 5.915 3.652 11.83 7.83 17.398 11.83 2.784 2.088 11.482 6.438 12.005 9.917z" />
							<path d="M58.186 43.022c-2.957 0-5.044.35-7.132.871v.348h.348c1.393 2.784 3.827 4.698 5.566 7.133 1.393 2.783 2.61 5.568 4.003 8.352.173-.175.347-.348.347-.348 2.437-1.741 3.654-4.524 3.654-8.7-1.044-1.217-1.218-2.435-2.088-3.653-1.043-1.741-3.306-2.61-4.698-4.003z" />
						</svg>
						<div>
							<p className="font-semibold">MySQL</p>
							<p className="text-fd-muted-foreground text-sm">
								Same API surface on top of mysql-backed Drizzle
								clients.
							</p>
						</div>
					</div>
				</div>
			</section>

			<section className="bg-fd-card/30">
				<div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
					<div>
						<h2 className="text-3xl font-semibold tracking-tight">
							Plugins do the cross-cutting work
						</h2>
						<p className="text-fd-muted-foreground mt-4">
							Rules, Zod, timestamps, and soft delete ship as
							official plugins — all inside the one{' '}
							<code className="text-brand">better-drizzle</code>{' '}
							package. They add typed arguments, rewrite
							operations, and extend delegates, so behavior lives
							in one place instead of every write.
						</p>
						<div className="mt-6 flex flex-wrap gap-3">
							<Link
								href="/docs/plugins/overview"
								className="border-fd-border hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors"
							>
								Browse plugins
								<ArrowRight className="size-4" />
							</Link>
							<Link
								href="/docs/plugins/writing-plugins"
								className="text-brand inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold hover:underline"
							>
								Write your own
							</Link>
						</div>
					</div>
					<CodeWindow code={PLUGINS_CODE} title="db.ts" />
				</div>
			</section>

			<section className="bg-[#111111] text-white">
				<div className="mx-auto max-w-6xl px-6 py-24">
					<div className="mx-auto max-w-2xl text-center">
						<h2 className="text-4xl font-semibold tracking-tight">
							Our Sponsors
						</h2>
						<p className="mt-4 text-lg text-white/72">
							Thanks to companies backing better-drizzle and the
							work around it.
						</p>
					</div>
					<div className="mt-12 flex justify-center">
						<a
							href="https://neon.com"
							target="_blank"
							rel="noreferrer"
							className="group inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-4 transition-colors duration-200 hover:border-[#3cf2b2]/40 hover:bg-white/[0.06]"
						>
							<Image
								src="https://neon.com/brand/neon-logomark-dark-color.svg"
								alt="Neon"
								className="size-10 shrink-0"
								width={40}
								height={40}
							/>
							<span className="text-2xl font-semibold tracking-tight text-white">
								Neon
							</span>
						</a>
					</div>
					<div className="mt-8 flex justify-center">
						<a
							href="https://github.com/sponsors/almeidazs"
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center justify-center rounded-lg border border-white/12 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.1]"
						>
							Become a sponsor
						</a>
					</div>
				</div>
			</section>

			<footer>
				<div className="mx-auto grid max-w-7xl gap-12 px-6 py-14 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
					<div>
						<Logo className="w-28" />
						<p className="text-fd-muted-foreground mt-5 max-w-xs text-sm">
							ORM, but better.
						</p>
						<nav className="text-fd-muted-foreground mt-6 flex items-center gap-5">
							<a
								href="https://github.com/almeidazs/better-drizzle"
								target="_blank"
								rel="noreferrer"
								aria-label="GitHub"
								className="hover:text-fd-foreground transition-colors"
							>
								<FaGithub className="size-6" />
							</a>
							<a
								href="https://discord.gg/yfjTbVXMW4"
								target="_blank"
								rel="noreferrer"
								aria-label="Discord"
								className="hover:text-fd-foreground transition-colors"
							>
								<FaDiscord className="size-6" />
							</a>
							<a
								href="https://x.com/drizzleorm"
								target="_blank"
								rel="noreferrer"
								className="hover:text-fd-foreground transition-colors"
							>
								<svg
									viewBox="0 0 24 24"
									className="size-6"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M18.901 1.153h3.68l-8.04 9.19L24 22.847h-7.406l-5.8-7.584-6.639 7.584H.474l8.6-9.83L0 1.153h7.594l5.243 6.932 6.064-6.932Zm-1.291 19.492h2.039L6.486 3.24H4.298l13.312 17.405Z" />
								</svg>
								<span className="sr-only">X</span>
							</a>
						</nav>
					</div>
					<div className="grid gap-10 sm:grid-cols-3">
						<div>
							<h3 className="text-fd-foreground text-lg font-semibold">
								Documentation
							</h3>
							<div className="text-fd-muted-foreground mt-5 flex flex-col gap-3 text-sm">
								<Link
									href="/docs/getting-started"
									className="hover:text-fd-foreground"
								>
									Get Started
								</Link>
								<Link
									href="/docs/writing/crud"
									className="hover:text-fd-foreground"
								>
									Manage Data
								</Link>
								<Link
									href="/docs/plugins/overview"
									className="hover:text-fd-foreground"
								>
									Plugins
								</Link>
								<Link
									href="/docs/performance/benchmarks"
									className="hover:text-fd-foreground"
								>
									Benchmarks
								</Link>
							</div>
						</div>
						<div>
							<h3 className="text-fd-foreground text-lg font-semibold">
								Resources
							</h3>
							<div className="text-fd-muted-foreground mt-5 flex flex-col gap-3 text-sm">
								<a
									href="https://github.com/almeidazs/better-drizzle"
									target="_blank"
									rel="noreferrer"
									className="hover:text-fd-foreground"
								>
									GitHub
								</a>
								<a
									href="https://www.npmjs.com/package/better-drizzle"
									target="_blank"
									rel="noreferrer"
									className="hover:text-fd-foreground"
								>
									npm
								</a>
							</div>
						</div>
						<div>
							<h3 className="text-fd-foreground text-lg font-semibold">
								Learn
							</h3>
							<div className="text-fd-muted-foreground mt-5 flex flex-col gap-3 text-sm">
								<Link
									href="/docs/querying/reads"
									className="hover:text-fd-foreground"
								>
									Querying
								</Link>
								<Link
									href="/docs/advanced/transactions"
									className="hover:text-fd-foreground"
								>
									Transactions
								</Link>
								<Link
									href="/docs/plugins/writing-plugins"
									className="hover:text-fd-foreground"
								>
									Write Plugins
								</Link>
							</div>
						</div>
					</div>
				</div>
			</footer>
		</>
	);
}
