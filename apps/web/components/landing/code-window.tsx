import { CopyButton } from "@/components/copy-button";
import { highlight } from "@/lib/highlight";
import { cn } from "@/lib/utils";

/**
 * A server-rendered "editor window": traffic-light header with an optional file
 * name and copy button, and a Shiki-highlighted body. Highlighting happens at
 * build/render time, so no syntax highlighter ships to the browser.
 */
export async function CodeWindow({
	code,
	lang = "ts",
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
				"bg-fd-card overflow-hidden rounded-xl border shadow-sm",
				accent ? "border-brand/40 ring-brand/10 ring-1" : "border-fd-border",
				className,
			)}
		>
			<div className="border-fd-border/80 flex items-center gap-2 border-b px-4 py-2.5">
				<span className="size-3 rounded-full bg-red-400/80" />
				<span className="size-3 rounded-full bg-yellow-400/80" />
				<span className="size-3 rounded-full bg-green-400/80" />
				{title ? (
					<span className="text-fd-muted-foreground ml-2 font-mono text-xs">
						{title}
					</span>
				) : null}
				<span className="-mr-1 ml-auto">
					<CopyButton value={code} />
				</span>
			</div>
			<div
				className="overflow-x-auto px-4 py-4 [&_pre]:!bg-transparent"
				// oxlint-disable-next-line react/no-danger -- Trusted, build-time Shiki output.
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		</div>
	);
}
