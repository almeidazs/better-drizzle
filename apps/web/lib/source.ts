import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { icons } from 'lucide-react';
import { createElement } from 'react';

export const source = loader({
	baseUrl: '/docs',
	source: docs.toFumadocsSource(),
	plugins: [
		{
			name: 'dialects',
			// Marks database-specific pages so CSS can hide them in the sidebar.
			transformPageTree: {
				file(node, filePath) {
					if (!filePath) return node;
					const file = this.storage.read(filePath);
					if (file?.format !== 'page') return node;
					const { dialects } = file.data as { dialects?: string[] };
					if (dialects)
						node.name = createElement(
							'span',
							{
								key: 'name',
								'data-dialect-page': dialects.join(' '),
							},
							node.name,
						);
					return node;
				},
			},
		},
	],
	icon(icon) {
		if (!icon) return;
		if (icon in icons)
			return createElement(icons[icon as keyof typeof icons]);
	},
});
