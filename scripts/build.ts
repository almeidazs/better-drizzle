import { existsSync, statSync } from 'node:fs';
import {
	copyFile,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

type PackageName = 'core' | 'rules' | 'soft-delete' | 'timestamps';

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
	rules: {
		dir: join(rootDir, 'packages/rules'),
		defaultExport: 'rules',
		esmExports: [
			'mergeRules',
			'recommended',
			'rules',
			'safe',
			'strict',
			'version',
		],
		packageName: '@better-drizzle/rules',
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
		packages.includes('rules') ||
			packages.includes('soft-delete') ||
			packages.includes('timestamps')
			? (['core', ...packages] as PackageName[])
			: packages,
	),
);
const declarationPostprocessDirs: string[] = [];

const ensureSuccess = (
	result: Awaited<ReturnType<typeof Bun.build>>,
	label: string,
) => {
	if (result.success) return;

	const logs = result.logs.map((entry) => entry.message).join('\n');
	throw new Error(`Failed to build ${label}\n${logs}`);
};

const declarationSpecifierPattern =
	/((?:from\s+['"])|(?:import\(\s*['"]))((?:\.{1,2}\/[^'")]+)|\.)(['"]\s*\)?)/g;

const rewriteDeclarationSpecifiers = (source: string, filePath: string) =>
	source.replace(
		declarationSpecifierPattern,
		(_, prefix: string, specifier: string, suffix: string) => {
			if (specifier.endsWith('.js') || specifier.endsWith('.cjs'))
				return `${prefix}${specifier}${suffix}`;

			if (specifier === '.') return `${prefix}./index.js${suffix}`;

			const targetPath = resolve(dirname(filePath), specifier);
			const rewrittenSpecifier =
				existsSync(targetPath) && statSync(targetPath).isDirectory()
					? `${specifier}/index.js`
					: `${specifier}.js`;

			return `${prefix}${rewrittenSpecifier}${suffix}`;
		},
	);

const postprocessDeclarations = async (directory: string) => {
	const entries = await readdir(directory, { withFileTypes: true });

	for (const entry of entries) {
		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			await postprocessDeclarations(entryPath);
			continue;
		}

		if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;

		const source = await readFile(entryPath, 'utf8');
		const rewritten = rewriteDeclarationSpecifiers(source, entryPath);
		const modulePath = entryPath.slice(0, -'.d.ts'.length).concat('.js');

		if (rewritten !== source) await writeFile(entryPath, rewritten);

		await copyFile(
			entryPath,
			entryPath.slice(0, -'.d.ts'.length).concat('.d.cts'),
		);

		try {
			const moduleStats = await stat(modulePath);
			if (!moduleStats.isFile())
				await writeFile(modulePath, 'export {};\n');
		} catch (error) {
			if (
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				await writeFile(modulePath, 'export {};\n');
				continue;
			}

			throw error;
		}
	}
};

const removeGeneratedDeclarationCopies = async (directory: string) => {
	let entries: Awaited<ReturnType<typeof readdir>>;

	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		)
			return;

		throw error;
	}

	for (const entry of entries) {
		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			await removeGeneratedDeclarationCopies(entryPath);
			continue;
		}

		if (entry.isFile() && entry.name.endsWith('.d.cts'))
			await rm(entryPath, { force: true });
	}
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
	await removeGeneratedDeclarationCopies(config.dir);
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

	declarationPostprocessDirs.push(distDir);
}

for (const distDir of declarationPostprocessDirs) {
	const distStats = await stat(distDir);
	if (distStats.isDirectory()) await postprocessDeclarations(distDir);
}
