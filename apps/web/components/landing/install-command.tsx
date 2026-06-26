'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const MANAGERS = {
	npm: 'npm install better-drizzle drizzle-orm',
	pnpm: 'pnpm add better-drizzle drizzle-orm',
	bun: 'bun add better-drizzle drizzle-orm',
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
		<div className="flex w-full max-w-md items-center gap-2 rounded-xl border border-fd-border bg-fd-card/60 px-3 py-2 font-mono text-sm backdrop-blur">
			<div className="flex items-center gap-1 border-r border-fd-border pr-2">
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
			<code className="flex-1 truncate text-fd-foreground">
				<span className="select-none text-fd-muted-foreground">$ </span>
				{command}
			</code>
			<button
				type="button"
				onClick={copy}
				aria-label={copied ? 'Copied' : 'Copy install command'}
				className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
			>
				{copied ? (
					<Check className="size-4 text-brand" />
				) : (
					<Copy className="size-4" />
				)}
			</button>
		</div>
	);
}
