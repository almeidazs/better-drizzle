type DatabaseDriver = 'pg' | 'sqlite' | 'mysql' | 'unknown';

type ErrorWithFields = {
	code?: unknown;
	errno?: unknown;
	message?: unknown;
	constraint?: unknown;
	table?: unknown;
	column?: unknown;
	sqlState?: unknown;
	sqlMessage?: unknown;
};

/**
 * Normalised representation of a database error across supported drivers
 * (PostgreSQL, SQLite, MySQL).
 */
export interface DatabaseErrorInfo {
	/** The detected database driver that produced the error. */
	driver: DatabaseDriver;
	/** Driver-specific error code (e.g. Postgres SQLSTATE). */
	code?: string;
	/** Numeric error number (used by MySQL and some SQLite errors). */
	errno?: number;
	/** The constraint name that was violated, if available. */
	constraint?: string;
	/** The table involved in the error, if available. */
	table?: string;
	/** The column involved in the error, if available. */
	column?: string;
	/** Human-readable error message. */
	message: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
	if (typeof value !== 'object' || value === null) {
		return null;
	}

	return value as Record<string, unknown>;
};

const asString = (value: unknown): string | undefined => {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const asNumber = (value: unknown): number | undefined => {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: undefined;
};

const extractSqliteConstraintDetails = (message: string) => {
	const uniqueMatch = message.match(/UNIQUE constraint failed: (.+)$/i);
	if (uniqueMatch) {
		const rawColumns = uniqueMatch[1]?.trim();
		const columnRefs = rawColumns
			?.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean);
		const firstRef = columnRefs?.[0];
		const [table, column] = firstRef?.split('.') ?? [];

		return {
			table,
			column,
			columns: columnRefs,
		};
	}

	const notNullMatch = message.match(
		/NOT NULL constraint failed: ([^.]+)\.([^\s]+)$/i,
	);
	if (notNullMatch) {
		return {
			table: notNullMatch[1],
			column: notNullMatch[2],
		};
	}

	return {};
};

const extractMysqlConstraint = (message: string) => {
	const constraintMatch = message.match(/for key ['`"]?([^'"`]+)['"`]?/i);
	return constraintMatch?.[1];
};

const detectDriver = (
	fields: ErrorWithFields,
	message: string,
): DatabaseDriver => {
	const code = asString(fields.code) ?? asString(fields.sqlState);
	const errno = asNumber(fields.errno);

	if (code && /^\d{5}$/.test(code)) {
		return 'pg';
	}

	if (
		code?.startsWith('SQLITE_') ||
		message.includes('SQLite') ||
		message.includes('UNIQUE constraint failed') ||
		message.includes('FOREIGN KEY constraint failed') ||
		message.includes('NOT NULL constraint failed') ||
		message.includes('CHECK constraint failed')
	) {
		return 'sqlite';
	}

	if (
		code?.startsWith('ER_') ||
		errno !== undefined ||
		message.includes('Duplicate entry') ||
		message.includes('Cannot add or update a child row') ||
		message.includes('Cannot delete or update a parent row')
	) {
		return 'mysql';
	}

	return 'unknown';
};

/**
 * Checks whether the given value looks like a database-originated error by
 * inspecting common fields (`message`, `code`, `errno`, `sqlState`).
 *
 * @param error - The value to inspect.
 * @returns `true` when the value resembles a database error object.
 */
export const isDatabaseError = (error: unknown): error is ErrorWithFields => {
	const value = asRecord(error);
	if (!value) {
		return false;
	}

	return (
		typeof value.message === 'string' ||
		typeof value.code === 'string' ||
		typeof value.errno === 'number' ||
		typeof value.sqlState === 'string'
	);
};

/**
 * Parses a raw error value and returns a normalised {@link DatabaseErrorInfo}
 * object with driver detection, constraint details, and table/column metadata.
 *
 * @param error - The raw error value (typically thrown by the database driver).
 * @returns A normalised error info object. When the value is not a recognised
 *   database error, the driver is set to `'unknown'`.
 */
export const getDatabaseErrorInfo = (error: unknown): DatabaseErrorInfo => {
	if (!isDatabaseError(error)) {
		return {
			driver: 'unknown',
			message: error instanceof Error ? error.message : String(error),
		};
	}

	const fields = error as ErrorWithFields;
	const message =
		asString(fields.message) ??
		asString(fields.sqlMessage) ??
		(error instanceof Error ? error.message : 'Unknown database error');
	const driver = detectDriver(fields, message);
	const info: DatabaseErrorInfo = {
		driver,
		code: asString(fields.code) ?? asString(fields.sqlState),
		errno: asNumber(fields.errno),
		constraint: asString(fields.constraint),
		table: asString(fields.table),
		column: asString(fields.column),
		message,
	};

	if (driver === 'sqlite') {
		const parsed = extractSqliteConstraintDetails(message);
		info.table ??= parsed.table;
		info.column ??= parsed.column;
	}

	if (driver === 'mysql') {
		info.constraint ??= extractMysqlConstraint(message);
	}

	return info;
};

const matchesConstraint = (
	info: DatabaseErrorInfo,
	constraint?: string,
): boolean => {
	if (!constraint) {
		return true;
	}

	return info.constraint === constraint;
};

const matchesColumn = (info: DatabaseErrorInfo, column?: string): boolean => {
	if (!column) {
		return true;
	}

	return info.column === column;
};

/**
 * Determines whether the given error is a unique constraint violation.
 *
 * Supports PostgreSQL (SQLSTATE `23505`), SQLite (`SQLITE_CONSTRAINT_UNIQUE`),
 * and MySQL (`ER_DUP_ENTRY` / errno `1062`).
 *
 * @param error - The error to inspect.
 * @param constraint - Optional constraint name to narrow the match.
 * @returns `true` when the error represents a unique violation, optionally
 *   matching the specified constraint.
 */
export const isUniqueViolation = (
	error: unknown,
	constraint?: string,
): boolean => {
	const info = getDatabaseErrorInfo(error);

	if (info.driver === 'pg') {
		return info.code === '23505' && matchesConstraint(info, constraint);
	}

	if (info.driver === 'sqlite') {
		const isUnique =
			info.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
			info.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
			info.message.includes('UNIQUE constraint failed');
		return isUnique && matchesConstraint(info, constraint);
	}

	if (info.driver === 'mysql') {
		const isUnique =
			info.code === 'ER_DUP_ENTRY' ||
			info.errno === 1062 ||
			info.message.includes('Duplicate entry');
		return isUnique && matchesConstraint(info, constraint);
	}

	return false;
};

/**
 * Determines whether the given error is a foreign key constraint violation.
 *
 * Supports PostgreSQL (SQLSTATE `23503`), SQLite
 * (`SQLITE_CONSTRAINT_FOREIGNKEY`), and MySQL (`ER_NO_REFERENCED_ROW_2`,
 * `ER_ROW_IS_REFERENCED_2`).
 *
 * @param error - The error to inspect.
 * @param constraint - Optional constraint name to narrow the match.
 * @returns `true` when the error represents a foreign key violation.
 */
export const isForeignKeyViolation = (
	error: unknown,
	constraint?: string,
): boolean => {
	const info = getDatabaseErrorInfo(error);

	if (info.driver === 'pg') {
		return info.code === '23503' && matchesConstraint(info, constraint);
	}

	if (info.driver === 'sqlite') {
		const isForeignKey =
			info.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
			info.message.includes('FOREIGN KEY constraint failed');
		return isForeignKey && matchesConstraint(info, constraint);
	}

	if (info.driver === 'mysql') {
		const isForeignKey =
			info.code === 'ER_NO_REFERENCED_ROW_2' ||
			info.code === 'ER_ROW_IS_REFERENCED_2' ||
			info.errno === 1451 ||
			info.errno === 1452 ||
			info.message.includes('Cannot add or update a child row') ||
			info.message.includes('Cannot delete or update a parent row');
		return isForeignKey && matchesConstraint(info, constraint);
	}

	return false;
};

/**
 * Determines whether the given error is a NOT NULL constraint violation.
 *
 * Supports PostgreSQL (SQLSTATE `23502`), SQLite
 * (`SQLITE_CONSTRAINT_NOTNULL`), and MySQL (`ER_BAD_NULL_ERROR` / errno
 * `1048`).
 *
 * @param error - The error to inspect.
 * @param column - Optional column name to narrow the match.
 * @returns `true` when the error represents a NOT NULL violation.
 */
export const isNotNullViolation = (
	error: unknown,
	column?: string,
): boolean => {
	const info = getDatabaseErrorInfo(error);

	if (info.driver === 'pg') {
		return info.code === '23502' && matchesColumn(info, column);
	}

	if (info.driver === 'sqlite') {
		const isNotNull =
			info.code === 'SQLITE_CONSTRAINT_NOTNULL' ||
			info.message.includes('NOT NULL constraint failed');
		return isNotNull && matchesColumn(info, column);
	}

	if (info.driver === 'mysql') {
		const isNotNull =
			info.code === 'ER_BAD_NULL_ERROR' ||
			info.errno === 1048 ||
			info.message.includes('cannot be null');
		return isNotNull && matchesColumn(info, column);
	}

	return false;
};

/**
 * Determines whether the given error is a CHECK constraint violation.
 *
 * Supports PostgreSQL (SQLSTATE `23514`), SQLite
 * (`SQLITE_CONSTRAINT_CHECK`), and MySQL (`ER_CHECK_CONSTRAINT_VIOLATED` /
 * errno `3819`).
 *
 * @param error - The error to inspect.
 * @param constraint - Optional constraint name to narrow the match.
 * @returns `true` when the error represents a CHECK constraint violation.
 */
export const isCheckViolation = (
	error: unknown,
	constraint?: string,
): boolean => {
	const info = getDatabaseErrorInfo(error);

	if (info.driver === 'pg') {
		return info.code === '23514' && matchesConstraint(info, constraint);
	}

	if (info.driver === 'sqlite') {
		const isCheck =
			info.code === 'SQLITE_CONSTRAINT_CHECK' ||
			info.message.includes('CHECK constraint failed');
		return isCheck && matchesConstraint(info, constraint);
	}

	if (info.driver === 'mysql') {
		const isCheck =
			info.code === 'ER_CHECK_CONSTRAINT_VIOLATED' ||
			info.errno === 3819 ||
			info.message.includes('Check constraint');
		return isCheck && matchesConstraint(info, constraint);
	}

	return false;
};
