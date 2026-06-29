/**
 * Result returned by update operations that report the number of affected rows.
 *
 * @example
 * ```ts
 * const result = await db.user.updateMany({
 *   where: { role: 'guest' },
 *   data: { active: false },
 * });
 * console.log(result.count); // number of updated rows
 * ```
 */
export interface UpdateResult {
	/** Number of rows that were modified. */
	count: number;
}

/**
 * Result returned by delete operations that report the number of affected rows.
 *
 * @example
 * ```ts
 * const result = await db.user.deleteMany({
 *   where: { role: 'guest' },
 * });
 * console.log(result.count); // number of deleted rows
 * ```
 */
export interface DeleteResult {
	/** Number of rows that were deleted. */
	count: number;
}

export interface OffsetPaginationResult<
	Columns extends Record<string, unknown>,
> {
	data: Columns[];
	pagination: {
		type: 'offset';
		page: number;
		perPage: number;
		total: number;
		pageCount: number;
		hasNext: boolean;
		hasPrevious: boolean;
	};
}

export interface CursorPaginationResult<
	Columns extends Record<string, unknown>,
> {
	data: Columns[];
	pagination: {
		type: 'cursor';
		hasNext: boolean;
		hasPrevious: boolean;
		nextCursor: string | object | null;
		previousCursor: string | object | null;
	};
}

export interface OffsetPaginationOptions<
	Columns extends Record<string, unknown>,
> {
	/** Maximum number of rows to return per page. */
	limit?: number;
	/** Sort order for the result set. */
	orderBy?: OrderBy<Columns>;
}

export interface CursorPaginationOptions<
	Columns extends Record<string, unknown>,
> {
	/** Maximum number of rows to return per page. */
	limit?: number;
	/** Sort order for the result set. */
	orderBy?: OrderBy<Columns>;
	/** Cursor token pointing after which rows should be returned. */
	after?: string | object;
	/** Cursor token pointing before which rows should be returned. */
	before?: string | object;
}

/**
 * Sort specification for a result set. Each key is a column name and the value
 * indicates the sort direction.
 *
 * @typeParam Columns - The shape of each row in the result set.
 */
export type OrderBy<Columns extends Record<string, unknown>> = Partial<
	Record<keyof Columns, OrderType>
>;

/**
 * Sort direction values.
 */
export enum OrderType {
	/** Ascending order. */
	Asc = 'asc',
	/** Descending order. */
	Desc = 'desc',
}

export type { BetterLockClientOptions } from './query';
