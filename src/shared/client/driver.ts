import { entityKind } from 'drizzle-orm';

import type { PluginDialect, RuntimeDriver } from '../../types';
import { BetterDrizzleError, BetterDrizzleErrorCode } from '../errors';

/** Cloudflare D1 accepts 100 bind parameters per statement. */
export const D1_MAX_PARAMS = 100;

const SQLITE_MAX_PARAMS = 32_766;
const SQL_MAX_PARAMS = 65_535;

const isD1 = (db: unknown) =>
	(
		db as {
			session?: { constructor?: { [entityKind]?: string } };
		}
	).session?.constructor?.[entityKind] === 'SQLiteD1Session';

/**
 * Resolves the driver capabilities of a Drizzle instance. D1 is detected from
 * the Drizzle session, so no option is needed; `transactions: 'none'` turns
 * transactions off for any other SQLite driver that cannot run `BEGIN`.
 */
export const createRuntimeDriver = (
	db: unknown,
	dialect: PluginDialect,
	transactions: 'auto' | 'none' = 'auto',
): RuntimeDriver => {
	if (transactions !== 'auto' && transactions !== 'none')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.InvalidArgs,
			details: { transactions },
			message: `The "transactions" option must be "auto" or "none", received ${JSON.stringify(transactions)}.`,
			operation: 'bootstrap',
		});

	if (transactions === 'none' && dialect !== 'sqlite')
		throw new BetterDrizzleError({
			code: BetterDrizzleErrorCode.InvalidArgs,
			details: { dialect, transactions },
			message: `The "transactions: 'none'" option only supports SQLite, received "${dialect}".`,
			operation: 'bootstrap',
		});

	const d1 = dialect === 'sqlite' && isD1(db);

	return {
		acknowledged: transactions === 'none',
		d1,
		maxParams: d1
			? D1_MAX_PARAMS
			: dialect === 'sqlite'
				? SQLITE_MAX_PARAMS
				: SQL_MAX_PARAMS,
		transactions: !d1 && transactions !== 'none',
	};
};

const warned = new Set<string>();

/** @internal Lets tests observe a warning again. */
export const resetWarnings = () => warned.clear();

/** Prints a warning the first time `key` is seen in this process. */
export const warnOnce = (key: string, message: string) => {
	if (warned.has(key)) return;
	warned.add(key);
	console.warn(message);
};

/**
 * Warns, once per process, that an operation that needs a transaction runs
 * without one. Silent when the caller chose `transactions: 'none'`.
 */
export const warnWithoutTransaction = (driver: RuntimeDriver) => {
	if (driver.acknowledged) return;
	warnOnce(
		'without-transaction',
		'This SQLite driver cannot run BEGIN, COMMIT or SAVEPOINT (Cloudflare D1), so transactions and relation writes run as separate statements with no rollback. Set `transactions: "none"` in better() to silence this warning.',
	);
};
