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

export interface DatabaseErrorInfo {
	driver: DatabaseDriver;
	code?: string;
	errno?: number;
	constraint?: string;
	table?: string;
	column?: string;
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
