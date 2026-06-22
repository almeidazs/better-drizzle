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

const getErrorFields = (error: unknown): ErrorWithFields | null => {
	if (typeof error !== 'object' || error === null) return null;

	return error as ErrorWithFields;
};

const getMessage = (error: unknown, fields: ErrorWithFields | null) => {
	if (typeof fields?.message === 'string' && fields.message)
		return fields.message;
	if (typeof fields?.sqlMessage === 'string' && fields.sqlMessage)
		return fields.sqlMessage;
	if (error instanceof Error) return error.message;

	return String(error);
};

const getCode = (fields: ErrorWithFields | null) => {
	if (typeof fields?.code === 'string' && fields.code) return fields.code;
	if (typeof fields?.sqlState === 'string' && fields.sqlState)
		return fields.sqlState;
};

const getErrno = (fields: ErrorWithFields | null) => {
	if (typeof fields?.errno === 'number' && Number.isFinite(fields.errno))
		return fields.errno;
};

const getConstraint = (fields: ErrorWithFields | null, message: string) => {
	if (typeof fields?.constraint === 'string' && fields.constraint)
		return fields.constraint;

	const match = message.match(/for key ['`"]?([^'"`]+)['"`]?/i);
	return match?.[1];
};

const getSqliteTableColumn = (message: string) => {
	const uniqueMatch = message.match(/UNIQUE constraint failed: (.+)$/i);
	if (uniqueMatch) {
		const firstRef = uniqueMatch[1]?.split(',')[0]?.trim();
		const [table, column] = firstRef?.split('.') ?? [];
		return { table, column };
	}

	const notNullMatch = message.match(
		/NOT NULL constraint failed: ([^.]+)\.([^\s]+)$/i,
	);
	if (notNullMatch)
		return { table: notNullMatch[1], column: notNullMatch[2] };

	return {};
};

const getColumn = (fields: ErrorWithFields | null, message: string) => {
	if (typeof fields?.column === 'string' && fields.column)
		return fields.column;
	return getSqliteTableColumn(message).column;
};

const getTable = (fields: ErrorWithFields | null, message: string) => {
	if (typeof fields?.table === 'string' && fields.table) return fields.table;
	return getSqliteTableColumn(message).table;
};

const getDriver = (
	code: string | undefined,
	errno: number | undefined,
	message: string,
) => {
	if (code && /^\d{5}$/.test(code)) return 'pg';

	if (
		code?.startsWith('SQLITE_') ||
		message.includes('UNIQUE constraint failed') ||
		message.includes('FOREIGN KEY constraint failed') ||
		message.includes('NOT NULL constraint failed') ||
		message.includes('CHECK constraint failed')
	)
		return 'sqlite';

	if (
		code?.startsWith('ER_') ||
		errno !== undefined ||
		message.includes('Duplicate entry') ||
		message.includes('Cannot add or update a child row') ||
		message.includes('Cannot delete or update a parent row')
	)
		return 'mysql';

	return 'unknown';
};

export const isDatabaseError = (error: unknown): error is ErrorWithFields => {
	const fields = getErrorFields(error);
	if (!fields) return false;

	return (
		typeof fields.message === 'string' ||
		typeof fields.code === 'string' ||
		typeof fields.errno === 'number' ||
		typeof fields.sqlState === 'string'
	);
};

export const getDatabaseErrorInfo = (error: unknown): DatabaseErrorInfo => {
	const fields = getErrorFields(error);
	const message = getMessage(error, fields);
	const code = getCode(fields);
	const errno = getErrno(fields);

	return {
		driver: getDriver(code, errno, message),
		code,
		errno,
		constraint: getConstraint(fields, message),
		table: getTable(fields, message),
		column: getColumn(fields, message),
		message,
	};
};

export const isUniqueViolation = (
	error: unknown,
	constraint?: string,
): boolean => {
	const info = getDatabaseErrorInfo(error);

	if (info.driver === 'pg')
		return (
			info.code === '23505' &&
			(!constraint || info.constraint === constraint)
		);

	if (info.driver === 'sqlite')
		return (
			(info.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
				info.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
				info.message.includes('UNIQUE constraint failed')) &&
			(!constraint || info.constraint === constraint)
		);

	if (info.driver === 'mysql')
		return (
			(info.code === 'ER_DUP_ENTRY' ||
				info.errno === 1062 ||
				info.message.includes('Duplicate entry')) &&
			(!constraint || info.constraint === constraint)
		);

	return false;
};

export const isForeignKeyViolation = (
	error: unknown,
	constraint?: string,
): boolean => {
	const info = getDatabaseErrorInfo(error);

	if (info.driver === 'pg')
		return (
			info.code === '23503' &&
			(!constraint || info.constraint === constraint)
		);

	if (info.driver === 'sqlite')
		return (
			(info.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
				info.message.includes('FOREIGN KEY constraint failed')) &&
			(!constraint || info.constraint === constraint)
		);

	if (info.driver === 'mysql')
		return (
			(info.code === 'ER_NO_REFERENCED_ROW_2' ||
				info.code === 'ER_ROW_IS_REFERENCED_2' ||
				info.errno === 1451 ||
				info.errno === 1452 ||
				info.message.includes('Cannot add or update a child row') ||
				info.message.includes(
					'Cannot delete or update a parent row',
				)) &&
			(!constraint || info.constraint === constraint)
		);

	return false;
};

export const isNotNullViolation = (
	error: unknown,
	column?: string,
): boolean => {
	const info = getDatabaseErrorInfo(error);

	if (info.driver === 'pg')
		return info.code === '23502' && (!column || info.column === column);

	if (info.driver === 'sqlite')
		return (
			(info.code === 'SQLITE_CONSTRAINT_NOTNULL' ||
				info.message.includes('NOT NULL constraint failed')) &&
			(!column || info.column === column)
		);

	if (info.driver === 'mysql')
		return (
			(info.code === 'ER_BAD_NULL_ERROR' ||
				info.errno === 1048 ||
				info.message.includes('cannot be null')) &&
			(!column || info.column === column)
		);

	return false;
};

export const isCheckViolation = (
	error: unknown,
	constraint?: string,
): boolean => {
	const info = getDatabaseErrorInfo(error);

	if (info.driver === 'pg')
		return (
			info.code === '23514' &&
			(!constraint || info.constraint === constraint)
		);

	if (info.driver === 'sqlite')
		return (
			(info.code === 'SQLITE_CONSTRAINT_CHECK' ||
				info.message.includes('CHECK constraint failed')) &&
			(!constraint || info.constraint === constraint)
		);

	if (info.driver === 'mysql')
		return (
			(info.code === 'ER_CHECK_CONSTRAINT_VIOLATED' ||
				info.errno === 3819 ||
				info.message.includes('Check constraint')) &&
			(!constraint || info.constraint === constraint)
		);

	return false;
};
