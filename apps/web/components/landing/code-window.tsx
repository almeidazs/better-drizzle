import { highlight } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import { CopyButton } from '@/components/copy-button';

/**
 * A server-rendered "editor window": traffic-light header with an optional file
 * name and copy button, and a Shiki-highlighted body. Highlighting happens at
 * build/render time, so no syntax highlighter ships to the browser.
 */
export async function CodeWindow({
	code,
	lang = 'ts',
	title,
	accent = false,
	className,
}: {
	code: string;
	lang?: string;
	title?: string;
	accent?: boolean;
	className?: string;
}) {
	const html = await highlight(code, lang);

	return (
		<div
			className={cn(
				'overflow-hidden rounded-xl border bg-fd-card shadow-sm',
				accent ? 'border-brand/40 ring-1 ring-brand/10' : 'border-fd-border',
				className,
			)}
		>
			<div className="flex items-center gap-2 border-b border-fd-border/80 px-4 py-2.5">
				<span className="size-3 rounded-full bg-red-400/80" />
				<span className="size-3 rounded-full bg-yellow-400/80" />
				<span className="size-3 rounded-full bg-green-400/80" />
				{title ? (
					<span className="ml-2 font-mono text-xs text-fd-muted-foreground">
						{title}
					</span>
				) : null}
				<span className="ml-auto -mr-1">
					<CopyButton value={code} />
				</span>
			</div>
			<div
				className="overflow-x-auto px-4 py-4 [&_pre]:!bg-transparent"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, build-time Shiki output
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		</div>
	);
}
