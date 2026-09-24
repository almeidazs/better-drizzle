import { defineConfig } from 'tsdown';

export default defineConfig({
	clean: true,
	cwd: process.cwd(),
	deps: {
		neverBundle: true,
	},
	dts: true,
	entry: {
		index: 'src/index.ts',
		ata: 'src/plugins/ata/index.ts',
		plugins: 'src/plugins/index.ts',
		eslint: 'src/plugins/eslint/index.ts',
		rules: 'src/plugins/rules/index.ts',
		'soft-delete': 'src/plugins/soft-delete/index.ts',
		timestamps: 'src/plugins/timestamps/index.ts',
		zod: 'src/plugins/zod/index.ts',
	},
	fixedExtension: false,
	format: ['esm', 'cjs'],
	minify: true,
	platform: 'node',
	sourcemap: false,
	target: 'node18',
	treeshake: true,
	tsconfig: 'tsconfig.build.json',
});
