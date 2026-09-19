import { defineConfig } from 'tsdown';

export default defineConfig({
	clean: true,
	cwd: process.cwd(),
	deps: {
		neverBundle: true,
	},
	dts: true,
	entry: ['src/index.ts'],
	fixedExtension: false,
	format: ['esm', 'cjs'],
	minify: true,
	platform: 'node',
	sourcemap: false,
	target: 'node18',
	treeshake: true,
	tsconfig: 'tsconfig.build.json',
});
