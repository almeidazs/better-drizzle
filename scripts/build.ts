import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type PackageName = 'core' | 'soft-delete' | 'timestamps';

const rootDir = resolve(import.meta.dir, '..');

const packageConfigs: Record<
	PackageName,
	{
		dir: string;
		packageName: string;
	}
> = {
	core: {
		dir: join(rootDir, 'packages/core'),
		packageName: 'better-drizzle',
	},
	'soft-delete': {
		dir: join(rootDir, 'packages/soft-delete'),
		packageName: '@better-drizzle/soft-delete',
	},
	timestamps: {
		dir: join(rootDir, 'packages/timestamps'),
		packageName: '@better-drizzle/timestamps',
	},
};

const requested = process.argv.slice(2) as PackageName[];
const packages =
	requested.length > 0
		? requested
		: (Object.keys(packageConfigs) as PackageName[]);
const buildOrder = Array.from(
	new Set(
		packages.includes('soft-delete') || packages.includes('timestamps')
			? (['core', ...packages] as PackageName[])
			: packages,
	),
);

const ensureSuccess = (
	result: Awaited<ReturnType<typeof Bun.build>>,
	label: string,
) => {
	if (result.success) return;

	const logs = result.logs.map((entry) => entry.message).join('\n');
	throw new Error(`Failed to build ${label}\n${logs}`);
};

for (const name of buildOrder) {
	const config = packageConfigs[name];
	if (!config) throw new Error(`Unknown package "${name}"`);

	const distDir = join(config.dir, 'dist');
	const entrypoint = join(config.dir, 'src/index.ts');
	const packageJsonPath = join(config.dir, 'package.json');
	const typescriptConfigPath = join(config.dir, 'tsconfig.build.json');
	const versionPath = join(config.dir, 'src/version.ts');

	await rm(distDir, { force: true, recursive: true });
	for await (const file of new Bun.Glob('src/**/*.d.ts').scan({
		cwd: config.dir,
		onlyFiles: true,
	}))
		await rm(join(config.dir, file), { force: true });

	const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
		name: string;
		version: string;
	};

	await writeFile(
		versionPath,
		[
			'/**',
			` * Your current version of [${packageJson.name}](https://npmjs.com/package/${packageJson.name}).`,
			' */',
			`export const version = '${packageJson.version}';`,
			'',
		].join('\n'),
	);

	ensureSuccess(
		await Bun.build({
			entrypoints: [entrypoint],
			format: 'esm',
			minify: true,
			naming: '[name].js',
			outdir: distDir,
			packages: 'external',
			sourcemap: 'none',
			splitting: false,
			target: 'node',
		}),
		`${config.packageName} (esm)`,
	);

	ensureSuccess(
		await Bun.build({
			entrypoints: [entrypoint],
			format: 'cjs',
			minify: true,
			naming: '[name].cjs',
			outdir: distDir,
			packages: 'external',
			sourcemap: 'none',
			splitting: false,
			target: 'node',
		}),
		`${config.packageName} (cjs)`,
	);

	const tsc = Bun.spawnSync(['bunx', 'tsc', '-p', typescriptConfigPath], {
		cwd: rootDir,
		stdout: 'pipe',
		stderr: 'pipe',
	});

	if (tsc.exitCode !== 0) {
		const decoder = new TextDecoder();
		const output = decoder.decode(tsc.stderr) || decoder.decode(tsc.stdout);

		throw new Error(
			`Failed to emit types for ${config.packageName}\n${output}`,
		);
	}
}
