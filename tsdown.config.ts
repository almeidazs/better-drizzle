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
		eslint: 'src/packages/eslint/index.ts',
		rules: 'src/packages/rules/index.ts',
		'soft-delete': 'src/packages/soft-delete/index.ts',
		timestamps: 'src/packages/timestamps/index.ts',
		zod: 'src/packages/zod/index.ts',
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
