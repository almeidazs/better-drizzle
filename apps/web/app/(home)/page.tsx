import { cn } from 'cnfast';
import {
	ArrowRight,
	Bot,
	Blocks,
	BookOpenText,
	Calculator,
	Filter,
	Gauge,
	GitMerge,
	Network,
	Plus,
	RefreshCw,
	SearchCheck,
	ShieldCheck,
	Zap,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { SiMysql, SiPostgresql, SiSqlite } from 'react-icons/si';

import { JsonLd } from '@/components/json-ld';
import { DocsCode, DocsCodeTabs } from '@/components/landing/docs-code';
import { Faq } from '@/components/landing/faq';
import { InstallCommand } from '@/components/landing/install-command';
import { Testimonials } from '@/components/landing/testimonials';
import { Logo } from '@/components/logo';
import {
	GITHUB_URL,
	KEYWORDS,
	NPM_URL,
	SITE_DESCRIPTION,
	SITE_NAME,
	SITE_URL,
} from '@/lib/seo';

const FOOTER_LINKS = [
	{
		title: 'Documentation',
		links: [
			{ href: '/docs/getting-started', label: 'Get Started' },
			{ href: '/docs/why', label: 'Why better-drizzle' },
			{
				href: '/docs/guides/migrating-from-drizzle',
				label: 'Migrating from Drizzle',
			},
			{ href: '/docs/reference/model-api', label: 'API Reference' },
			{ href: '/docs/performance/benchmarks', label: 'Benchmarks' },
		],
	},
	{
		title: 'Guides',
		links: [
			{ href: '/docs/querying/relations', label: 'Relations' },
			{ href: '/docs/querying/pagination', label: 'Pagination' },
			{ href: '/docs/advanced/transactions', label: 'Transactions' },
			{ href: '/docs/plugins/writing-plugins', label: 'Writing Plugins' },
			{ href: '/docs/ai', label: 'AI & Agent Skills' },
		],
	},
	{
		title: 'Project',
		links: [
			{ href: '/docs/changelog', label: 'Changelog' },
			{ href: '/docs/guides/upgrading', label: 'Upgrading to 0.3' },
			{ href: `${GITHUB_URL}/issues`, label: 'Report an Issue' },
			{ href: NPM_URL, label: 'npm' },
			{ href: 'https://github.com/sponsors/almeidazs', label: 'Sponsor' },
		],
	},
];

const HERO_CODE = `const client = better(db); // your drizzle({ relations }) instance

// relation filters, nested includes, and counts - typed end to end
const authors = await client.users.findMany({
  where: { posts: { some: { published: true } } },
  include: {
    posts: { orderBy: { createdAt: 'desc' }, take: 3 },
    _count: { select: { posts: true } },
  },
});

authors[0].posts[0].title; // string
authors[0]._count.posts; // number

// relation writes run in one transaction
await client.posts.create({
  data: { title: 'Hello', author: { connect: { id: 1 } } },
});`;

const RAW_CODE = `import { and, count, desc, eq, getColumns, sql } from 'drizzle-orm';

const where = and(eq(posts.published, true), eq(users.active, true));

const [data, [{ total }]] = await Promise.all([
  db
    .select({
      ...getColumns(posts),
      author: { name: users.name },
      _count: {
        comments: sql<number>\`(
          select count(*) from \${comments}
          where \${comments.postId} = \${posts.id}
        )\`.mapWith(Number),
      },
    })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(where)
    .orderBy(desc(posts.createdAt))
    .limit(20)
    .offset(20),
  db
    .select({ total: count() })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(where),
]);

const pageCount = Math.ceil(total / 20);
const pagination = {
  page: 2,
  perPage: 20,
  total,
  pageCount,
  hasNext: 2 < pageCount,
  hasPrevious: true,
};`;

const BETTER_CODE = `const { data, pagination } = await client.posts.paginate({
  where: {
    published: true,
    author: { is: { active: true } },
  },
  include: {
    author: { select: { name: true } },
    _count: { select: { comments: true } },
  },
  orderBy: { createdAt: 'desc' },
  page: 2,
  perPage: 20,
});`;

const CACHE_TABS = [
	{
		label: 'better-drizzle',
		code: `const client = better(db, {
  plugins: [cache({ store: redis({ client: new Redis() }), ttl: '5m' })],
});

const feed = await client.posts.paginate({
  where: { published: true },
  include: { author: true },
  page: 1,
  perPage: 20,
  cache: true, // Redis after the first call
});

await client.posts.update({ where: { id }, data: { title } });
await client.users.update({ where: { id: authorId }, data: { name } });
// both writes invalidate the cached feed - no keys to track`,
	},
	{
		label: 'Drizzle',
		code: `const key = 'feed:published:page:1';
const cached = await redis.get(key);

const feed = cached
  ? JSON.parse(cached) // Dates come back as strings
  : await loadFeed({ page: 1, perPage: 20 });

if (!cached) await redis.set(key, JSON.stringify(feed), 'EX', 300);

await db.update(posts).set({ title }).where(eq(posts.id, id));
await redis.del(key); // and every other page, count, and list of posts

await db.update(users).set({ name }).where(eq(users.id, authorId));
// and every cached feed that shows this author`,
	},
];

const PLUGINS = [
	{
		name: 'Soft delete',
		body: 'delete() sets deletedAt. Reads skip deleted rows.',
		href: '/docs/plugins/soft-delete',
	},
	{
		name: 'Timestamps',
		body: 'createdAt and updatedAt filled on every write.',
		href: '/docs/plugins/timestamps',
	},
	{
		name: 'Zod',
		body: 'A schema per table, checked before each write.',
		href: '/docs/plugins/zod',
	},
	{
		name: 'Cache',
		body: 'Cached reads, cleared when the rows change. Experimental.',
		href: '/docs/plugins/cache',
	},
	{
		name: 'Rules',
		body: 'Stop unbounded reads and unsafe writes at runtime.',
		href: '/docs/plugins/rules',
	},
	{
		name: 'ESLint',
		body: 'The same rules, flagged in your editor.',
		href: '/docs/plugins/eslint',
	},
];

const FEATURES = [
	{
		icon: Network,
		title: 'Relations without N+1',
		href: '/docs/querying/relations',
		body: "Nested include and select load any depth with one query per relation node, per-parent take/skip, and _count totals in the same SQL. About 9x faster than Drizzle's own relational queries.",
	},
	{
		icon: Filter,
		title: 'Filter through relations',
		href: '/docs/querying/filters',
		body: 'posts: { some: { published: true } } - some, every, none, and is, typed from your Drizzle relations. JSONB paths and array operators on PostgreSQL. No subqueries by hand.',
	},
	{
		icon: GitMerge,
		title: 'Nested writes',
		href: '/docs/writing/relation-writes',
		body: 'connect, disconnect, and set relations inside create, update, and upsert, many-to-many included. The whole write runs in one transaction automatically.',
	},
	{
		icon: Zap,
		title: 'Bulk writes in one statement',
		href: '/docs/writing/crud',
		body: 'upsertMany as one native upsert, updateEach as a single UPDATE ... CASE, createMany with skipDuplicates and batching. No loops sending one query per row.',
	},
	{
		icon: Calculator,
		title: 'Atomic updates',
		href: '/docs/writing/atomic-updates',
		body: 'increment, decrement, multiply, and toggle without reading first. Append to PostgreSQL arrays or set one JSONB path with jsonb_set, all typed.',
	},
	{
		icon: BookOpenText,
		title: 'Pagination, done',
		href: '/docs/querying/pagination',
		body: 'paginate() returns total, pageCount, hasNext; cursor() returns next and previous cursors for feeds. Same { data, pagination } shape for both, no metadata math by hand.',
	},
	{
		icon: Gauge,
		title: 'Prepared reads',
		href: '/docs/querying/prepared-statements',
		body: 'Mark values with param() and call .prepare() on any read. Plugins and hooks set up once, then every execute() reuses the same statement with new values.',
	},
	{
		icon: RefreshCw,
		title: 'Transactions that hold up',
		href: '/docs/advanced/transactions',
		body: 'Nested savepoints, afterCommit / afterRollback callbacks, and automatic retries on deadlocks and serialization failures.',
	},
	{
		icon: Blocks,
		title: 'Plugins in the box',
		href: '/docs/plugins/overview',
		body: 'Soft delete, timestamps, Zod schemas, an experimental read cache, and runtime guardrails ship in the same package. Write your own with typed args and hooks.',
	},
];

const DATABASES = [
	{
		icon: SiPostgresql,
		iconClassName: 'text-[#336791] dark:text-[#6b9bd1]',
		name: 'PostgreSQL',
		body: 'The full API, plus typed JSONB path filters and updates, native array operators, ILIKE, and row locks.',
		href: '/docs/querying/jsonb',
	},
	{
		icon: SiMysql,
		iconClassName: 'text-[#00758F] dark:text-[#5fb3c9]',
		name: 'MySQL',
		body: 'The full repository API, with native ON DUPLICATE KEY upserts and row locks. Batch writes return counts.',
		href: '/docs/reference/support-matrix',
	},
	{
		icon: SiSqlite,
		iconClassName: 'text-[#0F80CC] dark:text-[#4ea8e6]',
		name: 'SQLite',
		body: 'The full API with RETURNING. A fast fit for local development, tests, and in-memory databases.',
		href: '/docs/getting-started',
	},
];

const AGENT_POINTS = [
	{
		icon: Bot,
		title: 'Skill pack in the repo',
		body: 'SKILL.md plus focused references for querying, writes, plugins, and troubleshooting, loaded only when a task needs them.',
	},
	{
		icon: ShieldCheck,
		title: 'Zero scripts, zero network',
		body: 'Plain Markdown. No install commands, no remote fetches, and explicit rules against prompt injection from your codebase.',
	},
	{
		icon: SearchCheck,
		title: 'Guardrails that catch mistakes',
		body: 'The ESLint plugin flags unbounded reads and unsafe writes in the editor, and the rules plugin enforces them at runtime.',
	},
];

const STATS = [
	{ value: '~5%', label: 'Median read overhead' },
	{ value: '< 5%', label: 'Write overhead' },
	{ value: '0', label: 'Codegen steps' },
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
				<div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 pt-20 pb-16 text-center lg:pt-28">
					<h1 className="bd-rise max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
						Drizzle ORM,{' '}
						<span className="text-brand">without the glue</span>
					</h1>
					<p
						className="bd-rise text-fd-muted-foreground mt-6 max-w-2xl text-lg text-pretty"
						style={{ animationDelay: '40ms' }}
					>
						Relation filters, nested includes, pagination, relation
						writes, and plugins on every table. Fully typed, on top
						of the Drizzle client you already have.
					</p>
					<div
						className="bd-rise mt-8 flex flex-wrap items-center justify-center gap-3"
						style={{ animationDelay: '80ms' }}
					>
						<Link
							href="/docs/getting-started"
							className="bg-brand text-brand-contrast inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
						>
							Get started
							<ArrowRight className="size-4" />
						</Link>
						<a
							href={GITHUB_URL}
							target="_blank"
							rel="noreferrer"
							className="border-fd-border hover:bg-fd-accent inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors"
						>
							<FaGithub className="size-4" />
							GitHub
						</a>
					</div>
					<div
						className="bd-rise mt-6 flex w-full justify-center"
						style={{ animationDelay: '120ms' }}
					>
						<InstallCommand />
					</div>
					<div
						className="bd-rise mt-14 w-full max-w-3xl text-left"
						style={{ animationDelay: '160ms' }}
					>
						<DocsCode code={HERO_CODE} title="authors.ts" />
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-6xl px-6 py-24">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="text-3xl font-semibold tracking-tight">
						The same query, without the glue
					</h2>
					<p className="text-fd-muted-foreground mt-4">
						A paginated feed with a relation filter, author data,
						and comment counts. Same result, fully typed on both
						sides.
					</p>
				</div>
				<div className="mt-12 grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
					<div>
						<div className="mb-3 flex items-baseline justify-between gap-4">
							<span className="font-semibold">Drizzle</span>
							<span className="text-fd-muted-foreground text-sm">
								2 queries, join, subquery, page math
							</span>
						</div>
						<DocsCode code={RAW_CODE} title="feed.ts" />
					</div>
					<div className="lg:sticky lg:top-24">
						<div className="mb-3 flex items-baseline justify-between gap-4">
							<span className="text-brand font-semibold">
								better-drizzle
							</span>
							<span className="text-fd-muted-foreground text-sm">
								one call, same result
							</span>
						</div>
						<DocsCode code={BETTER_CODE} title="feed.ts" />
					</div>
				</div>
			</section>

			<section className="bg-fd-card/30">
				<div className="mx-auto max-w-6xl px-6 py-20">
					<div className="mx-auto max-w-2xl text-center">
						<h2 className="text-3xl font-semibold tracking-tight">
							Everything you rewrite, once
						</h2>
						<p className="text-fd-muted-foreground mt-4">
							A consistent repository API per table - the patterns
							every service ends up re-implementing, generated
							from your schema and kept typed.
						</p>
					</div>
					<div className="border-fd-border bg-fd-border mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-3">
						{FEATURES.map((feature) => (
							<Link
								key={feature.title}
								href={feature.href}
								className="group bg-fd-background hover:bg-fd-accent/40 flex flex-col gap-3 p-6 transition-colors"
							>
								<feature.icon className="text-brand size-5" />
								<h3 className="flex items-center gap-1.5 font-semibold">
									{feature.title}
									<ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
								</h3>
								<p className="text-fd-muted-foreground text-sm">
									{feature.body}
								</p>
							</Link>
						))}
					</div>
				</div>
			</section>

			<section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-24 lg:grid-cols-2">
				<div>
					<h2 className="text-3xl font-semibold tracking-tight">
						Faster where it counts. Close everywhere else.
					</h2>
					<p className="text-fd-muted-foreground mt-4">
						Every number comes from API-parity benchmarks: raw
						Drizzle does the same work and returns the same shape.
						The batched relation loader beats Drizzle&rsquo;s own
						relational queries by an order of magnitude, and the
						wrapper costs a few microseconds on everything else.
					</p>
					<dl className="mt-10 grid grid-cols-3 gap-6">
						{STATS.map((stat) => (
							<div key={stat.label}>
								<dt className="text-fd-muted-foreground text-sm">
									{stat.label}
								</dt>
								<dd className="mt-1 text-2xl font-semibold tracking-tight">
									{stat.value}
								</dd>
							</div>
						))}
					</dl>
				</div>
				<div>
					<p className="text-fd-muted-foreground text-sm">
						Loading users with posts and comments
					</p>
					<p className="text-brand mt-2 text-6xl font-semibold tracking-tight">
						9.5× faster
					</p>
					<div className="mt-8 flex flex-col gap-5">
						<div>
							<div className="flex justify-between text-sm">
								<span className="font-medium">
									Drizzle db.query
								</span>
								<span className="text-fd-muted-foreground tabular-nums">
									3.94 ms
								</span>
							</div>
							<div className="bg-fd-muted-foreground/40 mt-2 h-3 w-full rounded-full" />
						</div>
						<div>
							<div className="flex justify-between text-sm">
								<span className="font-medium">
									better-drizzle
								</span>
								<span className="text-fd-muted-foreground tabular-nums">
									414 µs
								</span>
							</div>
							<div className="bg-brand mt-2 h-3 w-[10.5%] rounded-full" />
						</div>
					</div>
					<p className="text-fd-muted-foreground mt-8 text-sm">
						SQLite in-memory, same machine, both sides interleaved.{' '}
						<Link
							href="/docs/performance/benchmarks"
							className="text-brand font-medium hover:underline"
						>
							See every benchmark →
						</Link>
					</p>
				</div>
			</section>

			<section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
				<div>
					<h2 className="text-3xl font-semibold tracking-tight">
						Works with your existing database
					</h2>
					<p className="text-fd-muted-foreground mt-4">
						The dialect is read from your Drizzle instance. Keep
						your driver, keep your schema - the same client API runs
						on all three.
					</p>
					<Link
						href="/docs/reference/support-matrix"
						className="text-brand mt-6 inline-flex items-center gap-2 text-sm font-semibold hover:underline"
					>
						Compare dialect support
						<ArrowRight className="size-4" />
					</Link>
				</div>
				<div className="divide-fd-border border-fd-border divide-y border-y">
					{DATABASES.map((database) => (
						<Link
							key={database.name}
							href={database.href}
							className="group flex items-center gap-5 py-5"
						>
							<database.icon
								className={cn(
									'size-8 shrink-0',
									database.iconClassName,
								)}
							/>
							<div className="min-w-0 flex-1">
								<p className="font-semibold">{database.name}</p>
								<p className="text-fd-muted-foreground mt-1 text-sm">
									{database.body}
								</p>
							</div>
							<ArrowRight className="text-fd-muted-foreground group-hover:text-fd-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
						</Link>
					))}
				</div>
			</section>

			<section className="mx-auto max-w-6xl px-6 py-24">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="text-3xl font-semibold tracking-tight">
						Plugins that know your schema
					</h2>
					<p className="text-fd-muted-foreground mt-4">
						Plugins see every query and every relation. The cache
						knows which reads a write affects, even through an{' '}
						<code>include</code>, so you never manage keys.
					</p>
				</div>
				<div className="mt-12 grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
					<DocsCodeTabs tabs={CACHE_TABS} />
					<div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
						{PLUGINS.map((plugin) => (
							<Link
								key={plugin.href}
								href={plugin.href}
								className="group"
							>
								<p className="group-hover:text-brand flex items-center gap-1.5 font-semibold transition-colors">
									{plugin.name}
									<ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
								</p>
								<p className="text-fd-muted-foreground mt-1 text-sm">
									{plugin.body}
								</p>
							</Link>
						))}
					</div>
				</div>
				<p className="text-fd-muted-foreground mt-12 text-center text-sm">
					Need something else?{' '}
					<Link
						href="/docs/plugins/writing-plugins"
						className="text-brand font-medium hover:underline"
					>
						Write your own plugin →
					</Link>
				</p>
			</section>

			<section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-24 lg:grid-cols-2">
				<div>
					<h2 className="text-3xl font-semibold tracking-tight">
						Your AI agent writes the real API
					</h2>
					<p className="text-fd-muted-foreground mt-4">
						better-drizzle ships a first-party skill pack for coding
						agents. Point yours at it and it stops guessing: the
						right <code>select</code> shapes, dialect limits, and
						plugin APIs, straight from the source.
					</p>
					<div className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
						<Link
							href="/docs/ai"
							className="text-brand inline-flex items-center gap-2 text-sm font-semibold hover:underline"
						>
							Set up the skill
							<ArrowRight className="size-4" />
						</Link>
						<Link
							href="/docs/plugins/eslint"
							className="text-fd-muted-foreground hover:text-fd-foreground inline-flex items-center gap-2 text-sm font-semibold"
						>
							ESLint plugin
							<ArrowRight className="size-4" />
						</Link>
					</div>
				</div>
				<ul className="flex flex-col gap-6">
					{AGENT_POINTS.map((point) => (
						<li key={point.title} className="flex gap-4">
							<point.icon className="text-brand mt-0.5 size-5 shrink-0" />
							<div>
								<p className="font-semibold">{point.title}</p>
								<p className="text-fd-muted-foreground mt-1 text-sm">
									{point.body}
								</p>
							</div>
						</li>
					))}
				</ul>
			</section>

			<Testimonials />

			<Faq />

			<section className="mx-auto max-w-6xl px-6 py-28 text-center">
				<p className="text-fd-muted-foreground text-sm">
					better-drizzle is free and open source, kept going by
				</p>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
					<a
						href="https://neon.com"
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-2.5 opacity-90 transition-opacity hover:opacity-100"
					>
						<Image
							src="https://neon.com/brand/neon-logomark-dark-color.svg"
							alt=""
							className="size-7"
							width={28}
							height={28}
						/>
						<span className="text-xl font-semibold tracking-tight">
							Neon
						</span>
					</a>
					<a
						href="https://blog.victorbona.dev/"
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-2.5 opacity-90 transition-opacity hover:opacity-100"
					>
						<Image
							src="/sponsors/vicotrbb.jpg"
							alt=""
							className="size-7 rounded-full"
							width={28}
							height={28}
						/>
						<span className="text-xl font-semibold tracking-tight">
							Victor Bona
						</span>
					</a>
					<a
						href="https://github.com/sponsors/almeidazs"
						target="_blank"
						rel="noreferrer"
						className="border-fd-border text-fd-muted-foreground hover:border-brand hover:text-brand inline-flex h-11 items-center gap-2 rounded-full border border-dashed px-5 text-sm font-medium transition-colors"
					>
						<Plus className="size-4" />
						Your logo here
					</a>
				</div>
				<p className="text-fd-muted-foreground mt-8 text-sm">
					Using it at work?{' '}
					<a
						href="https://github.com/sponsors/almeidazs"
						target="_blank"
						rel="noreferrer"
						className="text-brand font-medium hover:underline"
					>
						Become a sponsor
					</a>{' '}
					and put your logo here.
				</p>
			</section>

			<footer>
				<div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-6 py-14 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
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
								href="https://x.com/almeidazs"
								target="_blank"
								rel="noreferrer"
								aria-label="X (Twitter)"
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
							</a>
						</nav>
					</div>
					<div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
						{FOOTER_LINKS.map((group) => (
							<div key={group.title}>
								<h3 className="text-fd-foreground text-lg font-semibold">
									{group.title}
								</h3>
								<div className="text-fd-muted-foreground mt-5 flex flex-col gap-3 text-sm">
									{group.links.map((link) =>
										link.href.startsWith('/') ? (
											<Link
												key={link.href}
												href={link.href}
												className="hover:text-fd-foreground transition-colors"
											>
												{link.label}
											</Link>
										) : (
											<a
												key={link.href}
												href={link.href}
												target="_blank"
												rel="noreferrer"
												className="hover:text-fd-foreground transition-colors"
											>
												{link.label}
											</a>
										),
									)}
								</div>
							</div>
						))}
					</div>
				</div>
				<div className="border-fd-border text-fd-muted-foreground mx-auto flex max-w-7xl flex-col gap-2 border-t px-6 py-6 text-xs sm:flex-row sm:justify-between">
					<p>
						Released under the{' '}
						<a
							href={`${GITHUB_URL}/blob/main/LICENSE`}
							target="_blank"
							rel="noreferrer"
							className="hover:text-fd-foreground underline underline-offset-2"
						>
							Apache-2.0 License
						</a>
						.
					</p>
					<p>
						Built on{' '}
						<a
							href="https://orm.drizzle.team"
							target="_blank"
							rel="noreferrer"
							className="hover:text-fd-foreground underline underline-offset-2"
						>
							Drizzle ORM
						</a>
						.
					</p>
				</div>
			</footer>
		</>
	);
}
