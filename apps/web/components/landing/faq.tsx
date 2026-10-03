import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

const QUESTIONS: { question: string; answer: ReactNode }[] = [
	{
		question: 'Why not just use Prisma?',
		answer: (
			<>
				You keep Drizzle: a TypeScript schema, SQL-first queries, no
				codegen, and no query engine. better-drizzle adds the
				repository-style API on top, and the raw Drizzle client stays
				available for anything it does not cover.
			</>
		),
	},
	{
		question: "Doesn't Drizzle already have db.query?",
		answer: (
			<>
				It does, for reads. better-drizzle gives every table one API for
				reads and writes: count, exists, paginate, and cursor, relation
				writes, bulk upserts, atomic updates, hooks, plugins, and
				transactions with retries. Its relation loader is also{' '}
				<Link
					href="/docs/performance/benchmarks"
					className="text-brand hover:underline"
				>
					about 9x faster
				</Link>{' '}
				than <code>db.query</code> on nested reads.
			</>
		),
	},
	{
		question: 'Does it hide the SQL?',
		answer: (
			<>
				No. Every read has <code>.explain()</code>, which returns the
				generated SQL, its params, and the database&rsquo;s plan. Raw
				SQL is one call away with <code>$raw</code>, and the Drizzle
				instance you wrapped keeps working next to it.
			</>
		),
	},
	{
		question: 'How much overhead does it add?',
		answer: (
			<>
				Around 5% on reads and under 5% on writes, measured against
				Drizzle doing the same work. Relation graphs are faster through
				the wrapper.{' '}
				<Link
					href="/docs/performance/benchmarks"
					className="text-brand hover:underline"
				>
					See the benchmarks
				</Link>
				.
			</>
		),
	},
	{
		question: 'Which Drizzle versions are supported?',
		answer: (
			<>
				better-drizzle 0.3 runs on Drizzle ORM 1.0 RC (
				<code>drizzle-orm@1.0.0-rc.4</code>). Projects still on Drizzle
				0.x can use better-drizzle 0.2.{' '}
				<Link
					href="/docs/guides/upgrading"
					className="text-brand hover:underline"
				>
					Upgrade guide
				</Link>
				.
			</>
		),
	},
	{
		question: 'Is it ready for production?',
		answer: (
			<>
				The core API is stable within 0.3.x. Breaking changes land in
				minor releases with an upgrade guide, and anything experimental,
				like the cache plugin, is marked as such.{' '}
				<Link
					href="/docs/reference/stability"
					className="text-brand hover:underline"
				>
					Stability policy
				</Link>
				.
			</>
		),
	},
];

export function Faq() {
	return (
		<section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
			<div>
				<h2 className="text-3xl font-semibold tracking-tight">
					Questions developers ask
				</h2>
				<p className="text-fd-muted-foreground mt-4">
					Straight from the replies on X. Something else?{' '}
					<a
						href="https://github.com/almeidazs/better-drizzle/issues"
						target="_blank"
						rel="noreferrer"
						className="text-brand hover:underline"
					>
						Open an issue
					</a>
					.
				</p>
			</div>
			<div className="divide-fd-border border-fd-border divide-y border-y">
				{QUESTIONS.map((item, index) => (
					// `name` makes the group exclusive: opening one closes the others.
					<details
						key={item.question}
						name="faq"
						open={index === 0}
						className="group py-6"
					>
						<summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-semibold [&::-webkit-details-marker]:hidden">
							{item.question}
							<ChevronDown className="text-fd-muted-foreground size-5 shrink-0 transition-transform group-open:rotate-180" />
						</summary>
						<p className="text-fd-muted-foreground mt-4 text-base leading-relaxed">
							{item.answer}
						</p>
					</details>
				))}
			</div>
		</section>
	);
}
