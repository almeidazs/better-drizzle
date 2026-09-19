'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

export function CopyButton({
	value,
	className,
	label = 'Copy',
}: {
	value: string;
	className?: string;
	label?: string;
}) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard can be unavailable (e.g. insecure context) — fail quietly
		}
	}

	return (
		<button
			type="button"
			onClick={copy}
			aria-label={copied ? 'Copied' : label}
			className={cn(
				'text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex size-8 items-center justify-center rounded-md transition-colors',
				className,
			)}
		>
			{copied ? (
				<Check className="text-brand size-4" />
			) : (
				<Copy className="size-4" />
			)}
		</button>
	);
}
