import path from 'node:path';

import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import {
	defineConfig,
	defineDocs,
	frontmatterSchema,
} from 'fumadocs-mdx/config';
import { transformerTwoslash } from 'fumadocs-twoslash';
import { createFileSystemTypesCache } from 'fumadocs-twoslash/cache-fs';
import { createTwoslasher } from 'twoslash';
import { z } from 'zod';

export const docs = defineDocs({
	dir: 'content/docs',
	docs: {
		// Compile each page on request instead of every page up front.
		async: true,
		schema: frontmatterSchema.extend({
			seoTitle: z.string().optional(),
			seoDescription: z.string().optional(),
		}),
	},
});

// Resolve `better-drizzle` to the repository source so hovers always match the
// current API, and type every sample against the docs schema.
const repo = path.resolve(process.cwd(), '../..');
const docsSchema = path.join(process.cwd(), 'lib/twoslash/schema.ts');
const src = (file: string) => [path.join(repo, 'src', file)];
const fromSchema = (name: string) =>
	`typeof import(${JSON.stringify(docsSchema)}).${name}`;

const GLOBALS = [
	'schema',
	'users',
	'posts',
	'comments',
	'tags',
	'postTags',
	'accounts',
];

const docsEnv = [
	...GLOBALS.map((name) => `declare const ${name}: ${fromSchema(name)};`),
	`declare const db: import('drizzle-orm/sqlite-core').BaseSQLiteDatabase<'async', unknown, ${fromSchema('schema')}>;`,
	`declare const client: import('better-drizzle').BetterDrizzleClient<${fromSchema('schema')}>;`,
].join('\n');

// Twoslash type-checks every sample with the full better-drizzle types, which is
// slow. It always runs in production builds; in `next dev` it is opt-in with
// `DOCS_TWOSLASH=1` so local page loads stay fast.
const TWOSLASH =
	process.env.NODE_ENV === 'production' || process.env.DOCS_TWOSLASH === '1';

// Every sample becomes a module (so its own `const client = ...` shadows the
// globals); `// ---cut---` hides this prefix from the rendered code. It is added
// inside the twoslasher, so a sample that falls back to plain highlighting
// never shows it.
const TWOSLASH_PREFIX =
	'/// <reference path="./docs-env.d.ts" />\nexport {};\n// ---cut---\n';
// fumadocs-twoslash does not forward `twoslashOptions` to a custom
// `twoslasher`, so the options live on the instance itself.
const twoslash = createTwoslasher({
	compilerOptions: {
		moduleResolution: 100, // Bundler
		module: 99, // ESNext
		target: 99,
		strict: true,
		skipLibCheck: true,
		paths: {
			'better-drizzle': src('index.ts'),
			'better-drizzle/plugins': src('plugins/index.ts'),
			'better-drizzle/eslint': src('plugins/eslint/index.ts'),
			'better-drizzle/rules': src('plugins/rules/index.ts'),
			'better-drizzle/soft-delete': src('plugins/soft-delete/index.ts'),
			'better-drizzle/timestamps': src('plugins/timestamps/index.ts'),
			'better-drizzle/zod': src('plugins/zod/index.ts'),
		},
	},
	extraFiles: {
		'docs-env.d.ts': docsEnv,
		'schema.ts': `export * from ${JSON.stringify(docsSchema)};`,
	},
	handbookOptions: {
		noErrors: true,
	},
});

export default defineConfig({
	mdxOptions: {
		rehypeCodeOptions: {
			// The default JS regex engine mis-colors the first line of the first
			// dual-theme block it highlights (every light token turns keyword red).
			engine: 'oniguruma',
			themes: {
				light: 'github-light',
				dark: 'github-dark',
			},
			transformers: [
				...(rehypeCodeDefaultOptions.transformers ?? []),
				...(TWOSLASH ? [twoslashTransformer()] : []),
			],
		},
	},
});

function twoslashTransformer() {
	return transformerTwoslash({
		explicitTrigger: false,
		twoslasher: (code, extension, options) =>
			twoslash(TWOSLASH_PREFIX + code, extension, options),
		typesCache: createFileSystemTypesCache(),
		// A sample that twoslash cannot process falls back to plain highlighting.
		onTwoslashError: () => {},
	});
}
