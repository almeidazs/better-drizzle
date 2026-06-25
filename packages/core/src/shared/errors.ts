/**
 * The database driver type detected from error patterns.
 *
 * - `'pg'` – PostgreSQL
 * - `'sqlite'` – SQLite
 * - `'mysql'` – MySQL / MariaDB
 * - `'unknown'` – Could not be detected
 */
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

/**
 * Error codes used by Better Drizzle to classify errors programmatically.
 *
 * Each code maps to a default HTTP-like status code and can be used
 * in `catch` blocks to handle specific error scenarios.
 *
 * @example
 * ```ts
 * import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';
 *
 * try {
 *   await db.user.findUnique({ where: { id: 1 } }).throw();
 * } catch (error) {
 *   if (error instanceof BetterDrizzleError) {
 *     if (error.code === BetterDrizzleErrorCode.ResultNotFound) {
 *       console.log('User not found');
 *     }
 *   }
 * }
 * ```
 */
export enum BetterDrizzleErrorCode {
	/** `afterCommit()` was called outside a transaction. */
	AfterCommitOutsideTransaction = 'AFTER_COMMIT_OUTSIDE_TRANSACTION',
	/** `afterRollback()` was called outside a transaction. */
	AfterRollbackOutsideTransaction = 'AFTER_ROLLBACK_OUTSIDE_TRANSACTION',
	/** A database-level error occurred (unique violation, NOT NULL, etc.). */
	DatabaseError = 'DATABASE_ERROR',
	/** The SQL dialect could not be inferred from the Drizzle client. */
	DialectInferenceFailed = 'DIALECT_INFERENCE_FAILED',
	/** A lifecycle hook threw an error. */
	HookError = 'HOOK_ERROR',
	/** An operation (CRUD, query, transaction) failed. */
	OperationError = 'OPERATION_ERROR',
	/** A plugin does not support the current SQL dialect. */
	PluginDialectUnsupported = 'PLUGIN_DIALECT_UNSUPPORTED',
	/** Two plugins share the same `id`. */
	PluginDuplicateId = 'PLUGIN_DUPLICATE_ID',
	/** Two plugins try to add the same client extension property. */
	PluginExtensionConflict = 'PLUGIN_EXTENSION_CONFLICT',
	/** Two plugins try to add the same operation arg field. */
	PluginOperationArgConflict = 'PLUGIN_OPERATION_ARG_CONFLICT',
	/** A required column is missing on a model. */
	PluginRequiredColumnMissing = 'PLUGIN_REQUIRED_COLUMN_MISSING',
	/** `options.comment` is required when `raw.requireComment` is enabled. */
	RawCommentRequired = 'RAW_COMMENT_REQUIRED',
	/** A raw query was aborted via `AbortSignal`. */
	RawAborted = 'RAW_ABORTED',
	/** Raw SQL is disabled for this client. */
	RawDisabled = 'RAW_DISABLED',
	/** The raw SQL input is not a valid tagged template or SQL object. */
	RawInvalidQuery = 'RAW_INVALID_QUERY',
	/** A raw query timed out. */
	RawTimeout = 'RAW_TIMEOUT',
	/** `$rawUnsafe()` is disabled. Set `raw.allowUnsafe: true` to enable. */
	RawUnsafeDisabled = 'RAW_UNSAFE_DISABLED',
	/** The `?` placeholder count does not match the parameter count. */
	RawUnsafePlaceholderMismatch = 'RAW_UNSAFE_PLACEHOLDER_MISMATCH',
	/** A raw SQL option is not supported by the current dialect. */
	RawUnsupportedOption = 'RAW_UNSUPPORTED_OPTION',
	/** No repository matches the given name. */
	RepositoryNotFound = 'REPOSITORY_NOT_FOUND',
	/** A `.throw()` call found no matching record. */
	ResultNotFound = 'RESULT_NOT_FOUND',
	/** Internal: the table runtime metadata was not found. */
	TableRuntimeNotFound = 'TABLE_RUNTIME_NOT_FOUND',
	/** A transaction was aborted via `AbortSignal` or timeout. */
	TransactionAborted = 'TRANSACTION_ABORTED',
	/** Internal: transaction lifecycle state is missing. */
	TransactionLifecycleStateMissing = 'TRANSACTION_LIFECYCLE_STATE_MISSING',
	/** Internal: transaction runtime was not initialized. */
	TransactionRuntimeNotInitialized = 'TRANSACTION_RUNTIME_NOT_INITIALIZED',
	/** The transaction was explicitly rolled back via `rollback()`. */
	TransactionRollback = 'TRANSACTION_ROLLBACK',
	/** The Drizzle client does not support transactions. */
	TransactionsUnsupported = 'TRANSACTIONS_UNSUPPORTED',
	/** A transaction timed out. */
	TransactionTimeout = 'TRANSACTION_TIMEOUT',
	/** A transaction option is not supported by the current dialect. */
	TransactionUnsupportedOption = 'TRANSACTION_UNSUPPORTED_OPTION',
	/** An unknown or uncategorised error occurred. */
	Unknown = 'UNKNOWN',
}

/**
 * Configuration options for creating a {@link BetterDrizzleError}.
 *
 * @example
 * ```ts
 * const error = new BetterDrizzleError({
 *   code: BetterDrizzleErrorCode.DatabaseError,
 *   message: 'Unique constraint violated',
 *   table: 'users',
 *   constraint: 'users_email_unique',
 *   driver: 'pg',
 *   details: { operation: 'create', userId: 42 },
 * });
 * ```
 */
export interface BetterDrizzleErrorOptions {
	/** The error code identifying the error category. */
	code: BetterDrizzleErrorCode;
	/** A human-readable error message. */
	message: string;
	/** Optional HTTP-like status code (derived from `code` when omitted). */
	status?: number;
	/** The detected database driver. */
	driver?: DatabaseDriver;
	/** The original error that caused this error. */
	cause?: unknown;
	/** The column involved in the error. */
	column?: string;
	/** The constraint that was violated. */
	constraint?: string;
	/** Additional structured error details. */
	details?: Record<string, unknown>;
	/** The SQL dialect in use. */
	dialect?: string;
	/** Driver-specific errno value. */
	errno?: number;
	/** The name of the hook that failed. */
	hookName?: string;
	/** The operation that failed. */
	operation?: string;
	/** SQLSTATE code from the database. */
	sqlState?: string;
	/** The lifecycle stage where the error occurred. */
	stage?: string;
	/** The table involved in the error. */
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

/**
 * The primary error class thrown by Better Drizzle operations.
 *
 * Extends `Error` with structured metadata including `code`, `status`,
 * `driver`, `table`, `column`, `constraint`, and more. Use the static
 * helpers to normalise external errors into this shape.
 *
 * @example
 * ```ts
 * import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';
 *
 * // Throwing a custom error
 * throw new BetterDrizzleError({
 *   code: BetterDrizzleErrorCode.DatabaseError,
 *   message: 'Unique constraint violated',
 *   table: 'users',
 *   constraint: 'users_email_unique',
 * });
 *
 * // Normalising an external error
 * const betterError = BetterDrizzleError.from(originalError);
 *
 * // Checking error type
 * if (BetterDrizzleError.is(error)) {
 *   console.log(error.code, error.status);
 * }
 * ```
 */
export class BetterDrizzleError extends Error {
	/** The error code identifying the error category. */
	code: BetterDrizzleErrorCode;
	/** HTTP-like status code derived from the error code. */
	status: number;
	/** The detected database driver, if applicable. */
	driver?: DatabaseDriver;
	/** The column involved in the error, if detectable. */
	column?: string;
	/** The constraint that was violated, if detectable. */
	constraint?: string;
	/** Additional structured error details. */
	details?: Record<string, unknown>;
	/** The SQL dialect in use, if known. */
	dialect?: string;
	/** Driver-specific errno value, if available. */
	errno?: number;
	/** The name of the hook that failed, if the error originated from a hook. */
	hookName?: string;
	/** The operation that failed (e.g. `'create'`, `'transaction'`). */
	operation?: string;
	/** SQLSTATE code from the database, if available. */
	sqlState?: string;
	/** The lifecycle stage where the error occurred (e.g. `'beforeHook'`). */
	stage?: string;
	/** The table involved in the error, if detectable. */
	table?: string;

	/**
	 * Creates a new `BetterDrizzleError`.
	 *
	 * @param options - Error configuration including `code`, `message`, and
	 *   optional metadata fields.
	 */
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

	/**
	 * Type guard that checks whether a value is a `BetterDrizzleError`.
	 *
	 * @param error - The value to check.
	 * @returns `true` when the value is an instance of `BetterDrizzleError`.
	 *
	 * @example
	 * ```ts
	 * try {
	 *   await db.user.findUnique({ where: { id: 1 } }).throw();
	 * } catch (error) {
	 *   if (BetterDrizzleError.is(error)) {
	 *     console.log(error.code); // 'RESULT_NOT_FOUND'
	 *   }
	 * }
	 * ```
	 */
	static is(error: unknown): error is BetterDrizzleError {
		return error instanceof BetterDrizzleError;
	}

	/**
	 * Normalises any error value into a `BetterDrizzleError`.
	 *
	 * If the input is already a `BetterDrizzleError`, clones it with
	 * optional overrides. Otherwise, inspects the error for database
	 * driver information and creates a new instance.
	 *
	 * @param error - The original error value.
	 * @param overrides - Optional fields to override on the resulting error.
	 * @returns A new `BetterDrizzleError` instance.
	 *
	 * @example
	 * ```ts
	 * try {
	 *   await db.insert(users).values(data);
	 * } catch (error) {
	 *   const betterError = BetterDrizzleError.from(error, {
	 *     operation: 'create',
	 *     table: 'users',
	 *   });
	 *   throw betterError;
	 * }
	 * ```
	 */
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

	/**
	 * Normalises a database-specific error into a `BetterDrizzleError`.
	 *
	 * Inspects the error for PostgreSQL, SQLite, or MySQL patterns and
	 * extracts the driver, code, constraint, table, column, and message.
	 *
	 * @param error - The raw database error.
	 * @param overrides - Optional fields to override on the resulting error.
	 * @returns A new `BetterDrizzleError` with `code: DATABASE_ERROR`.
	 *
	 * @example
	 * ```ts
	 * try {
	 *   await db.insert(users).values({ email: 'duplicate@example.com' });
	 * } catch (error) {
	 *   const dbError = BetterDrizzleError.fromDatabaseError(error);
	 *   if (isUniqueViolation(error)) {
	 *     console.log('Duplicate email:', dbError.constraint);
	 *   }
	 * }
	 * ```
	 */
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

	/**
	 * Creates a clone of this error with an additional `cause`.
	 *
	 * @param cause - The underlying cause to attach.
	 * @returns A new `BetterDrizzleError` with the updated cause.
	 *
	 * @example
	 * ```ts
	 * const original = BetterDrizzleError.from(error);
	 * const wrapped = original.withCause(new Error('retry failed'));
	 * ```
	 */
	withCause(cause: unknown) {
		return BetterDrizzleError.from(this, { cause });
	}

	/**
	 * Creates a clone of this error with merged detail fields.
	 *
	 * @param details - Additional details to merge into the existing details.
	 * @returns A new `BetterDrizzleError` with the merged details.
	 *
	 * @example
	 * ```ts
	 * const error = BetterDrizzleError.from(original).withDetails({
	 *   userId: 123,
	 *   requestId: 'abc-456',
	 * });
	 * ```
	 */
	withDetails(details: Record<string, unknown>) {
		return BetterDrizzleError.from(this, {
			details: {
				...(this.details ?? {}),
				...details,
			},
		});
	}

	/**
	 * Serialises the error to a plain JSON-safe object.
	 *
	 * @returns A plain object with all error fields.
	 *
	 * @example
	 * ```ts
	 * const error = BetterDrizzleError.from(original);
	 * console.log(JSON.stringify(error.toJSON()));
	 * ```
	 */
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
