import {
	defineConfig,
	defineDocs,
	frontmatterSchema,
} from 'fumadocs-mdx/config';
import { z } from 'zod';

export const docs = defineDocs({
	dir: 'content/docs',
	docs: {
		schema: frontmatterSchema.extend({
			seoTitle: z.string().optional(),
			seoDescription: z.string().optional(),
		}),
	},
});

export default defineConfig({
	mdxOptions: {
		rehypeCodeOptions: {
			themes: {
				light: 'github-light',
				dark: 'github-dark',
			},
		},
	},
});
