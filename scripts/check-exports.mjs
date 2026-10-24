// Imports every subpath export of the built package through ESM and CJS.
// Run after `bun run build` on each supported Node version.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const pkg = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const require = createRequire(import.meta.url);

let failed = false;

for (const subpath of Object.keys(pkg.exports)) {
	if (subpath === './package.json') continue;

	const specifier =
		subpath === '.' ? pkg.name : `${pkg.name}${subpath.slice(1)}`;

	for (const [format, load] of [
		['esm', () => import(specifier)],
		['cjs', async () => require(specifier)],
	]) {
		try {
			const mod = await load();

			if (Object.keys(mod).length === 0) throw new Error('no exports');

			console.log(`ok   ${format} ${specifier}`);
		} catch (error) {
			failed = true;

			console.error(
				`FAIL ${format} ${specifier}: ${error?.message ?? error}`,
			);
		}
	}
}

if (failed) process.exit(1);

console.log(`All exports load on Node ${process.version}`);
