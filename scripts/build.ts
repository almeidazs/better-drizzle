import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type PackageName = 'core' | 'soft-delete' | 'timestamps';

const rootDir = resolve(import.meta.dir, '..');

const packageConfigs: Record<
	PackageName,
	{
		dir: string;
		esmExports: string[];
		defaultExport?: string;
		packageName: string;
	}
> = {
	core: {
		dir: join(rootDir, 'packages/core'),
		esmExports: [
			'BetterDrizzleError',
			'BetterDrizzleErrorCode',
			'BetterDrizzleTransactionRollbackError',
			'OrderType',
			'PaginationType',
			'better',
			'definePlugin',
			'getDatabaseErrorInfo',
			'isCheckViolation',
			'isDatabaseError',
			'isForeignKeyViolation',
			'isNotNullViolation',
			'isUniqueViolation',
			'version',
		],
		packageName: 'better-drizzle',
	},
	'soft-delete': {
		dir: join(rootDir, 'packages/soft-delete'),
		defaultExport: 'softDelete',
		esmExports: ['softDelete', 'version'],
		packageName: '@better-drizzle/soft-delete',
	},
	timestamps: {
		dir: join(rootDir, 'packages/timestamps'),
		defaultExport: 'timestamps',
		esmExports: ['timestamps', 'version'],
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

function createEsmWrapper(exports: string[], defaultExport?: string) {
	return [
		"import { createRequire } from 'node:module';",
		'',
		'const require = createRequire(import.meta.url);',
		'const mod = require(MODULE_PATH);',
		'',
		...exports.map((name) => `export const ${name} = mod.${name};`),
		defaultExport
			? `export default mod.default ?? mod.${defaultExport};`
			: '',
		'',
	]
		.filter(Boolean)
		.join('\n');
}

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

	if (name === 'core') {
		const runtime = Bun.spawnSync(
			[
				'bunx',
				'tsc',
				'-p',
				typescriptConfigPath,
				'--declaration',
				'false',
				'--emitDeclarationOnly',
				'false',
				'--module',
				'commonjs',
				'--moduleResolution',
				'node',
				'--outDir',
				join(distDir, 'cjs'),
			],
			{
				cwd: rootDir,
				stdout: 'pipe',
				stderr: 'pipe',
			},
		);

		if (runtime.exitCode !== 0) {
			const decoder = new TextDecoder();
			const output =
				decoder.decode(runtime.stderr) ||
				decoder.decode(runtime.stdout);

			throw new Error(
				`Failed to build runtime for ${config.packageName}\n${output}`,
			);
		}

		await writeFile(
			join(distDir, 'index.cjs'),
			"module.exports = require('./cjs/index.js');\n",
		);
		await writeFile(
			join(distDir, 'cjs/package.json'),
			'{\n  "type": "commonjs"\n}\n',
		);
		await writeFile(
			join(distDir, 'index.js'),
			createEsmWrapper(config.esmExports, config.defaultExport).replace(
				'MODULE_PATH',
				"'./cjs/index.js'",
			),
		);
	} else {
		ensureSuccess(
			await Bun.build({
				entrypoints: [entrypoint],
				format: 'cjs',
				minify: false,
				naming: 'index.cjs',
				outdir: distDir,
				packages: 'external',
				sourcemap: 'none',
				splitting: false,
				target: 'node',
			}),
			`${config.packageName} (cjs)`,
		);

		await writeFile(
			join(distDir, 'index.js'),
			createEsmWrapper(config.esmExports, config.defaultExport).replace(
				'MODULE_PATH',
				"'./index.cjs'",
			),
		);
	}

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
