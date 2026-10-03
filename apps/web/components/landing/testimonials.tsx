import Image from 'next/image';
import { Fragment } from 'react';

const TWEETS = [
	{
		name: 'Nick Venturi',
		handle: 'nickvnturi',
		text: 'finally i can stop copy pasting the same pagination helper into every new project',
		href: 'https://x.com/nickvnturi/status/2070693927745695860',
	},
	{
		name: 'Rohit Kashyap',
		handle: 'rohit_jsfreaky',
		text: 'wrap without replacing plus keep the raw sql escape hatch is the right call. most convenience layers die because they hide the tool underneath, so the day you hit a weird query you are stuck. leaving the door open is what makes a wrapper safe to adopt',
		href: 'https://x.com/rohit_jsfreaky/status/2070904932430152010',
	},
	{
		name: 'Savvas Papageorgiadis',
		handle: 'papsavas',
		text: 'Were wishing for something like this for a looong time',
		href: 'https://x.com/papsavas/status/2070777764752261139',
	},
	{
		name: 'Marc',
		handle: 'kumiko_rocks',
		text: 'request scoped context is the unlock for multi-tenant too. set the tenant once per request, every query hook reads the same context, and isolation stops being something each dev remembers on every query. exactly the glue you kept rewriting. nice work',
		href: 'https://x.com/kumiko_rocks/status/2071903053028979096',
	},
	{
		name: 'blemish',
		handle: 'blemish8651',
		text: 'This is sick asf\n\nSolution to the problems I had with drizzle too',
		href: 'https://x.com/blemish8651/status/2070847173558743439',
	},
	{
		name: 'Matin Tat',
		handle: 'werdoxdev',
		text: 'So does this solve the typing problem for when creating wrappers on drizzle stuff and you want to pass a custom "select" property? And still have it fully typed? If yes I\'m switching today.',
		href: 'https://x.com/werdoxdev/status/2070763649438830907',
	},
	{
		name: 'niloy',
		handle: 'nil_ooy',
		text: 'Having .explain() right on the query is the bit I like here. Less boilerplate is great; keeping the query plan within reach makes the abstraction easier to trust.',
		href: 'https://x.com/nil_ooy/status/2102696180572467518',
	},
	{
		name: 'Mark Lyck',
		handle: 'MarkLyck',
		text: '@DrizzleORM add this to the main ORM',
		href: 'https://x.com/MarkLyck/status/2070869880304218296',
	},
	{
		name: 'Marc Maceira',
		handle: 'marcmaceira',
		text: "Neat! Will be testing it out. It's definitely one of those things that keeps repeating for every project.",
		href: 'https://x.com/marcmaceira/status/2071030956060712975',
	},
	{
		name: 'Sérgio Carneiro',
		handle: 'sergioccarneiro',
		text: 'This would be much-welcome in Drizzle itself',
		href: 'https://x.com/sergioccarneiro/status/2070816719380103483',
	},
	{
		name: 'bushcubed',
		handle: 'bushcubed',
		text: 'typed json is sick',
		href: 'https://x.com/bushcubed/status/2102520561675194560',
	},
	{
		name: 'Binary Sniper',
		handle: 'MrBinarySniper',
		text: 'Wow. I already Love it.',
		href: 'https://x.com/MrBinarySniper/status/2071007298357723167',
	},
];

function TweetText({ text }: { text: string }) {
	return text.split(/(@\w+)/).map((part, index) =>
		part.startsWith('@') ? (
			<span key={index} className="text-brand">
				{part}
			</span>
		) : (
			<Fragment key={index}>{part}</Fragment>
		),
	);
}

export function Testimonials() {
	return (
		<section className="mx-auto max-w-6xl px-6 py-24">
			<h2 className="text-center text-3xl font-semibold tracking-tight">
				What developers are saying
			</h2>
			<div className="mt-12 columns-1 gap-4 sm:columns-2 lg:columns-3">
				{TWEETS.map((tweet) => (
					<a
						key={tweet.href}
						href={tweet.href}
						target="_blank"
						rel="noreferrer"
						className="border-fd-border hover:border-fd-foreground/25 mb-4 block break-inside-avoid rounded-xl border p-5 transition-colors"
					>
						<div className="flex items-center gap-3">
							<Image
								src={`/testimonials/${tweet.handle.toLowerCase()}.jpg`}
								alt=""
								width={40}
								height={40}
								className="size-10 rounded-full"
							/>
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold">
									{tweet.name}
								</p>
								<p className="text-fd-muted-foreground truncate text-sm">
									@{tweet.handle}
								</p>
							</div>
						</div>
						<p className="mt-4 text-[15px] leading-relaxed whitespace-pre-line">
							<TweetText text={tweet.text} />
						</p>
					</a>
				))}
			</div>
		</section>
	);
}
