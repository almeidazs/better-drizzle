export type DatabaseDriver = 'pg' | 'sqlite' | 'mysql' | 'unknown';

type ErrorWithFields = {
	code?: unknown;
	errno?: unknown;
	message?: unknown;
	constraint?: unknown;
	table?: unknown;
	column?: unknown;
	sqlState?: unknown;
	sqlMessage?: unknown;
	cause?: unknown;
};

export enum BetterDrizzleErrorCode {
	AfterCommitOutsideTransaction = 'AFTER_COMMIT_OUTSIDE_TRANSACTION',
	AfterRollbackOutsideTransaction = 'AFTER_ROLLBACK_OUTSIDE_TRANSACTION',
	DatabaseError = 'DATABASE_ERROR',
	DialectInferenceFailed = 'DIALECT_INFERENCE_FAILED',
	HookError = 'HOOK_ERROR',
	OperationError = 'OPERATION_ERROR',
	PluginDialectUnsupported = 'PLUGIN_DIALECT_UNSUPPORTED',
	PluginDuplicateId = 'PLUGIN_DUPLICATE_ID',
	PluginExtensionConflict = 'PLUGIN_EXTENSION_CONFLICT',
	PluginOperationArgConflict = 'PLUGIN_OPERATION_ARG_CONFLICT',
	PluginRequiredColumnMissing = 'PLUGIN_REQUIRED_COLUMN_MISSING',
	RawCommentRequired = 'RAW_COMMENT_REQUIRED',
	RawAborted = 'RAW_ABORTED',
	RawDisabled = 'RAW_DISABLED',
	RawInvalidQuery = 'RAW_INVALID_QUERY',
	RawTimeout = 'RAW_TIMEOUT',
	RawUnsafeDisabled = 'RAW_UNSAFE_DISABLED',
	RawUnsafePlaceholderMismatch = 'RAW_UNSAFE_PLACEHOLDER_MISMATCH',
	RawUnsupportedOption = 'RAW_UNSUPPORTED_OPTION',
	RepositoryNotFound = 'REPOSITORY_NOT_FOUND',
	ResultNotFound = 'RESULT_NOT_FOUND',
	TableRuntimeNotFound = 'TABLE_RUNTIME_NOT_FOUND',
	TransactionAborted = 'TRANSACTION_ABORTED',
	TransactionLifecycleStateMissing = 'TRANSACTION_LIFECYCLE_STATE_MISSING',
	TransactionRuntimeNotInitialized = 'TRANSACTION_RUNTIME_NOT_INITIALIZED',
	TransactionRollback = 'TRANSACTION_ROLLBACK',
	TransactionsUnsupported = 'TRANSACTIONS_UNSUPPORTED',
	TransactionTimeout = 'TRANSACTION_TIMEOUT',
	TransactionUnsupportedOption = 'TRANSACTION_UNSUPPORTED_OPTION',
	Unknown = 'UNKNOWN',
}

export interface BetterDrizzleErrorOptions {
	code: BetterDrizzleErrorCode;
	message: string;
	status?: number;
	driver?: DatabaseDriver;
	cause?: unknown;
	column?: string;
	constraint?: string;
	details?: Record<string, unknown>;
	dialect?: string;
	errno?: number;
	hookName?: string;
	operation?: string;
	sqlState?: string;
	stage?: string;
	table?: string;
}

const getDefaultStatus = (code: BetterDrizzleErrorCode) => {
	switch (code) {
		case BetterDrizzleErrorCode.ResultNotFound:
			return 404;
		case BetterDrizzleErrorCode.RawCommentRequired:
		case BetterDrizzleErrorCode.RawInvalidQuery:
		case BetterDrizzleErrorCode.RawUnsafePlaceholderMismatch:
		case BetterDrizzleErrorCode.RawUnsupportedOption:
		case BetterDrizzleErrorCode.TransactionUnsupportedOption:
			return 400;
		case BetterDrizzleErrorCode.TransactionRollback:
			return 409;
		case BetterDrizzleErrorCode.RawAborted:
		case BetterDrizzleErrorCode.TransactionAborted:
		case BetterDrizzleErrorCode.TransactionTimeout:
		case BetterDrizzleErrorCode.RawTimeout:
			return 408;
		default:
			return 500;
	}
};

/**
 * Parsed information about a database error. Normalises the various
 * error shapes from PostgreSQL, SQLite, and MySQL into a single
 * deterministic structure.
 */
export interface DatabaseErrorInfo {
	/** The detected database driver (`'pg'`, `'sqlite'`, `'mysql'`, or `'unknown'`). */
	driver: DatabaseDriver;
	/** Driver-specific error code (e.g. `'23505'` for PostgreSQL unique violation). */
	code?: string;
	/** Errno value from MySQL errors, when available. */
	errno?: number;
	/** Name of the constraint that was violated, when detectable. */
	constraint?: string;
	/** The table involved in the error, when detectable. */
	table?: string;
	/** The column involved in the error, when detectable. */
	column?: string;
	/** The original error message. */
	message: string;
}

export class BetterDrizzleError extends Error {
	code: BetterDrizzleErrorCode;
	status: number;
	driver?: DatabaseDriver;
	column?: string;
	constraint?: string;
	details?: Record<string, unknown>;
	dialect?: string;
	errno?: number;
	hookName?: string;
	operation?: string;
	sqlState?: string;
	stage?: string;
	table?: string;

	constructor(options: BetterDrizzleErrorOptions) {
		super(options.message, options.cause ? { cause: options.cause } : {});

		this.name = 'BetterDrizzleError';
		this.code = options.code;
		this.status = options.status ?? getDefaultStatus(options.code);
		this.driver = options.driver;
		this.column = options.column;
		this.constraint = options.constraint;
		this.details = options.details;
		this.dialect = options.dialect;
		this.errno = options.errno;
		this.hookName = options.hookName;
		this.operation = options.operation;
		this.sqlState = options.sqlState;
		this.stage = options.stage;
		this.table = options.table;
	}

	static is(error: unknown): error is BetterDrizzleError {
		return error instanceof BetterDrizzleError;
	}

	static from(
		error: unknown,
		overrides: Partial<BetterDrizzleErrorOptions> = {},
	): BetterDrizzleError {
		if (error instanceof BetterDrizzleError)
			return new BetterDrizzleError({
				code: overrides.code ?? error.code,
				message: overrides.message ?? error.message,
				status: overrides.status ?? error.status,
				driver: overrides.driver ?? error.driver,
				cause: overrides.cause ?? error.cause,
				column: overrides.column ?? error.column,
				constraint: overrides.constraint ?? error.constraint,
				details: overrides.details ?? error.details,
				dialect: overrides.dialect ?? error.dialect,
				errno: overrides.errno ?? error.errno,
				hookName: overrides.hookName ?? error.hookName,
				operation: overrides.operation ?? error.operation,
				sqlState: overrides.sqlState ?? error.sqlState,
				stage: overrides.stage ?? error.stage,
				table: overrides.table ?? error.table,
			});

		const info = isDatabaseError(error)
			? getDatabaseErrorInfo(error)
			: null;

		return new BetterDrizzleError({
			code:
				overrides.code ??
				(info
					? BetterDrizzleErrorCode.DatabaseError
					: BetterDrizzleErrorCode.Unknown),
			message:
				overrides.message ??
				info?.message ??
				(error instanceof Error ? error.message : String(error)),
			status: overrides.status,
			driver: overrides.driver ?? info?.driver,
			cause: overrides.cause ?? error,
			column: overrides.column ?? info?.column,
			constraint: overrides.constraint ?? info?.constraint,
			details:
				overrides.details ??
				(error instanceof Error
					? { name: error.name }
					: info
						? { database: info }
						: undefined),
			dialect: overrides.dialect,
			errno: overrides.errno ?? info?.errno,
			hookName: overrides.hookName,
			operation: overrides.operation,
			sqlState: overrides.sqlState ?? info?.code,
			stage: overrides.stage,
			table: overrides.table ?? info?.table,
		});
	}

	static fromDatabaseError(
		error: unknown,
		overrides: Partial<BetterDrizzleErrorOptions> = {},
	) {
		const info = getDatabaseErrorInfo(error);

		return new BetterDrizzleError({
			code: overrides.code ?? BetterDrizzleErrorCode.DatabaseError,
			message: overrides.message ?? info.message,
			status: overrides.status,
			driver: overrides.driver ?? info.driver,
			cause: overrides.cause ?? error,
			column: overrides.column ?? info.column,
			constraint: overrides.constraint ?? info.constraint,
			details: overrides.details ?? { database: info },
			dialect: overrides.dialect,
			errno: overrides.errno ?? info.errno,
			hookName: overrides.hookName,
			operation: overrides.operation,
			sqlState: overrides.sqlState ?? info.code,
			stage: overrides.stage,
			table: overrides.table ?? info.table,
		});
	}

	withCause(cause: unknown) {
		return BetterDrizzleError.from(this, { cause });
	}

	withDetails(details: Record<string, unknown>) {
		return BetterDrizzleError.from(this, {
			details: {
				...(this.details ?? {}),
				...details,
			},
		});
	}

	toJSON() {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			status: this.status,
			driver: this.driver,
			column: this.column,
			constraint: this.constraint,
			details: this.details,
			dialect: this.dialect,
			errno: this.errno,
			hookName: this.hookName,
			operation: this.operation,
			sqlState: this.sqlState,
			stage: this.stage,
			table: this.table,
		};
	}
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

/**
 * Checks whether the given value looks like a database error (has a
 * `message`, `code`, `errno`, or `sqlState` property).
 *
 * @param error - The value to check.
 * @returns `true` when the value matches the database error shape.
 *
 * @example
 * ```ts
 * try {
 *   await db.insert(users).values(data);
 * } catch (error) {
 *   if (isDatabaseError(error)) {
 *     console.error(error.code);
 *   }
 * }
 * ```
 */
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

/**
 * Parses a raw error value into a normalised {@link DatabaseErrorInfo}
 * object. Detects the database driver and extracts the error code,
 * constraint name, table, column, and message.
 *
 * @param error - The raw error value (typically caught from a Drizzle operation).
 * @returns A normalised error info object.
 */
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

/**
 * Checks whether the error is a unique constraint violation. Supports
 * PostgreSQL (`23505`), SQLite (`SQLITE_CONSTRAINT_UNIQUE`), and MySQL
 * (`ER_DUP_ENTRY` / errno `1062`).
 *
 * @param error      - The raw error value.
 * @param constraint - Optional constraint name to match against.
 * @returns `true` when the error is a unique violation (optionally for
 *   the specified constraint).
 */
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

/**
 * Checks whether the error is a foreign key constraint violation. Supports
 * PostgreSQL (`23503`), SQLite (`SQLITE_CONSTRAINT_FOREIGNKEY`), and MySQL
 * (`ER_NO_REFERENCED_ROW_2` / `ER_ROW_IS_REFERENCED_2`).
 *
 * @param error      - The raw error value.
 * @param constraint - Optional constraint name to match against.
 * @returns `true` when the error is a foreign key violation (optionally
 *   for the specified constraint).
 */
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

/**
 * Checks whether the error is a NOT NULL constraint violation. Supports
 * PostgreSQL (`23502`), SQLite (`SQLITE_CONSTRAINT_NOTNULL`), and MySQL
 * (`ER_BAD_NULL_ERROR` / errno `1048`).
 *
 * @param error  - The raw error value.
 * @param column - Optional column name to match against.
 * @returns `true` when the error is a NOT NULL violation (optionally for
 *   the specified column).
 */
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

/**
 * Checks whether the error is a CHECK constraint violation. Supports
 * PostgreSQL (`23514`), SQLite (`SQLITE_CONSTRAINT_CHECK`), and MySQL
 * (`ER_CHECK_CONSTRAINT_VIOLATED` / errno `3819`).
 *
 * @param error      - The raw error value.
 * @param constraint - Optional constraint name to match against.
 * @returns `true` when the error is a CHECK violation (optionally for
 *   the specified constraint).
 */
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
