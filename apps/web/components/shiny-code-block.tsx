'use client';

import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import { type ComponentProps, type MouseEvent, useState } from 'react';

/**
 * Fumadocs code block that copies its code when clicked anywhere and plays a
 * light sweep across it. The built-in copy button keeps copying on its own and
 * only triggers the sweep here.
 */
export function ShinyCodeBlock({ children, ...props }: ComponentProps<'pre'>) {
	const [flash, setFlash] = useState(0);

	const onClick = (event: MouseEvent<HTMLElement>) => {
		if (window.getSelection()?.toString()) return;
		if (!(event.target as HTMLElement).closest('button')) {
			const pre = event.currentTarget.querySelector('pre');
			if (!pre) return;
			const clone = pre.cloneNode(true) as HTMLElement;
			for (const node of clone.querySelectorAll('.nd-copy-ignore'))
				node.replaceWith('\n');
			navigator.clipboard
				?.writeText(clone.textContent ?? '')
				.catch(() => {});
		}
		setFlash((n) => n + 1);
	};

	return (
		<CodeBlock
			{...(props as ComponentProps<typeof CodeBlock>)}
			className={`cursor-pointer ${props.className ?? ''}`}
			onClick={onClick}
		>
			<Pre>{children}</Pre>
			{flash > 0 && (
				<span
					key={flash}
					aria-hidden="true"
					className="bd-code-flash"
					onAnimationEnd={() => setFlash(0)}
				/>
			)}
		</CodeBlock>
	);
}
