import { describe, expect, test } from 'bun:test';

import {
	getDatabaseErrorInfo,
	isCheckViolation,
	isDatabaseError,
	isForeignKeyViolation,
	isNotNullViolation,
	isUniqueViolation,
} from '../src';

describe('isDatabaseError', () => {
	test('returns true for error-like objects with message', () => {
		expect(isDatabaseError({ message: 'fail' })).toBe(true);
	});

	test('returns true for error-like objects with code', () => {
		expect(isDatabaseError({ code: '23505' })).toBe(true);
	});

	test('returns true for error-like objects with errno', () => {
		expect(isDatabaseError({ errno: 1062 })).toBe(true);
	});

	test('returns true for error-like objects with sqlState', () => {
		expect(isDatabaseError({ sqlState: '23505' })).toBe(true);
	});

	test('returns false for null', () => {
		expect(isDatabaseError(null)).toBe(false);
	});

	test('returns false for primitives', () => {
		expect(isDatabaseError('string')).toBe(false);
		expect(isDatabaseError(42)).toBe(false);
		expect(isDatabaseError(undefined)).toBe(false);
	});

	test('returns false for empty objects', () => {
		expect(isDatabaseError({})).toBe(false);
	});

	test('returns true for Error instances', () => {
		expect(isDatabaseError(new Error('fail'))).toBe(true);
	});
});

describe('getDatabaseErrorInfo', () => {
	test('detects PostgreSQL driver from 5-digit code', () => {
		const info = getDatabaseErrorInfo({
			code: '23505',
			message: 'duplicate key',
		});
		expect(info.driver).toBe('pg');
		expect(info.code).toBe('23505');
	});

	test('detects SQLite driver from code prefix', () => {
		const info = getDatabaseErrorInfo({
			code: 'SQLITE_CONSTRAINT_UNIQUE',
			message: 'UNIQUE constraint failed: users.email',
		});
		expect(info.driver).toBe('sqlite');
	});

	test('detects SQLite driver from message', () => {
		const info = getDatabaseErrorInfo({
			message: 'FOREIGN KEY constraint failed',
		});
		expect(info.driver).toBe('sqlite');
	});

	test('detects MySQL driver from ER_ code', () => {
		const info = getDatabaseErrorInfo({
			code: 'ER_DUP_ENTRY',
			message: 'Duplicate entry',
		});
		expect(info.driver).toBe('mysql');
	});

	test('detects MySQL driver from errno', () => {
		const info = getDatabaseErrorInfo({
			errno: 1062,
			message: 'Duplicate entry for key',
		});
		expect(info.driver).toBe('mysql');
	});

	test('detects unknown driver', () => {
		const info = getDatabaseErrorInfo({
			message: 'Something went wrong',
		});
		expect(info.driver).toBe('unknown');
	});

	test('extracts constraint from PostgreSQL message', () => {
		const info = getDatabaseErrorInfo({
			message:
				'duplicate key value violates unique constraint for key "users_email_key"',
		});
		expect(info.constraint).toBe('users_email_key');
	});

	test('extracts table and column from SQLite unique constraint', () => {
		const info = getDatabaseErrorInfo({
			message: 'UNIQUE constraint failed: users.email',
		});
		expect(info.table).toBe('users');
		expect(info.column).toBe('email');
	});

	test('extracts table and column from SQLite not null constraint', () => {
		const info = getDatabaseErrorInfo({
			message: 'NOT NULL constraint failed: users.name',
		});
		expect(info.table).toBe('users');
		expect(info.column).toBe('name');
	});

	test('prefers explicit constraint field over message parsing', () => {
		const info = getDatabaseErrorInfo({
			constraint: 'custom_constraint',
			message:
				'duplicate key value violates unique constraint for key "other_key"',
		});
		expect(info.constraint).toBe('custom_constraint');
	});

	test('prefers explicit table/column fields over message parsing', () => {
		const info = getDatabaseErrorInfo({
			table: 'custom_table',
			column: 'custom_column',
			message: 'UNIQUE constraint failed: users.email',
		});
		expect(info.table).toBe('custom_table');
		expect(info.column).toBe('custom_column');
	});

	test('handles sqlMessage fallback', () => {
		const info = getDatabaseErrorInfo({
			sqlMessage: 'MySQL specific message',
		});
		expect(info.message).toBe('MySQL specific message');
	});
});

describe('isUniqueViolation', () => {
	test('detects PostgreSQL unique violation', () => {
		expect(
			isUniqueViolation({ code: '23505', message: 'duplicate key' }),
		).toBe(true);
	});

	test('detects PostgreSQL unique violation with constraint', () => {
		expect(
			isUniqueViolation(
				{
					code: '23505',
					constraint: 'users_email_key',
					message: 'duplicate',
				},
				'users_email_key',
			),
		).toBe(true);
	});

	test('rejects PostgreSQL unique violation with wrong constraint', () => {
		expect(
			isUniqueViolation(
				{ code: '23505', message: 'duplicate key' },
				'users_email_key',
			),
		).toBe(false);
	});

	test('detects SQLite unique violation', () => {
		expect(
			isUniqueViolation({
				code: 'SQLITE_CONSTRAINT_UNIQUE',
				message: 'UNIQUE constraint failed: users.email',
			}),
		).toBe(true);
	});

	test('detects SQLite unique violation from message', () => {
		expect(
			isUniqueViolation({
				message: 'UNIQUE constraint failed: users.email',
			}),
		).toBe(true);
	});

	test('detects MySQL unique violation', () => {
		expect(
			isUniqueViolation({
				code: 'ER_DUP_ENTRY',
				message: 'Duplicate entry',
			}),
		).toBe(true);
	});

	test('detects MySQL unique violation from errno', () => {
		expect(
			isUniqueViolation({
				errno: 1062,
				message: 'Duplicate entry for key',
			}),
		).toBe(true);
	});

	test('returns false for non-unique errors', () => {
		expect(isUniqueViolation({ message: 'Something else' })).toBe(false);
	});

	test('returns false for non-database errors', () => {
		expect(isUniqueViolation(null)).toBe(false);
		expect(isUniqueViolation('string')).toBe(false);
	});
});

describe('isForeignKeyViolation', () => {
	test('detects PostgreSQL foreign key violation', () => {
		expect(
			isForeignKeyViolation({ code: '23503', message: 'foreign key' }),
		).toBe(true);
	});

	test('detects PostgreSQL foreign key violation with constraint', () => {
		expect(
			isForeignKeyViolation(
				{
					code: '23503',
					constraint: 'fk_users',
					message: 'foreign key',
				},
				'fk_users',
			),
		).toBe(true);
	});

	test('detects SQLite foreign key violation', () => {
		expect(
			isForeignKeyViolation({
				code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
				message: 'FOREIGN KEY constraint failed',
			}),
		).toBe(true);
	});

	test('detects MySQL foreign key violation (errno 1451)', () => {
		expect(
			isForeignKeyViolation({
				errno: 1451,
				message: 'Cannot delete or update a parent row',
			}),
		).toBe(true);
	});

	test('detects MySQL foreign key violation (errno 1452)', () => {
		expect(
			isForeignKeyViolation({
				errno: 1452,
				message: 'Cannot add or update a child row',
			}),
		).toBe(true);
	});

	test('detects MySQL foreign key violation from code', () => {
		expect(
			isForeignKeyViolation({
				code: 'ER_NO_REFERENCED_ROW_2',
				message: 'foreign key fails',
			}),
		).toBe(true);
	});

	test('returns false for non-foreign-key errors', () => {
		expect(isForeignKeyViolation({ message: 'Something else' })).toBe(
			false,
		);
	});
});

describe('isNotNullViolation', () => {
	test('detects PostgreSQL not null violation', () => {
		expect(
			isNotNullViolation({ code: '23502', message: 'null value' }),
		).toBe(true);
	});

	test('detects PostgreSQL not null violation with column', () => {
		expect(
			isNotNullViolation(
				{ code: '23502', column: 'name', message: 'null value' },
				'name',
			),
		).toBe(true);
	});

	test('detects SQLite not null violation', () => {
		expect(
			isNotNullViolation({
				code: 'SQLITE_CONSTRAINT_NOTNULL',
				message: 'NOT NULL constraint failed: users.name',
			}),
		).toBe(true);
	});

	test('detects SQLite not null violation from message', () => {
		expect(
			isNotNullViolation({
				message: 'NOT NULL constraint failed: users.name',
			}),
		).toBe(true);
	});

	test('detects MySQL not null violation', () => {
		expect(
			isNotNullViolation({
				code: 'ER_BAD_NULL_ERROR',
				message: 'cannot be null',
			}),
		).toBe(true);
	});

	test('detects MySQL not null violation from errno', () => {
		expect(
			isNotNullViolation({
				errno: 1048,
				message: "Column 'name' cannot be null",
			}),
		).toBe(true);
	});

	test('returns false for non-not-null errors', () => {
		expect(isNotNullViolation({ message: 'Something else' })).toBe(false);
	});
});

describe('isCheckViolation', () => {
	test('detects PostgreSQL check violation', () => {
		expect(
			isCheckViolation({ code: '23514', message: 'check constraint' }),
		).toBe(true);
	});

	test('detects PostgreSQL check violation with constraint', () => {
		expect(
			isCheckViolation(
				{
					code: '23514',
					constraint: 'check_age',
					message: 'check constraint',
				},
				'check_age',
			),
		).toBe(true);
	});

	test('detects SQLite check violation', () => {
		expect(
			isCheckViolation({
				code: 'SQLITE_CONSTRAINT_CHECK',
				message: 'CHECK constraint failed',
			}),
		).toBe(true);
	});

	test('detects SQLite check violation from message', () => {
		expect(
			isCheckViolation({
				message: 'CHECK constraint failed: users',
			}),
		).toBe(true);
	});

	test('detects MySQL check violation', () => {
		expect(
			isCheckViolation({
				code: 'ER_CHECK_CONSTRAINT_VIOLATED',
				message: 'Check constraint',
			}),
		).toBe(true);
	});

	test('detects MySQL check violation from errno', () => {
		expect(
			isCheckViolation({
				errno: 3819,
				message: 'Check constraint is violated',
			}),
		).toBe(true);
	});

	test('returns false for non-check errors', () => {
		expect(isCheckViolation({ message: 'Something else' })).toBe(false);
	});
});
