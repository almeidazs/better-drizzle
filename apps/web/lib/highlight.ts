import { codeToHtml } from 'shiki';

/**
 * Server-side syntax highlighting for the marketing pages.
 *
 * Uses Shiki's dual-theme output so a single render works in both light and
 * dark mode without shipping a highlighter to the browser. The matching CSS
 * lives in `app/global.css` under `.shiki` (it swaps `--shiki-light` /
 * `--shiki-dark` based on the `.dark` class).
 */
export function highlight(code: string, lang = 'ts'): Promise<string> {
	return codeToHtml(code.trim(), {
		lang,
		themes: {
			light: 'github-light',
			dark: 'github-dark',
		},
		defaultColor: false,
	});
}
