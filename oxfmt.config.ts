import { defineConfig } from 'oxfmt';
import ultracite from 'ultracite/oxfmt';

export default defineConfig({
	...ultracite,
	singleQuote: true,
	tabWidth: 4,
	trailingComma: 'all',
	useTabs: true,
});
