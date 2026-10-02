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

/**
 * Result returned by the `paginate()` operation. Contains the page of data
 * and offset-based pagination metadata.
 *
 * @typeParam Columns - The row type returned by the query.
 *
 * @example
 * ```ts
 * const {
 *   data,
 *   pagination: { page, total, hasNext },
 * } = await db.user.paginate({ page: 1, perPage: 10 });
 * ```
 */
export interface OffsetPaginationResult<
	Columns extends Record<string, unknown>,
> {
	/** The page of rows matching the query. */
	data: Columns[];
	/** Offset-based pagination metadata. */
	pagination: {
		/** Always `'offset'` to distinguish from cursor pagination. */
		type: 'offset';
		/** Current page number (1-indexed). */
		page: number;
		/** Maximum rows per page. */
		perPage: number;
		/** Total number of matching rows across all pages. */
		total: number;
		/** Total number of pages. */
		pageCount: number;
		/** `true` when a next page exists. */
		hasNext: boolean;
		/** `true` when a previous page exists. */
		hasPrevious: boolean;
	};
}

/**
 * Result returned by the `cursor()` operation. Contains the page of data
 * and cursor-based navigation metadata.
 *
 * @typeParam Columns - The row type returned by the query.
 * @typeParam Cursor - The raw cursor object, keyed by the `orderBy` fields.
 *
 * @example
 * ```ts
 * const {
 *   data,
 *   pagination: { nextCursor },
 * } = await db.user.cursor({ limit: 10, orderBy: { id: 'asc' } });
 * const { data: next } = await db.user.cursor({
 *   limit: 10,
 *   orderBy: { id: 'asc' },
 *   after: nextCursor,
 * });
 * ```
 */
export interface CursorPaginationResult<
	Columns extends Record<string, unknown>,
	Cursor extends object = Record<string, unknown>,
> {
	/** The page of rows matching the query. */
	data: Columns[];
	/** Cursor-based pagination metadata. */
	pagination: {
		/** Always `'cursor'` to distinguish from offset pagination. */
		type: 'cursor';
		/** `true` when more rows exist after the current page. */
		hasNext: boolean;
		/** `true` when more rows exist before the current page. */
		hasPrevious: boolean;
		/** Cursor object (last row's `orderBy` fields) to pass as `after`, or `null` when `hasNext` is `false`. */
		nextCursor: Cursor | null;
		/** Cursor object (first row's `orderBy` fields) to pass as `before`, or `null` when `hasPrevious` is `false`. */
		previousCursor: Cursor | null;
	};
}

/**
 * Options for offset-based pagination. Used by the `paginate()` operation.
 *
 * @typeParam Columns - The row type of the result set.
 */
export interface OffsetPaginationOptions<
	Columns extends Record<string, unknown>,
> {
	/** Maximum number of rows to return per page. */
	limit?: import('./utils').Bindable<number>;
	/** Rows per page; an alias of `limit`. */
	perPage?: import('./utils').Bindable<number>;
	/** 1-based page number; computes `skip`, so it cannot be combined with it. */
	page?: import('./utils').Bindable<number>;
	/** Sort order for the result set. */
	orderBy?: OrderBy<Columns>;
}

/**
 * Options for cursor-based pagination. Used by the `cursor()` operation,
 * whose `CursorArgs` add the `after` / `before` cursor objects.
 *
 * @typeParam Columns - The row type of the result set.
 */
export interface CursorPaginationOptions<
	Columns extends Record<string, unknown>,
> {
	/** Maximum number of rows to return per page. */
	limit?: import('./utils').Bindable<number>;
	/** Sort order for the result set. */
	orderBy?: OrderBy<Columns>;
}

/**
 * Sort specification for a result set. Each key is a column name and the value
 * indicates the sort direction.
 *
 * @typeParam Columns - The shape of each row in the result set.
 */
export type OrderBy<Columns extends Record<string, unknown>> =
	| Partial<
			Record<
				keyof Columns,
				import('./utils').SortOrder | import('./utils').SortConfig
			>
	  >
	| Partial<
			Record<
				keyof Columns,
				import('./utils').SortOrder | import('./utils').SortConfig
			>
	  >[];

export type { BetterLockClientOptions } from './query';
