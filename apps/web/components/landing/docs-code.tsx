import { highlight } from 'fumadocs-core/highlight';
import {
	CodeBlockTab,
	CodeBlockTabs,
	CodeBlockTabsList,
	CodeBlockTabsTrigger,
} from 'fumadocs-ui/components/codeblock';

import { ShinyCodeBlock } from '@/components/shiny-code-block';

/**
 * Server-highlighted code rendered with the same block the docs use, so it
 * copies on click and plays the same sweep.
 */
export function DocsCode({
	code,
	lang = 'ts',
	title,
}: {
	code: string;
	lang?: string;
	title?: string;
}) {
	return highlight(code.trim(), {
		lang,
		engine: 'oniguruma',
		// Fumadocs' default themes (github-light/dark with defaultColor: false);
		// passing `themes` here drops defaultColor and pins the light colors.
		components: {
			pre: (props) => <ShinyCodeBlock {...props} title={title} />,
		},
	});
}

/** Same tabs as the docs' better-drizzle / Drizzle pairs, sharing their group. */
export function DocsCodeTabs({
	tabs,
}: {
	tabs: { label: string; code: string }[];
}) {
	return (
		<CodeBlockTabs defaultValue={tabs[0]?.label} groupId="orm" persist>
			<CodeBlockTabsList>
				{tabs.map((tab) => (
					<CodeBlockTabsTrigger key={tab.label} value={tab.label}>
						{tab.label}
					</CodeBlockTabsTrigger>
				))}
			</CodeBlockTabsList>
			{tabs.map((tab) => (
				<CodeBlockTab key={tab.label} value={tab.label}>
					<DocsCode code={tab.code} />
				</CodeBlockTab>
			))}
		</CodeBlockTabs>
	);
}
