'use client';

import { cn } from 'cnfast';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

const MANAGERS = {
	npm: 'npm i better-drizzle drizzle-orm@1.0.0-rc.4',
	pnpm: 'pnpm add better-drizzle drizzle-orm@1.0.0-rc.4',
	bun: 'bun add better-drizzle drizzle-orm@1.0.0-rc.4',
} as const;

type Manager = keyof typeof MANAGERS;

export function InstallCommand() {
	const [manager, setManager] = useState<Manager>('npm');
	const [copied, setCopied] = useState(false);
	const command = MANAGERS[manager];

	async function copy() {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// ignore
		}
	}

	return (
		<div className="border-fd-border bg-fd-card/60 inline-flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 font-mono text-sm backdrop-blur">
			<div className="border-fd-border flex items-center gap-1 border-r pr-2">
				{(Object.keys(MANAGERS) as Manager[]).map((key) => (
					<button
						key={key}
						type="button"
						onClick={() => setManager(key)}
						className={cn(
							'rounded-md px-2 py-1 text-xs transition-colors',
							key === manager
								? 'bg-brand/10 text-brand'
								: 'text-fd-muted-foreground hover:text-fd-foreground',
						)}
					>
						{key}
					</button>
				))}
			</div>
			<code className="text-fd-foreground min-w-0 overflow-x-auto whitespace-nowrap">
				<span className="text-fd-muted-foreground select-none">$ </span>
				{command}
			</code>
			<button
				type="button"
				onClick={copy}
				aria-label={copied ? 'Copied' : 'Copy install command'}
				className="text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
			>
				{copied ? (
					<Check className="text-brand size-4" />
				) : (
					<Copy className="size-4" />
				)}
			</button>
		</div>
	);
}
